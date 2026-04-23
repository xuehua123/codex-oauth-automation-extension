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
  extractFunction('shouldRetryIcloudOnAlternateHost'),
  extractFunction('runIcloudActionWithAutoHostFallback'),
].join('\n');

function createApi(overrides = {}) {
  return new Function('overrides', `
const calls = {
  logs: [],
  setState: [],
  resolveForSetupCalls: [],
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
async function addLog(message, level = 'info') {
  calls.logs.push({ message, level });
}
async function setState(payload) {
  calls.setState.push(payload);
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

${bundle}

return {
  calls,
  shouldRetryIcloudOnAlternateHost,
  runIcloudActionWithAutoHostFallback,
};
`)(overrides);
}

test('shouldRetryIcloudOnAlternateHost matches permission and HME auth failures', () => {
  const api = createApi();

  assert.equal(
    api.shouldRetryIcloudOnAlternateHost(new Error('Your account does not have permission to access this application.')),
    true
  );
  assert.equal(
    api.shouldRetryIcloudOnAlternateHost(new Error('iCloud 请求失败：POST https://p178-maildomainws.icloud.com/v1/hme/generate，status 401，Missing X-APPLE-WEBAUTH-USER cookie')),
    true
  );
  assert.equal(
    api.shouldRetryIcloudOnAlternateHost(new Error('iCloud 请求失败：POST https://p178-maildomainws.icloud.com/v1/hme/generate，status 409，Maximum aliases reached')),
    false
  );
});

test('runIcloudActionWithAutoHostFallback retries the alternate host in auto mode after a permission error', async () => {
  const api = createApi({
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
  });

  const primaryService = {
    setupUrl: 'https://setup.icloud.com/setup/ws/1',
    serviceUrl: 'https://p178-maildomainws.icloud.com',
  };
  const attempts = [];
  const result = await api.runIcloudActionWithAutoHostFallback(
    {
      icloudHostPreference: 'auto',
      preferredIcloudHost: 'icloud.com',
    },
    primaryService,
    async (service) => {
      attempts.push(service.setupUrl);
      if (service.setupUrl === primaryService.setupUrl) {
        throw new Error('Your account does not have permission to access this application.');
      }
      return { ok: true, host: service.setupUrl };
    },
    {
      actionLabel: '加载 iCloud 隐私邮箱列表',
    }
  );

  assert.deepEqual(attempts, [
    'https://setup.icloud.com/setup/ws/1',
    'https://setup.icloud.com.cn/setup/ws/1',
  ]);
  assert.deepEqual(result, {
    ok: true,
    host: 'https://setup.icloud.com.cn/setup/ws/1',
  });
  assert.deepEqual(api.calls.setState, [{ preferredIcloudHost: 'icloud.com.cn' }]);
  assert.equal(
    api.calls.logs.some((entry) => /切换到 icloud\.com\.cn/i.test(entry.message)),
    true
  );
});

test('runIcloudActionWithAutoHostFallback temporarily retries the alternate host even when a manual host preference is set', async () => {
  const api = createApi({
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
  });

  const primaryService = {
    setupUrl: 'https://setup.icloud.com/setup/ws/1',
    serviceUrl: 'https://p178-maildomainws.icloud.com',
  };
  const attempts = [];

  assert.deepEqual(
    await api.runIcloudActionWithAutoHostFallback(
      {
        icloudHostPreference: 'icloud.com',
        preferredIcloudHost: 'icloud.com',
      },
      primaryService,
      async (service) => {
        attempts.push(service.setupUrl);
        if (service.setupUrl === primaryService.setupUrl) {
          throw new Error('Your account does not have permission to access this application.');
        }
        return { ok: true, host: service.setupUrl };
      },
      {
        actionLabel: '加载 iCloud 隐私邮箱列表',
      }
    ),
    { ok: true, host: 'https://setup.icloud.com.cn/setup/ws/1' }
  );

  assert.deepEqual(attempts, [
    'https://setup.icloud.com/setup/ws/1',
    'https://setup.icloud.com.cn/setup/ws/1',
  ]);
  assert.equal(api.calls.resolveForSetupCalls.length, 1);
  assert.equal(api.calls.setState.length, 0);
});

test('runIcloudActionWithAutoHostFallback still rethrows non-retryable errors when a manual host preference is set', async () => {
  const api = createApi({
    async getPreferredIcloudSetupUrls() {
      return [
        'https://setup.icloud.com/setup/ws/1',
        'https://setup.icloud.com.cn/setup/ws/1',
      ];
    },
  });

  const primaryService = {
    setupUrl: 'https://setup.icloud.com/setup/ws/1',
    serviceUrl: 'https://p178-maildomainws.icloud.com',
  };

  await assert.rejects(
    api.runIcloudActionWithAutoHostFallback(
      {
        icloudHostPreference: 'icloud.com',
        preferredIcloudHost: 'icloud.com',
      },
      primaryService,
      async () => {
        throw new Error('iCloud 请求失败：POST https://p178-maildomainws.icloud.com/v1/hme/generate，status 409，Maximum aliases reached');
      },
      {
        actionLabel: '加载 iCloud 隐私邮箱列表',
      }
    ),
    /maximum aliases reached/i
  );
});

test('runIcloudActionWithAutoHostFallback surfaces alternate-host failure details when fallback also fails', async () => {
  const api = createApi({
    async getPreferredIcloudSetupUrls() {
      return [
        'https://setup.icloud.com/setup/ws/1',
        'https://setup.icloud.com.cn/setup/ws/1',
      ];
    },
    async resolveIcloudPremiumMailServiceForSetupUrl(setupUrl) {
      if (setupUrl === 'https://setup.icloud.com.cn/setup/ws/1') {
        throw new Error('status 401 on setup.icloud.com.cn validate');
      }
      throw new Error(`unexpected setup url: ${setupUrl}`);
    },
  });

  const primaryService = {
    setupUrl: 'https://setup.icloud.com/setup/ws/1',
    serviceUrl: 'https://p178-maildomainws.icloud.com',
  };

  await assert.rejects(
    api.runIcloudActionWithAutoHostFallback(
      {
        icloudHostPreference: 'auto',
        preferredIcloudHost: 'icloud.com',
      },
      primaryService,
      async () => {
        throw new Error('Your account does not have permission to access this application.');
      },
      {
        actionLabel: '加载 iCloud 隐私邮箱列表',
      }
    ),
    /permission to access this application.*icloud\.com\.cn.*401/i
  );
});
