import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMESPACE = 'marketplace';
const DEPLOYMENT = 'deploy/api';
const URL = 'http://127.0.0.1:22880/health';
const LOAD_SECONDS = 90;
const WORKERS = 8;
const MIN_REQUESTS = 5000;
const PROFILE = process.argv[2] === 'bad' ? 'bad' : 'good';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, { quiet = true } = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });

  if (result.status !== 0) {
    if (quiet) process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }

  return result.stdout ?? '';
}

const pulumi = (...args) => run('bash', ['scripts/pulumi.sh', ...args]);
const rolloutStatus = () => run('kubectl', ['--context', 'kind-rd-course', '-n', NAMESPACE, 'rollout', 'status', DEPLOYMENT, '--timeout=300s']);

async function waitForHttp200() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const code = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '2', URL], { encoding: 'utf8' }).stdout;

    if (code === '200') return;
    await sleep(1000);
  }

  throw new Error(`${URL} never answered 200`);
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'rollout-load-'));
  const codesFile = join(workDir, 'codes.txt');

  try {
    console.log(`── baseline: profile=${PROFILE}`);
    pulumi('config', 'set', 'profile', PROFILE);
    pulumi('up', '--yes');
    rolloutStatus();
    await waitForHttp200();

    console.log(`── load: ${WORKERS} curl workers for ${LOAD_SECONDS} s -> ${URL}`);
    const load = spawn('bash', ['scripts/load.sh', URL, String(LOAD_SECONDS), String(WORKERS), codesFile], { cwd: ROOT, stdio: 'ignore' });
    const loadDone = new Promise((resolve) => load.once('exit', resolve));
    await sleep(4000);

    const rev = `r${Date.now()}`;
    console.log(`── rollout: rev=${rev} (pod template changes -> RollingUpdate)`);
    pulumi('config', 'set', 'rev', rev);
    const startedAt = Date.now();
    pulumi('up', '--yes');
    rolloutStatus();
    const rolloutSeconds = Math.round((Date.now() - startedAt) / 1000);

    await loadDone;

    const codes = existsSync(codesFile) ? readFileSync(codesFile, 'utf8').split('\n').filter(Boolean) : [];
    const requests = codes.length;
    const ok = codes.filter((code) => code === '200').length;
    const failed = requests - ok;
    const noResponse = codes.filter((code) => code === '000').length;
    const errorLines = existsSync(`${codesFile}.errors`) ? readFileSync(`${codesFile}.errors`, 'utf8').split('\n').filter(Boolean) : [];
    const timeouts = errorLines.filter((line) => line.endsWith('curl-exit=28')).length;
    const refused = errorLines.filter((line) => line.endsWith('curl-exit=7')).length;

    console.log('── result');
    console.log(`profile=${PROFILE}`);
    console.log(`requests=${requests}`);
    console.log(`ok=${ok}`);
    console.log(`failed=${failed}`);
    console.log(`no-response=${noResponse}`);
    console.log(`timeouts=${timeouts}`);
    console.log(`refused=${refused}`);
    console.log(`rollout-seconds=${rolloutSeconds}`);

    const passed = failed === 0 && requests >= MIN_REQUESTS;
    if (!passed) {
      console.log(`   INVARIANT VIOLATED: expected failed=0 and requests>=${MIN_REQUESTS}`);
      for (const line of errorLines.slice(0, 20)) console.log(`   ${line}`);
    }

    return passed ? 0 : 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
