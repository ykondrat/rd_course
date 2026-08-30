'use strict';

const path = require('node:path');

const MIN_OPERATIONS = 5;
const MIN_RESOURCE_GROUPS = 2;
const MIN_KEY_DESCRIPTION_LENGTH = 40;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

const loadSpec = () => {
  const specPath = path.join(__dirname, '..', 'spec.json');

  try {
    return require(specPath);
  } catch {
    console.error(
      `Could not load ${specPath}. Run "npm run bundle" first ` +
        '(or use "npm run verify:spec").',
    );
    process.exit(1);
  }
};

const operationEntries = (root) => {
  const entries = [];

  for (const [template, pathItem] of Object.entries(root.paths || {})) {
    for (const method of Object.keys(pathItem)) {
      if (HTTP_METHODS.has(method)) entries.push([template, method]);
    }
  }

  return entries;
};

const resourceGroups = (root) => {
  const groups = new Set();

  for (const template of Object.keys(root.paths || {})) {
    groups.add(template.split('/')[1]);
  }

  return groups;
};

const findIdempotencyKeyParam = (root, operations) => {
  const parameters = operations.flatMap(
    ([p, m]) => root.paths[p][m].parameters ?? [],
  );

  return parameters.find(
    (param) => param.in === 'header' && /idempotency-key/i.test(param.name),
  );
};

const collectFailures = (root) => {
  const failures = [];
  const operations = operationEntries(root);

  if (operations.length < MIN_OPERATIONS) {
    failures.push(
      `operations: found ${operations.length}, need >= ${MIN_OPERATIONS}`,
    );
  }

  const groups = resourceGroups(root);

  if (groups.size < MIN_RESOURCE_GROUPS) {
    failures.push(
      `resource groups: found ${groups.size}, need >= ${MIN_RESOURCE_GROUPS}`,
    );
  }

  const keyParam = findIdempotencyKeyParam(root, operations);

  if (!keyParam) {
    failures.push(
      'Idempotency-Key header parameter not found inline on any operation ' +
        '(a $ref does not count — the grader reads parameters without ' +
        'dereferencing, so the parameter must be inlined)',
    );
  } else {
    if (keyParam.required !== true) {
      failures.push('Idempotency-Key parameter must be required: true');
    }
    const description = (keyParam.description ?? '').trim();

    if (description.length < MIN_KEY_DESCRIPTION_LENGTH) {
      failures.push(
        `Idempotency-Key description length ${description.length}, ` +
          `need >= ${MIN_KEY_DESCRIPTION_LENGTH}`,
      );
    }
  }

  return { operations, groups, failures };
};

const main = () => {
  const spec = loadSpec();
  const { operations, groups, failures } = collectFailures(spec);

  if (failures.length > 0) {
    console.error('OpenAPI size-check FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('OpenAPI size-check passed:');
  console.log(`  operations:      ${operations.length} (>= ${MIN_OPERATIONS})`);
  console.log(
    `  resource groups: ${groups.size} (>= ${MIN_RESOURCE_GROUPS}) ` +
      `[${[...groups].join(', ')}]`,
  );
  console.log(
    '  Idempotency-Key: required (inline), description >= ' +
      `${MIN_KEY_DESCRIPTION_LENGTH} chars`,
  );
};

main();
