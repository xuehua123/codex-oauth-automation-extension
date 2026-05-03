const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('sidepanel html exposes Codex2API login-only controls', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(html, /id="row-codex2api-login-only-mode"/);
  assert.match(html, /id="input-codex2api-login-only-mode"/);
  assert.match(html, /id="row-codex2api-login-accounts"/);
  assert.match(html, /id="input-codex2api-login-accounts"/);
});

test('sidepanel locks run count to Codex2API login-only account pool size', () => {
  const bundle = [
    extractFunction('normalizeCustomEmailPoolEntries'),
    extractFunction('usesCustomEmailPoolGenerator'),
    extractFunction('usesCustomMailProviderPool'),
    extractFunction('getCustomMailProviderPoolSize'),
    extractFunction('getCustomEmailPoolSize'),
    extractFunction('normalizeCodex2ApiLoginAccountEntries'),
    extractFunction('formatCodex2ApiLoginAccountEntries'),
    extractFunction('isCodex2ApiLoginOnlyModeEnabled'),
    extractFunction('getCodex2ApiLoginAccountPoolSize'),
    extractFunction('getLockedRunCountFromEmailPool'),
    extractFunction('getRunCountValue'),
  ].join('\n');

  const api = new Function(`
const GMAIL_PROVIDER = 'gmail';
const GMAIL_ALIAS_GENERATOR = 'gmail-alias';
const CUSTOM_EMAIL_POOL_GENERATOR = 'custom-pool';
const selectPanelMode = { value: 'codex2api' };
const inputCodex2ApiLoginOnlyMode = { checked: true };
const inputCodex2ApiLoginAccounts = { value: 'alpha@example.com | pass-1\\nbeta@example.com| pass-2' };
const selectMailProvider = { value: '163' };
const selectEmailGenerator = { value: 'duck' };
const inputCustomMailProviderPool = { value: '' };
const inputCustomEmailPool = { value: '' };
const inputRunCount = { value: '99' };

function isCustomMailProvider(provider = selectMailProvider.value) {
  return String(provider || '').trim().toLowerCase() === 'custom';
}

${bundle}

return {
  formatCodex2ApiLoginAccountEntries,
  getCodex2ApiLoginAccountPoolSize,
  getLockedRunCountFromEmailPool,
  getRunCountValue,
  isCodex2ApiLoginOnlyModeEnabled,
  normalizeCodex2ApiLoginAccountEntries,
};
`)();

  assert.deepStrictEqual(
    api.normalizeCodex2ApiLoginAccountEntries(' Foo@Example.com | pass-1 \\ninvalid\\nbar@example.com| pass-2 '),
    [
      { email: 'foo@example.com', password: 'pass-1' },
      { email: 'bar@example.com', password: 'pass-2' },
    ]
  );
  assert.equal(
    api.formatCodex2ApiLoginAccountEntries([
      { email: 'alpha@example.com', password: 'pass-1' },
      { email: 'beta@example.com', password: 'pass-2' },
    ]),
    'alpha@example.com | pass-1\nbeta@example.com | pass-2'
  );
  assert.equal(api.isCodex2ApiLoginOnlyModeEnabled(), true);
  assert.equal(api.getCodex2ApiLoginAccountPoolSize(), 2);
  assert.equal(api.getLockedRunCountFromEmailPool(), 2);
  assert.equal(api.getRunCountValue(), 2);
});
