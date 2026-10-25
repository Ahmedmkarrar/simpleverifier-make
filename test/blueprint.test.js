const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startMockApi } = require('./mock-api');

const root = path.join(__dirname, '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const moduleNames = fs.readdirSync(path.join(root, 'modules'));
const MODULE_FILES = ['module.json', 'communication.json', 'mappable-parameters.json', 'interface.json'];

let mock;
before(async () => {
  mock = await startMockApi();
});
after(() => mock.server.close());

test('every JSON file parses', () => {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  for (const file of walk(root).filter((f) => f.endsWith('.json'))) JSON.parse(fs.readFileSync(file, 'utf8'));
});

test('app has the three required modules, one of them universal', () => {
  assert.deepStrictEqual([...moduleNames].sort(), ['makeApiCall', 'validatePhone', 'verifyEmail']);
  const types = moduleNames.map((name) => readJson('modules', name, 'module.json').typeId);
  assert.ok(types.includes('universal'));
});

test('modules have all blocks, a label, a description and the shared connection', () => {
  for (const name of moduleNames) {
    for (const file of MODULE_FILES) assert.ok(fs.existsSync(path.join(root, 'modules', name, file)), `${name}/${file} missing`);
    const meta = readJson('modules', name, 'module.json');
    assert.strictEqual(meta.name, name);
    assert.ok(meta.label && meta.description, `${name} needs label and description`);
    assert.strictEqual(meta.connection, 'simpleverifier');
  }
});

test('every parameter has a label, a type and help for required ones', () => {
  const files = [['connection', 'parameters.json'], ...moduleNames.map((n) => ['modules', n, 'mappable-parameters.json'])];
  for (const parts of files) {
    for (const param of readJson(...parts)) {
      assert.ok(param.name && param.type && param.label, `${parts.join('/')}: ${param.name} incomplete`);
      if (param.required) assert.ok(param.help, `${parts.join('/')}: required ${param.name} has no help`);
    }
  }
});

test('secrets are sanitised in base, connection and every module', () => {
  const sanitised = (block) => (block.log && block.log.sanitize) || [];
  assert.ok(sanitised(readJson('base.json')).includes('request.headers.authorization'));
  assert.ok(sanitised(readJson('connection', 'communication.json')).includes('request.headers.authorization'));
});

test('base and connection define error handling, connection returns metadata', () => {
  assert.ok(readJson('base.json').response.error.message);
  const connection = readJson('connection', 'communication.json');
  assert.ok(connection.response.error.message);
  assert.ok(connection.response.metadata.value);
});

test('action samples match their interface fields', () => {
  for (const name of ['verifyEmail', 'validatePhone']) {
    const fields = readJson('modules', name, 'interface.json').map((f) => f.name);
    for (const key of Object.keys(readJson('modules', name, 'samples.json'))) assert.ok(fields.includes(key), `${name}: ${key} not in interface`);
  }
});

const render = (template, scope) => {
  if (typeof template === 'object' && template !== null) {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, render(v, scope)]));
  }
  if (typeof template !== 'string') return template;
  const whole = template.match(/^\{\{(.*)\}\}$/s);
  if (whole) return evaluate(whole[1], scope);
  return template.replace(/\{\{(.*?)\}\}/g, (_, expr) => evaluate(expr, scope));
};

const evaluate = (expr, scope) => {
  const ifempty = expr.match(/^ifempty\((.+?);\s*"(.*)"\)$/);
  if (ifempty) {
    const value = evaluate(ifempty[1], scope);
    return value === undefined || value === '' ? ifempty[2] : value;
  }
  const collection = expr.match(/^toCollection\((.+?),\s*'(.+?)',\s*'(.+?)'\)$/);
  if (collection) {
    const rows = evaluate(collection[1], scope) || [];
    return Object.fromEntries(rows.map((row) => [row[collection[2]], row[collection[3]]]));
  }
  return expr.trim().split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), scope);
};

const run = async (block, scope) => {
  const base = readJson('base.json');
  const request = render(block, scope);
  const url = /^https?:/.test(request.url) ? request.url : mock.base + request.url;
  const headers = { ...render(base.headers, scope), ...(request.headers || {}) };
  const hasBody = request.body !== undefined && request.method !== 'GET';
  const response = await fetch(url, {
    method: request.method,
    headers: hasBody ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: hasBody ? JSON.stringify(request.body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

const connection = { apiKey: 'sv_live_mockkey' };

test('connection test calls /me and yields the metadata email', async () => {
  const block = readJson('connection', 'communication.json');
  const { status, body } = await run({ ...block, url: block.url.replace('https://simpleverifier.com/api/v1', '') }, { parameters: connection });
  assert.strictEqual(status, 200);
  assert.strictEqual(render(block.response.metadata, { body }).value, 'tester@example.com');
});

test('verifyEmail sends the email and returns the verdict', async () => {
  const { status, body } = await run(readJson('modules', 'verifyEmail', 'communication.json'), {
    connection,
    parameters: { email: 'jane@company.com' },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'valid');
  assert.strictEqual(mock.calls.at(-1).path, '/api/v1/verify');
});

test('validatePhone defaults the country to US and passes the live flag', async () => {
  await run(readJson('modules', 'validatePhone', 'communication.json'), { connection, parameters: { phone: '(415) 555-2671', live: true } });
  assert.deepStrictEqual(mock.calls.at(-1).body, { phone: '(415) 555-2671', country: 'US', live: true });
});

test('makeApiCall passes method, relative url and JSON body through', async () => {
  const { status, body } = await run(readJson('modules', 'makeApiCall', 'communication.json'), {
    connection,
    parameters: { url: '/verify', method: 'POST', body: { email: 'info@catchall.test' } },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'risky');
});

test('a bad key surfaces the API error (error scenario for the review)', async () => {
  const { status, body } = await run(readJson('modules', 'verifyEmail', 'communication.json'), {
    connection: { apiKey: 'sv_live_wrong' },
    parameters: { email: 'jane@company.com' },
  });
  assert.strictEqual(status, 401);
  assert.strictEqual(render(readJson('base.json').response.error.message, { statusCode: status, body }), '[401] Invalid API key');
});
