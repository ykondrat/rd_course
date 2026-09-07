import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  makeClient, loginAsAdmin, log, ok, note,
  API, ORG_NAME, PROJECT_NAME, IDENTITY_NAME,
  SECRETS_DIR, ADMIN_FILE, MACHINE_FILE, STATE_FILE,
} from './admin-api.mjs';

const hex = (n) => randomBytes(n).toString('hex');

const SECRETS = {
  dev: {
    PGHOST: 'localhost',
    PGPORT: '5432',
    PGUSER: 'app_user',
    PGPASSWORD: 'apppass',
    PGDATABASE: 'appdb',
    PG_POOL_MAX: '10',
    NODE_ENV: 'development',
  },
  prod: {
    PGHOST: 'db.internal',
    PGPORT: '5432',
    PGUSER: 'app_user',
    PGPASSWORD: `PROD-${hex(9)}`,
    PGDATABASE: 'appdb',
    PG_POOL_MAX: '20',
    NODE_ENV: 'production',
  },
};

const genPassword = () => `MP-${randomBytes(12).toString('base64url')}-x9`;

const client = makeClient();
mkdirSync(SECRETS_DIR, { recursive: true });

const { config } = await client.must('GET', '/api/v1/admin/config', undefined, 'read admin-config');

if (!config.initialized) {
  const admin = { email: 'admin@marketplace.local', password: genPassword() };

  await client.must('POST', '/api/v1/admin/bootstrap', { ...admin, organization: ORG_NAME }, 'bootstrap instance');
  writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2), { mode: 0o600 });
  ok(`instance initialized, admin ${admin.email}`);
} else if (!existsSync(ADMIN_FILE)) {
  throw new Error(
    'Instance already initialized but .secrets/admin.json is gone — the admin password\n' +
    '    is shown exactly once. Simplest fix: tear down and re-up:\n' +
    '    bash infisical/down.sh && bash infisical/up.sh',
  );
} else {
  ok(`instance already initialized, logging in as ${JSON.parse(readFileSync(ADMIN_FILE, 'utf8')).email}`);
}

const { admin, org } = await loginAsAdmin(client);
ok(`organization ${org.name} (${org.slug})`);

const existing = await client.must('GET', `/api/v2/organizations/${org.id}/workspaces`, undefined, 'list projects');
let project = existing.workspaces?.find((w) => w.name === PROJECT_NAME);

if (!project) {
  const created = await client.must(
    'POST', '/api/v1/projects',
    { projectName: PROJECT_NAME, type: 'secret-manager', shouldCreateDefaultEnvs: true },
    'create project',
  );

  project = created.project ?? created;
  ok(`project ${PROJECT_NAME} created`);
} else {
  ok(`project ${PROJECT_NAME} already exists`);
}

const envSlugs = (project.environments ?? []).map((e) => e.slug);

ok(`environments: ${envSlugs.join(', ')}`);

for (const [envSlug, kv] of Object.entries(SECRETS)) {
  const list = await client.call('GET', `/api/v3/secrets/raw?workspaceId=${project.id}&environment=${envSlug}&secretPath=%2F`);
  const present = new Set((list.json.secrets ?? []).map((s) => s.secretKey));

  let written = 0;
  for (const [key, value] of Object.entries(kv)) {
    if (present.has(key)) continue;
    await client.must(
      'POST', `/api/v3/secrets/raw/${key}`,
      { workspaceId: project.id, environment: envSlug, secretPath: '/', secretValue: value },
      `write secret ${key} in ${envSlug}`,
    );
    written += 1;
  }
  ok(written ? `${envSlug}: wrote ${written} values` : `${envSlug}: values already present, left untouched`);
}

const idsPage = await client.must('GET', `/api/v2/organizations/${org.id}/identity-memberships`, undefined, 'list identities');
let identity = idsPage.identityMemberships?.find((m) => m.identity?.name === IDENTITY_NAME)?.identity;

if (!identity) {
  const created = await client.must(
    'POST', '/api/v1/identities',
    { name: IDENTITY_NAME, organizationId: org.id, role: 'member' },
    'create machine identity',
  );
  identity = created.identity;
  ok(`machine identity ${IDENTITY_NAME} created`);
} else {
  ok(`machine identity ${IDENTITY_NAME} already exists`);
}

const ua = await client.call('POST', `/api/v1/auth/universal-auth/identities/${identity.id}`, {
  accessTokenTTL: 7200,
  accessTokenMaxTTL: 86400,
  accessTokenNumUsesLimit: 0,
});
if (!ua.okStatus && !/already/i.test(JSON.stringify(ua.json))) {
  throw new Error(`Universal Auth: ${ua.status} ${JSON.stringify(ua.json).slice(0, 300)}`);
}

const uaCfg = await client.must('GET', `/api/v1/auth/universal-auth/identities/${identity.id}`, undefined, 'read UA config');
const clientId = uaCfg.identityUniversalAuth.clientId;
const cs = await client.must(
  'POST', `/api/v1/auth/universal-auth/identities/${identity.id}/client-secrets`,
  { description: `rd_course up.sh ${new Date().toISOString()}`, numUsesLimit: 0, ttl: 0 },
  'create clientSecret',
);
ok('Universal Auth: clientId + clientSecret ready');

const member = await client.call('POST', `/api/v1/projects/${project.id}/identity-memberships/${identity.id}`, {
  roles: [{ role: 'viewer' }],
});

if (member.okStatus) ok('identity added to project as viewer');
else if (/already/i.test(JSON.stringify(member.json))) ok('identity already in project');
else throw new Error(`project access: ${member.status} ${JSON.stringify(member.json).slice(0, 300)}`);

writeFileSync(
  MACHINE_FILE,
  [
    '# MACHINE credentials (not a human). The only thing the app knows about the',
    '# store. The secrets themselves are NOT here — just the key to the store.',
    `INFISICAL_URL=${API}`,
    `INFISICAL_PROJECT_ID=${project.id}`,
    `INFISICAL_CLIENT_ID=${clientId}`,
    `INFISICAL_CLIENT_SECRET=${cs.clientSecret}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);

writeFileSync(
  STATE_FILE,
  JSON.stringify({
    api: API, orgId: org.id, projectId: project.id, projectSlug: project.slug,
    identityId: identity.id, environments: envSlugs,
  }, null, 2),
  { mode: 0o600 },
);

log('');
log(`  UI:           ${API}`);
log(`  login:        ${admin.email} / password in .secrets/admin.json`);
log(`  projectId:    ${project.id}`);
log(`  clientId:     ${clientId}`);
log(`  clientSecret: ${cs.clientSecret.slice(0, 8)}…  (full value in .secrets/machine-identity.env)`);
note('Secret values are random and NOT shown — they live only in the store.');
note('Inspect them via the UI, or: bash infisical/run.sh dev env');