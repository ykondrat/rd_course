import { spawnSync } from 'node:child_process';

const image = process.env.SCAN_IMAGE || 'rd-course-api:prod';
const severity = 'CRITICAL,HIGH';
const maxAllowed = Number(process.env.SCAN_MAX ?? 15);
const scanner = 'aquasec/trivy:0.74.0';

if (!Number.isInteger(maxAllowed)) {
  console.error(`SCAN_MAX must be an integer, got "${process.env.SCAN_MAX}"`);
  process.exit(2);
}

const result = spawnSync('docker', [
  'run', '--rm',
  '-v', '/var/run/docker.sock:/var/run/docker.sock',
  '-v', 'trivy-cache:/root/.cache',
  scanner, 'image', '--quiet', '--scanners', 'vuln',
  '--severity', severity, '--ignore-unfixed', '--format', 'json', image,
], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

if (result.status !== 0) {
  console.error(result.stderr || result.error?.message || 'trivy failed');
  process.exit(2);
}

const report = JSON.parse(result.stdout);
const findings = (report.Results ?? []).flatMap((target) => target.Vulnerabilities ?? []);
const bySeverity = findings.reduce((counts, finding) => {
  counts[finding.Severity] = (counts[finding.Severity] ?? 0) + 1;
  return counts;
}, {});
const found = findings.length;
const gate = found <= maxAllowed ? 'pass' : 'fail';

console.log(`image=${image}`);
console.log(`scanner=${scanner}`);
console.log(`severity=${severity}`);
console.log(`critical=${bySeverity.CRITICAL ?? 0}`);
console.log(`high=${bySeverity.HIGH ?? 0}`);
console.log(`found=${found}`);
console.log(`max-allowed=${maxAllowed}`);
console.log(`gate=${gate}`);

process.exit(gate === 'pass' ? 0 : 1);
