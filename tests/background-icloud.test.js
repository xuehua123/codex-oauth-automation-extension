const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const source = fs.readFileSync('background.js', 'utf8');

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

const bundle = [
  extractFunction('normalizeEmailGenerator'),
  extractFunction('getEmailGeneratorLabel'),
  extractFunction('isIcloudListMode'),
  extractFunction('normalizeVerificationResendCount'),
  extractFunction('normalizePersistentSettingValue'),
  extractFunction('getIcloudListEntries'),
  extractFunction('setIcloudListEntriesState'),
  extractFunction('setEmailStateSilently'),
  extractFunction('finalizeIcloudAliasAfterSuccessfulFlow'),
  extractFunction('finalizeIcloudListEntryAfterSuccessfulFlow'),
].join('\n');

function createApi(overrides = {}) {
  return new Function('overrides', `
const HOTMAIL_PROVIDER = 'hotmail-api';
const ICLOUD_LIST_PROVIDER = 'icloud-list';
const HOTMAIL_SERVICE_MODE_LOCAL = 'local';
const CLOUDFLARE_TEMP_EMAIL_GENERATOR = 'cloudflare-temp-email';
const DEFAULT_LOCAL_CPA_STEP9_MODE = 'submit';
const DEFAULT_HOTMAIL_REMOTE_BASE_URL = '';
const DEFAULT_HOTMAIL_LOCAL_BASE_URL = 'http://127.0.0.1:17373';
const DEFAULT_VERIFICATION_RESEND_COUNT = 4;
const VERIFICATION_RESEND_COUNT_MIN = 0;
const VERIFICATION_RESEND_COUNT_MAX = 20;
const PERSISTED_SETTING_DEFAULTS = {
  mailProvider: '163',
  autoStepDelaySeconds: null,
};

const calls = {
  broadcasts: [],
  setUsed: [],
  setState: [],
  setPersistentSettings: [],
  logs: [],
  deletes: [],
  listCalls: 0,
};

function normalizeIcloudHost(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['icloud.com', 'icloud.com.cn'].includes(normalized) ? normalized : '';
}
function normalizePanelMode(value = '') {
  return String(value || '').trim().toLowerCase() === 'sub2api' ? 'sub2api' : 'cpa';
}
function normalizeMailProvider(value = '') {
  return String(value || '').trim().toLowerCase() || '163';
}
function normalizeAutoRunFallbackThreadIntervalMinutes(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}
function normalizeAutoRunDelayMinutes(value) {
  return Math.max(1, Math.floor(Number(value) || 30));
}
function normalizeAutoStepDelaySeconds(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}
function normalizeHotmailServiceMode() {
  return HOTMAIL_SERVICE_MODE_LOCAL;
}
function normalizeHotmailRemoteBaseUrl(value = '') {
  return String(value || '').trim() || DEFAULT_HOTMAIL_REMOTE_BASE_URL;
}
function normalizeHotmailLocalBaseUrl(value = '') {
  return String(value || '').trim() || DEFAULT_HOTMAIL_LOCAL_BASE_URL;
}
function normalizeCloudflareDomain(value = '') {
  return String(value || '').trim().toLowerCase();
}
function normalizeCloudflareDomains(values = []) {
  return Array.isArray(values) ? values : [];
}
function normalizeCloudflareTempEmailAddress(value = '') {
  return String(value || '').trim().toLowerCase();
}
function normalizeCloudflareTempEmailReceiveMailbox(value = '') {
  const normalized = normalizeCloudflareTempEmailAddress(value);
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalized) ? normalized : '';
}
function normalizeIcloudListEmail(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalized) ? normalized : '';
}
function normalizeIcloudListEntries(values = []) {
  return Array.isArray(values) ? values : [];
}
function normalizeHotmailAccounts(values = []) {
  return Array.isArray(values) ? values : [];
}
function resolveIcloudListCurrentEntry(entries = [], state = {}) {
  const targetEmail = normalizeIcloudListEmail(state?.email)
    || normalizeIcloudListEmail(state?.currentIcloudListEmail);
  if (!targetEmail) {
    return null;
  }
  return (Array.isArray(entries) ? entries : []).find((entry) => entry?.email === targetEmail) || null;
}
function getManualAliasUsageMap(state) {
  return { ...(state?.manualAliasUsage || {}) };
}
function getPreservedAliasMap(state) {
  return { ...(state?.preservedAliases || {}) };
}
function isAliasPreserved(state, email) {
  return Boolean(getPreservedAliasMap(state)[String(email || '').trim().toLowerCase()]);
}
async function setIcloudAliasUsedState(payload, options = {}) {
  calls.setUsed.push({ payload, options });
}
async function addLog(message, level = 'info') {
  calls.logs.push({ message, level });
}
async function deleteIcloudAlias(alias) {
  calls.deletes.push(alias);
}
async function listIcloudAliases() {
  calls.listCalls += 1;
  return overrides.listIcloudAliases ? overrides.listIcloudAliases() : [];
}
async function getState() {
  return overrides.getState ? overrides.getState() : (overrides.state || {});
}
async function setPersistentSettings(payload) {
  calls.setPersistentSettings.push(payload);
}
async function setState(payload) {
  calls.setState.push(payload);
}
function broadcastDataUpdate(payload) {
  calls.broadcasts.push(payload);
}
function findIcloudAliasByEmail(aliases, email) {
  return (aliases || []).find((alias) => String(alias.email || '').toLowerCase() === String(email || '').toLowerCase()) || null;
}
function findIcloudListEntryByEmail(entries = [], email = '') {
  const normalizedEmail = normalizeIcloudListEmail(email);
  if (!normalizedEmail) {
    return null;
  }
  return (Array.isArray(entries) ? entries : []).find((entry) => String(entry?.email || '').toLowerCase() === normalizedEmail) || null;
}
function patchIcloudListEntry(entries = [], email = '', updates = {}) {
  const normalizedEmail = normalizeIcloudListEmail(email);
  if (!normalizedEmail) {
    return normalizeIcloudListEntries(entries);
  }
  return normalizeIcloudListEntries((Array.isArray(entries) ? entries : []).map((entry) => {
    if ((entry?.email || '') !== normalizedEmail) {
      return entry;
    }
    return { ...entry, ...updates };
  }));
}
function getErrorMessage(error) {
  return String(typeof error === 'string' ? error : error?.message || '');
}

${bundle}

  return {
  calls,
  normalizeEmailGenerator,
  getEmailGeneratorLabel,
  normalizePersistentSettingValue,
  setEmailStateSilently,
  setIcloudListEntriesState,
  finalizeIcloudListEntryAfterSuccessfulFlow,
  finalizeIcloudAliasAfterSuccessfulFlow,
};
`)(overrides);
}

test('normalizeEmailGenerator and label support icloud', () => {
  const api = createApi();
  assert.equal(api.normalizeEmailGenerator('icloud'), 'icloud');
  assert.equal(api.getEmailGeneratorLabel('icloud'), 'iCloud 隐私邮箱');
  assert.equal(api.normalizeEmailGenerator('icloud-list'), 'icloud-list');
  assert.equal(api.getEmailGeneratorLabel('icloud-list'), 'iCloud 列表');
});

test('normalizePersistentSettingValue handles icloud settings', () => {
  const api = createApi();
  assert.equal(api.normalizePersistentSettingValue('icloudHostPreference', 'icloud.com'), 'icloud.com');
  assert.equal(api.normalizePersistentSettingValue('icloudHostPreference', 'bad-host'), 'auto');
  assert.equal(api.normalizePersistentSettingValue('autoDeleteUsedIcloudAlias', 1), true);
  assert.equal(api.normalizePersistentSettingValue('verificationResendCount', '6'), 6);
  assert.equal(api.normalizePersistentSettingValue('verificationResendCount', 99), 20);
  assert.equal(api.normalizePersistentSettingValue('cloudflareTempEmailReceiveMailbox', ' Forward@Example.com '), 'forward@example.com');
  assert.equal(api.normalizePersistentSettingValue('currentIcloudListEmail', ' Fresh@icloud.com '), 'fresh@icloud.com');
  assert.deepEqual(api.normalizePersistentSettingValue('icloudListEntries', [{ email: 'a@icloud.com' }]), [{ email: 'a@icloud.com' }]);
});

test('finalizeIcloudAliasAfterSuccessfulFlow marks icloud aliases as used without deleting when auto-delete is off', async () => {
  const api = createApi();
  const result = await api.finalizeIcloudAliasAfterSuccessfulFlow({
    email: 'alias@icloud.com',
    emailGenerator: 'icloud',
    autoDeleteUsedIcloudAlias: false,
    manualAliasUsage: {},
    preservedAliases: {},
  });

  assert.deepEqual(result, { handled: true, deleted: false });
  assert.equal(api.calls.setUsed.length, 1);
  assert.equal(api.calls.listCalls, 0);
  assert.equal(api.calls.deletes.length, 0);
});

test('finalizeIcloudAliasAfterSuccessfulFlow skips deleting preserved aliases', async () => {
  const api = createApi();
  const result = await api.finalizeIcloudAliasAfterSuccessfulFlow({
    email: 'alias@icloud.com',
    emailGenerator: 'icloud',
    autoDeleteUsedIcloudAlias: true,
    manualAliasUsage: {},
    preservedAliases: { 'alias@icloud.com': true },
  });

  assert.deepEqual(result, { handled: true, deleted: false });
  assert.equal(api.calls.setUsed.length, 1);
  assert.equal(api.calls.listCalls, 0);
  assert.equal(api.calls.deletes.length, 0);
});

test('finalizeIcloudAliasAfterSuccessfulFlow skips deleting aliases that are preserved in the latest alias list', async () => {
  const api = createApi({
    listIcloudAliases() {
      return [
        { email: 'alias@icloud.com', anonymousId: 'anon-1', preserved: true },
      ];
    },
  });

  const result = await api.finalizeIcloudAliasAfterSuccessfulFlow({
    email: 'alias@icloud.com',
    emailGenerator: 'icloud',
    autoDeleteUsedIcloudAlias: true,
    manualAliasUsage: {},
    preservedAliases: {},
  });

  assert.deepEqual(result, { handled: true, deleted: false });
  assert.equal(api.calls.setUsed.length, 1);
  assert.equal(api.calls.listCalls, 1);
  assert.equal(api.calls.deletes.length, 0);
});

test('finalizeIcloudAliasAfterSuccessfulFlow deletes alias when auto-delete is enabled and alias exists', async () => {
  const api = createApi({
    listIcloudAliases() {
      return [
        { email: 'alias@icloud.com', anonymousId: 'anon-1', preserved: false },
      ];
    },
  });

  const result = await api.finalizeIcloudAliasAfterSuccessfulFlow({
    email: 'alias@icloud.com',
    emailGenerator: 'icloud',
    autoDeleteUsedIcloudAlias: true,
    manualAliasUsage: {},
    preservedAliases: {},
  });

  assert.deepEqual(result, { handled: true, deleted: true });
  assert.equal(api.calls.setUsed.length, 1);
  assert.equal(api.calls.listCalls, 1);
  assert.deepEqual(api.calls.deletes, [
    { email: 'alias@icloud.com', anonymousId: 'anon-1', preserved: false },
  ]);
});

test('finalizeIcloudAliasAfterSuccessfulFlow skips deleting Apple Account aliases returned by the fallback list', async () => {
  const api = createApi({
    listIcloudAliases() {
      return [
        { email: 'alias@icloud.com', anonymousId: 'anon-1', preserved: false, source: 'apple-account' },
      ];
    },
  });

  const result = await api.finalizeIcloudAliasAfterSuccessfulFlow({
    email: 'alias@icloud.com',
    emailGenerator: 'icloud',
    autoDeleteUsedIcloudAlias: true,
    manualAliasUsage: {},
    preservedAliases: {},
  });

  assert.deepEqual(result, { handled: true, deleted: false });
  assert.equal(api.calls.setUsed.length, 1);
  assert.equal(api.calls.listCalls, 1);
  assert.equal(api.calls.deletes.length, 0);
});

test('finalizeIcloudAliasAfterSuccessfulFlow ignores non-icloud flows', async () => {
  const api = createApi();
  const result = await api.finalizeIcloudAliasAfterSuccessfulFlow({
    email: 'plain@example.com',
    emailGenerator: 'duck',
    autoDeleteUsedIcloudAlias: true,
    manualAliasUsage: {},
    preservedAliases: {},
  });

  assert.deepEqual(result, { handled: false, deleted: false });
  assert.equal(api.calls.setUsed.length, 0);
});

test('setIcloudListEntriesState clears a stale active email when the current list row disappears', async () => {
  const api = createApi({
    state: {
      email: 'gone@icloud.com',
      currentIcloudListEmail: 'gone@icloud.com',
      emailGenerator: 'icloud-list',
      mailProvider: '163',
    },
  });

  const nextEntries = [
    { email: 'keep@icloud.com', codeUrl: 'https://example.com/code/keep' },
  ];

  await api.setIcloudListEntriesState(nextEntries);

  assert.deepEqual(api.calls.setPersistentSettings, [
    {
      icloudListEntries: nextEntries,
      currentIcloudListEmail: '',
    },
  ]);
  assert.deepEqual(api.calls.setState, [
    {
      icloudListEntries: nextEntries,
      currentIcloudListEmail: null,
      email: null,
    },
  ]);
  assert.deepEqual(api.calls.broadcasts, [
    {
      icloudListEntries: nextEntries,
      currentIcloudListEmail: null,
      email: null,
    },
  ]);
});

test('setEmailStateSilently clears currentIcloudListEmail after leaving iCloud-list mode', async () => {
  const api = createApi({
    state: {
      email: 'old@icloud.com',
      currentIcloudListEmail: 'old@icloud.com',
      emailGenerator: 'duck',
      mailProvider: '163',
    },
  });

  await api.setEmailStateSilently('plain@example.com');

  assert.deepEqual(api.calls.setState, [
    {
      email: 'plain@example.com',
      currentIcloudListEmail: null,
    },
  ]);
  assert.deepEqual(api.calls.setPersistentSettings, [
    {
      currentIcloudListEmail: '',
    },
  ]);
  assert.deepEqual(api.calls.broadcasts, [
    {
      email: 'plain@example.com',
      currentIcloudListEmail: null,
    },
  ]);
});

test('setEmailStateSilently updates currentIcloudListEmail when the iCloud list email changes within iCloud-list mode', async () => {
  const api = createApi({
    state: {
      email: 'old@icloud.com',
      currentIcloudListEmail: 'old@icloud.com',
      emailGenerator: 'icloud-list',
      mailProvider: '163',
      icloudListEntries: [
        { email: 'new@icloud.com', codeUrl: 'https://example.com/code/new' },
        { email: 'old@icloud.com', codeUrl: 'https://example.com/code/old' },
      ],
    },
  });

  await api.setEmailStateSilently('new@icloud.com');

  assert.deepEqual(api.calls.setState, [
    {
      email: 'new@icloud.com',
      currentIcloudListEmail: 'new@icloud.com',
    },
  ]);
  assert.deepEqual(api.calls.setPersistentSettings, [
    {
      currentIcloudListEmail: 'new@icloud.com',
    },
  ]);
});

test('finalizeIcloudListEntryAfterSuccessfulFlow marks list emails only in iCloud-list mode', async () => {
  const api = createApi({
    state: {
      email: 'plain@example.com',
      currentIcloudListEmail: 'used@icloud.com',
      emailGenerator: 'duck',
      mailProvider: '163',
      icloudListEntries: [
        {
          email: 'used@icloud.com',
          codeUrl: 'https://example.com/code/1',
          used: false,
          lastUsedAt: 0,
        },
      ],
    },
  });

  const result = await api.finalizeIcloudListEntryAfterSuccessfulFlow({
    email: 'used@icloud.com',
    currentIcloudListEmail: 'used@icloud.com',
    emailGenerator: 'duck',
    mailProvider: '163',
    icloudListEntries: [
      {
        email: 'used@icloud.com',
        codeUrl: 'https://example.com/code/1',
        used: false,
        lastUsedAt: 0,
      },
    ],
  });

  assert.deepEqual(result, { handled: false, updated: false });
  assert.equal(api.calls.setPersistentSettings.length, 0);
});

test('finalizeIcloudListEntryAfterSuccessfulFlow marks the current iCloud list row as used', async () => {
  const api = createApi({
    state: {
      email: 'used@icloud.com',
      currentIcloudListEmail: 'used@icloud.com',
      emailGenerator: 'icloud-list',
      mailProvider: '163',
      icloudListEntries: [
        {
          email: 'used@icloud.com',
          codeUrl: 'https://example.com/code/1',
          used: false,
          lastUsedAt: 0,
        },
      ],
    },
  });

  const result = await api.finalizeIcloudListEntryAfterSuccessfulFlow({
    email: 'used@icloud.com',
    mailProvider: 'icloud-list',
    icloudListEntries: [
      {
        email: 'used@icloud.com',
        codeUrl: 'https://example.com/code/1',
        used: false,
        lastUsedAt: 0,
      },
    ],
  });

  assert.deepEqual(result, { handled: true, updated: true });
  assert.equal(api.calls.setPersistentSettings.length, 1);
  assert.equal(api.calls.setPersistentSettings[0].icloudListEntries.length, 1);
  assert.equal(api.calls.setPersistentSettings[0].icloudListEntries[0].used, true);
  assert.ok(api.calls.setPersistentSettings[0].icloudListEntries[0].lastUsedAt > 0);
  const [setStatePayload] = api.calls.setState;
  assert.equal(setStatePayload.currentIcloudListEmail, 'used@icloud.com');
  assert.equal(setStatePayload.icloudListEntries[0].used, true);
  assert.ok(setStatePayload.icloudListEntries[0].lastUsedAt > 0);
});
