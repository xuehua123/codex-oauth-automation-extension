const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
  extractFunction('getIcloudBusinessErrorMessage'),
  extractFunction('shouldFallbackToAppleAccountAliases'),
  extractFunction('isAppleAccountLoginRequiredError'),
  extractFunction('shouldRetryIcloudOnAlternateHost'),
  extractFunction('runIcloudActionWithAutoHostFallback'),
  extractFunction('promptAppleAccountLogin'),
  extractFunction('listAppleAccountAliases'),
  extractFunction('fetchIcloudHideMyEmail'),
].join('\n');

function createApi(overrides = {}) {
  return new Function('overrides', `
let lastAppleAccountLoginPromptAt = 0;
const calls = {
  logs: [],
  requests: [],
  appleRequests: [],
  appleLoginPrompts: [],
  setState: [],
  resolveCalls: [],
  resolveForSetupCalls: [],
  emails: [],
  broadcasts: [],
  runtimeMessages: [],
};

function getErrorMessage(error) {
  return String(typeof error === 'string' ? error : error?.message || '');
}
function normalizeIcloudHost(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'icloud.com' || normalized === 'setup.icloud.com' || normalized === 'www.icloud.com'
    ? 'icloud.com'
    : normalized === 'icloud.com.cn' || normalized === 'setup.icloud.com.cn' || normalized === 'www.icloud.com.cn'
      ? 'icloud.com.cn'
      : '';
}
function getConfiguredIcloudHostPreference(state = {}) {
  const normalized = String(state?.icloudHostPreference || '').trim().toLowerCase();
  return normalized === 'icloud.com' || normalized === 'icloud.com.cn' ? normalized : '';
}
async function withIcloudLoginHelp(_label, action) {
  return action();
}
function throwIfStopped() {}
async function addLog(message, level = 'info') {
  calls.logs.push({ message, level });
}
async function getState() {
  return overrides.getState ? overrides.getState() : {};
}
function getEffectiveUsedEmails(state = {}) {
  return state.usedEmails || [];
}
function getPreservedAliasMap(state = {}) {
  return state.preservedAliases || {};
}
async function resolveIcloudPremiumMailService() {
  calls.resolveCalls.push(true);
  if (overrides.resolveIcloudPremiumMailService) {
    return overrides.resolveIcloudPremiumMailService();
  }
  throw new Error('missing resolveIcloudPremiumMailService override');
}
async function getPreferredIcloudSetupUrls(state) {
  return overrides.getPreferredIcloudSetupUrls ? overrides.getPreferredIcloudSetupUrls(state) : [];
}
async function resolveIcloudPremiumMailServiceForSetupUrl(setupUrl, state, options) {
  calls.resolveForSetupCalls.push({ setupUrl, state, options });
  if (overrides.resolveIcloudPremiumMailServiceForSetupUrl) {
    return overrides.resolveIcloudPremiumMailServiceForSetupUrl(setupUrl, state, options);
  }
  throw new Error('missing resolveIcloudPremiumMailServiceForSetupUrl override');
}
async function icloudRequest(method, url, options) {
  calls.requests.push({ method, url, options });
  if (overrides.icloudRequest) {
    return overrides.icloudRequest(method, url, options);
  }
  throw new Error('missing icloudRequest override');
}
function normalizeIcloudAliasList(response, options = {}) {
  if (overrides.normalizeIcloudAliasList) {
    return overrides.normalizeIcloudAliasList(response, options);
  }
  const items = response?.result?.hmeEmails || response?.hmeEmails || [];
  return items.map((item) => ({
    email: String(item.hme || item.email || '').trim().toLowerCase(),
    anonymousId: String(item.anonymousId || '').trim(),
    active: item.active !== false && item.isActive !== false,
    used: Boolean((options.usedEmails || []).includes(String(item.hme || item.email || '').trim().toLowerCase())),
    preserved: Boolean(options.preservedEmails?.[String(item.hme || item.email || '').trim().toLowerCase()]),
  })).filter((item) => item.email);
}
function normalizeAppleAccountAliasList(response, options = {}) {
  if (overrides.normalizeAppleAccountAliasList) {
    return overrides.normalizeAppleAccountAliasList(response, options);
  }
  const items = response?.privateEmailList || [];
  return items.map((item) => ({
    email: String(item.emailAddress || '').trim().toLowerCase(),
    anonymousId: String(item.id || '').trim(),
    active: item.active !== false,
    used: Boolean((options.usedEmails || []).includes(String(item.emailAddress || '').trim().toLowerCase())),
    preserved: Boolean(options.preservedEmails?.[String(item.emailAddress || '').trim().toLowerCase()]),
    source: 'apple-account',
  })).filter((item) => item.email);
}
function pickReusableIcloudAlias(aliases = []) {
  return (aliases || []).find((alias) => alias.active && !alias.used) || null;
}
async function appleAccountRequest(method, url, options) {
  calls.appleRequests.push({ method, url, options });
  if (overrides.appleAccountRequest) {
    return overrides.appleAccountRequest(method, url, options);
  }
  throw new Error('missing appleAccountRequest override');
}
async function openAppleAccountPrivacyPage(url) {
  calls.appleLoginPrompts.push(url);
}
async function setEmailState(email) {
  calls.emails.push(email);
}
function broadcastIcloudAliasesChanged(payload) {
  calls.broadcasts.push(payload);
}
function getIcloudAliasLabel() {
  return 'MultiPage 2026-04-21';
}
async function setState(payload) {
  calls.setState.push(payload);
}
const chrome = {
  runtime: {
    sendMessage(payload) {
      calls.runtimeMessages.push(payload);
      return Promise.resolve();
    },
  },
};

${bundle}

return {
  calls,
  fetchIcloudHideMyEmail,
};
`)(overrides);
}

test('fetchIcloudHideMyEmail reuses aliases from the alternate host when auto mode gets a permission error on the primary host', async () => {
  const api = createApi({
    async getState() {
      return {
        icloudHostPreference: 'auto',
        preferredIcloudHost: 'icloud.com',
        usedEmails: [],
        preservedAliases: {},
      };
    },
    async resolveIcloudPremiumMailService() {
      return {
        setupUrl: 'https://setup.icloud.com/setup/ws/1',
        serviceUrl: 'https://p1-maildomainws.icloud.com',
      };
    },
    async getPreferredIcloudSetupUrls() {
      return [
        'https://setup.icloud.com/setup/ws/1',
        'https://setup.icloud.com.cn/setup/ws/1',
      ];
    },
    async resolveIcloudPremiumMailServiceForSetupUrl(setupUrl) {
      if (setupUrl === 'https://setup.icloud.com.cn/setup/ws/1') {
        return {
          setupUrl,
          serviceUrl: 'https://p8-maildomainws.icloud.com.cn',
        };
      }
      throw new Error(`unexpected setup url: ${setupUrl}`);
    },
    async icloudRequest(_method, url) {
      if (url === 'https://p1-maildomainws.icloud.com/v2/hme/list') {
        return {
          success: false,
          error: {
            errorMessage: 'Your account does not have permission to access this application.',
          },
        };
      }
      if (url === 'https://p8-maildomainws.icloud.com.cn/v2/hme/list') {
        return {
          success: true,
          result: {
            hmeEmails: [
              {
                hme: 'reused@icloud.com',
                anonymousId: 'anon-reused',
                isActive: true,
              },
            ],
          },
        };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.equal(await api.fetchIcloudHideMyEmail(), 'reused@icloud.com');
  assert.deepEqual(api.calls.emails, ['reused@icloud.com']);
  assert.deepEqual(api.calls.setState, [{ preferredIcloudHost: 'icloud.com.cn' }]);
  assert.deepEqual(api.calls.broadcasts, [{ reason: 'selected', email: 'reused@icloud.com' }]);
});

test('fetchIcloudHideMyEmail retries generate on the alternate host after a primary-host HME auth failure', async () => {
  const api = createApi({
    async getState() {
      return {
        icloudHostPreference: 'auto',
        preferredIcloudHost: 'icloud.com',
        usedEmails: [],
        preservedAliases: {},
      };
    },
    async resolveIcloudPremiumMailService() {
      return {
        setupUrl: 'https://setup.icloud.com/setup/ws/1',
        serviceUrl: 'https://p1-maildomainws.icloud.com',
      };
    },
    async getPreferredIcloudSetupUrls() {
      return [
        'https://setup.icloud.com/setup/ws/1',
        'https://setup.icloud.com.cn/setup/ws/1',
      ];
    },
    async resolveIcloudPremiumMailServiceForSetupUrl(setupUrl) {
      if (setupUrl === 'https://setup.icloud.com.cn/setup/ws/1') {
        return {
          setupUrl,
          serviceUrl: 'https://p8-maildomainws.icloud.com.cn',
        };
      }
      throw new Error(`unexpected setup url: ${setupUrl}`);
    },
    async icloudRequest(method, url) {
      if (url === 'https://p1-maildomainws.icloud.com/v2/hme/list') {
        return {
          success: true,
          result: {
            hmeEmails: [],
          },
        };
      }
      if (url === 'https://p1-maildomainws.icloud.com/v1/hme/generate') {
        throw new Error('iCloud 请求失败：POST https://p1-maildomainws.icloud.com/v1/hme/generate，status 401，Missing X-APPLE-WEBAUTH-USER cookie');
      }
      if (url === 'https://p8-maildomainws.icloud.com.cn/v2/hme/list') {
        return {
          success: true,
          result: {
            hmeEmails: [],
          },
        };
      }
      if (url === 'https://p8-maildomainws.icloud.com.cn/v1/hme/generate') {
        return {
          success: true,
          result: {
            hme: 'fresh@icloud.com',
          },
        };
      }
      if (method === 'POST' && url === 'https://p8-maildomainws.icloud.com.cn/v1/hme/reserve') {
        return {
          success: true,
          result: {
            hme: {
              hme: 'fresh@icloud.com',
            },
          },
        };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.equal(await api.fetchIcloudHideMyEmail(), 'fresh@icloud.com');
  assert.deepEqual(api.calls.emails, ['fresh@icloud.com']);
  assert.deepEqual(api.calls.setState, [{ preferredIcloudHost: 'icloud.com.cn' }]);
  assert.deepEqual(api.calls.broadcasts, [{ reason: 'created', email: 'fresh@icloud.com' }]);
});

test('fetchIcloudHideMyEmail reuses Apple Account private-email aliases when HME APIs are unavailable', async () => {
  const api = createApi({
    async getState() {
      return {
        icloudHostPreference: 'auto',
        preferredIcloudHost: 'icloud.com',
        usedEmails: ['used@icloud.com'],
        preservedAliases: {},
      };
    },
    async resolveIcloudPremiumMailService() {
      return {
        setupUrl: 'https://setup.icloud.com/setup/ws/1',
        serviceUrl: 'https://p1-maildomainws.icloud.com',
      };
    },
    async getPreferredIcloudSetupUrls() {
      return [
        'https://setup.icloud.com/setup/ws/1',
        'https://setup.icloud.com.cn/setup/ws/1',
      ];
    },
    async resolveIcloudPremiumMailServiceForSetupUrl(setupUrl) {
      return {
        setupUrl,
        serviceUrl: setupUrl.includes('.cn')
          ? 'https://p8-maildomainws.icloud.com.cn'
          : 'https://p1-maildomainws.icloud.com',
      };
    },
    async icloudRequest() {
      return {
        success: false,
        error: {
          errorMessage: 'Your account does not have permission to access this application.',
        },
      };
    },
    async appleAccountRequest(_method, url) {
      assert.equal(url, 'https://appleid.apple.com/account/manage/email/private');
      return {
        privateEmailList: [
          {
            id: 'used-1',
            emailAddress: 'used@icloud.com',
            active: true,
          },
          {
            id: 'fresh-1',
            emailAddress: 'fresh@icloud.com',
            active: true,
          },
        ],
      };
    },
  });

  assert.equal(await api.fetchIcloudHideMyEmail(), 'fresh@icloud.com');
  assert.deepEqual(api.calls.emails, ['fresh@icloud.com']);
  assert.deepEqual(api.calls.broadcasts, [{ reason: 'selected', email: 'fresh@icloud.com' }]);
  assert.equal(api.calls.appleRequests.length, 1);
});

test('fetchIcloudHideMyEmail prefers reusing Apple Account aliases without probing HME again once the session has been marked as apple-account-first', async () => {
  const api = createApi({
    async getState() {
      return {
        icloudHostPreference: 'auto',
        preferredIcloudHost: 'icloud.com',
        preferredIcloudAliasSource: 'apple-account',
        usedEmails: ['used@icloud.com'],
        preservedAliases: {},
      };
    },
    async appleAccountRequest(_method, url) {
      assert.equal(url, 'https://appleid.apple.com/account/manage/email/private');
      return {
        privateEmailList: [
          {
            id: 'used-1',
            emailAddress: 'used@icloud.com',
            active: true,
          },
          {
            id: 'fresh-1',
            emailAddress: 'fresh@icloud.com',
            active: true,
          },
        ],
      };
    },
  });

  assert.equal(await api.fetchIcloudHideMyEmail(), 'fresh@icloud.com');
  assert.deepEqual(api.calls.emails, ['fresh@icloud.com']);
  assert.deepEqual(api.calls.broadcasts, [{ reason: 'selected', email: 'fresh@icloud.com' }]);
  assert.equal(api.calls.resolveCalls.length, 0);
  assert.equal(api.calls.requests.length, 0);
  assert.equal(api.calls.appleRequests.length, 1);
});

test('fetchIcloudHideMyEmail prompts for Apple Account login when HME is unavailable and Apple Account aliases cannot be read yet', async () => {
  const api = createApi({
    async getState() {
      return {
        icloudHostPreference: 'auto',
        preferredIcloudHost: 'icloud.com',
        usedEmails: [],
        preservedAliases: {},
      };
    },
    async resolveIcloudPremiumMailService() {
      throw new Error('Could not validate iCloud session. setup.icloud.com: iCloud 请求失败：POST https://setup.icloud.com/setup/ws/1/validate，status 421');
    },
    async appleAccountRequest() {
      throw new Error('Apple Account 请求失败：GET https://appleid.apple.com/account/manage/email/private，status 401');
    },
  });

  await assert.rejects(
    api.fetchIcloudHideMyEmail(),
    /Apple Account 页面中完成登录/
  );
  assert.deepEqual(
    api.calls.appleLoginPrompts,
    ['https://account.apple.com/account/manage/section/privacy']
  );
  assert.equal(api.calls.runtimeMessages[0]?.type, 'ICLOUD_LOGIN_REQUIRED');
  assert.equal(api.calls.runtimeMessages[0]?.payload?.loginContext, 'apple-account');
});
