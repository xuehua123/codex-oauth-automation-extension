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
  extractFunction('listIcloudAliases'),
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
async function icloudRequest(method, url) {
  calls.requests.push({ method, url });
  if (overrides.icloudRequest) {
    return overrides.icloudRequest(method, url);
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
async function addLog(message, level = 'info') {
  calls.logs.push({ message, level });
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
  listIcloudAliases,
};
`)(overrides);
}

test('listIcloudAliases surfaces iCloud list API business errors instead of returning an empty array', async () => {
  const api = createApi({
    async getState() {
      return {
        icloudHostPreference: 'auto',
        preferredIcloudHost: 'icloud.com',
      };
    },
    async resolveIcloudPremiumMailService() {
      return {
        setupUrl: 'https://setup.icloud.com/setup/ws/1',
        serviceUrl: 'https://p1-maildomainws.icloud.com',
      };
    },
    async icloudRequest() {
      return {
        success: false,
        error: {
          errorMessage: 'Hide My Email alias list is unavailable right now',
        },
      };
    },
  });

  await assert.rejects(
    api.listIcloudAliases(),
    /alias list is unavailable/i
  );
});

test('listIcloudAliases falls back to the alternate iCloud host when auto mode gets an empty list from the primary host', async () => {
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
          success: true,
          result: { hmeEmails: [] },
        };
      }
      if (url === 'https://p8-maildomainws.icloud.com.cn/v2/hme/list') {
        return {
          success: true,
          result: {
            hmeEmails: [
              {
                hme: 'visible@icloud.com',
                anonymousId: 'anon-visible',
                isActive: true,
              },
            ],
          },
        };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.deepEqual(
    await api.listIcloudAliases(),
    [
      {
        email: 'visible@icloud.com',
        anonymousId: 'anon-visible',
        active: true,
        used: false,
        preserved: false,
      },
    ]
  );
  assert.equal(api.calls.requests.length, 2);
  assert.deepEqual(api.calls.setState, [{ preferredIcloudHost: 'icloud.com.cn' }]);
  assert.equal(
    api.calls.logs.some((entry) => /切换到 .*icloud\.com\.cn/i.test(entry.message)),
    true
  );
});

test('listIcloudAliases falls back to the alternate iCloud host when auto mode gets a permission error from the primary host', async () => {
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
                hme: 'fallback@icloud.com',
                anonymousId: 'anon-fallback',
                isActive: true,
              },
            ],
          },
        };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.deepEqual(
    await api.listIcloudAliases(),
    [
      {
        email: 'fallback@icloud.com',
        anonymousId: 'anon-fallback',
        active: true,
        used: false,
        preserved: false,
      },
    ]
  );
  assert.deepEqual(api.calls.setState, [{ preferredIcloudHost: 'icloud.com.cn' }]);
  assert.equal(
    api.calls.logs.some((entry) => /切换到 .*icloud\.com\.cn/i.test(entry.message)),
    true
  );
});

test('listIcloudAliases falls back to Apple Account private-email aliases when HME access is denied on every iCloud host', async () => {
  const api = createApi({
    async getState() {
      return {
        icloudHostPreference: 'auto',
        preferredIcloudHost: 'icloud.com',
        usedEmails: ['used@icloud.com'],
        preservedAliases: { 'preserved@icloud.com': true },
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
            id: 'fresh-1',
            emailAddress: 'fresh@icloud.com',
            active: true,
          },
          {
            id: 'used-1',
            emailAddress: 'used@icloud.com',
            active: true,
          },
          {
            id: 'preserved-1',
            emailAddress: 'preserved@icloud.com',
            active: false,
          },
        ],
      };
    },
  });

  assert.deepEqual(
    await api.listIcloudAliases(),
    [
      {
        email: 'fresh@icloud.com',
        anonymousId: 'fresh-1',
        active: true,
        used: false,
        preserved: false,
        source: 'apple-account',
      },
      {
        email: 'used@icloud.com',
        anonymousId: 'used-1',
        active: true,
        used: true,
        preserved: false,
        source: 'apple-account',
      },
      {
        email: 'preserved@icloud.com',
        anonymousId: 'preserved-1',
        active: false,
        used: false,
        preserved: true,
        source: 'apple-account',
      },
    ]
  );
  assert.equal(api.calls.appleRequests.length, 1);
  assert.equal(
    api.calls.logs.some((entry) => /apple 账户|apple account/i.test(entry.message)),
    true
  );
});

test('listIcloudAliases prefers the Apple Account alias list without probing HME again once the session has been marked as apple-account-first', async () => {
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
            id: 'fresh-1',
            emailAddress: 'fresh@icloud.com',
            active: true,
          },
          {
            id: 'used-1',
            emailAddress: 'used@icloud.com',
            active: true,
          },
        ],
      };
    },
  });

  assert.deepEqual(
    await api.listIcloudAliases(),
    [
      {
        email: 'fresh@icloud.com',
        anonymousId: 'fresh-1',
        active: true,
        used: false,
        preserved: false,
        source: 'apple-account',
      },
      {
        email: 'used@icloud.com',
        anonymousId: 'used-1',
        active: true,
        used: true,
        preserved: false,
        source: 'apple-account',
      },
    ]
  );
  assert.equal(api.calls.resolveCalls.length, 0);
  assert.equal(api.calls.requests.length, 0);
  assert.equal(api.calls.appleRequests.length, 1);
});

test('listIcloudAliases prompts for Apple Account login instead of iCloud login when HME is unavailable and the Apple Account session is missing', async () => {
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
    api.listIcloudAliases(),
    /Apple Account 页面中完成登录/
  );
  assert.deepEqual(
    api.calls.appleLoginPrompts,
    ['https://account.apple.com/account/manage/section/privacy']
  );
  assert.equal(api.calls.runtimeMessages[0]?.type, 'ICLOUD_LOGIN_REQUIRED');
  assert.equal(api.calls.runtimeMessages[0]?.payload?.loginContext, 'apple-account');
});
