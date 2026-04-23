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
  extractFunction('isIcloudLoginRequiredError'),
  extractFunction('promptIcloudLogin'),
  extractFunction('withIcloudLoginHelp'),
  extractFunction('scoreIcloudPageTab'),
  extractFunction('getOrderedIcloudPageTabs'),
  extractFunction('resolveIcloudPremiumMailServiceForSetupUrl'),
  extractFunction('resolveIcloudPremiumMailService'),
].join('\n');

function createApi(overrides = {}) {
  return new Function('overrides', `
let lastIcloudLoginPromptAt = 0;
const calls = {
  logs: [],
  openedUrls: [],
  sentMessages: [],
  setState: [],
  validateCalls: [],
  queryCalls: [],
  executeScriptCalls: [],
};

function normalizeIcloudHost(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'icloud.com' || normalized === 'setup.icloud.com' || normalized === 'www.icloud.com'
    ? 'icloud.com'
    : normalized === 'icloud.com.cn' || normalized === 'setup.icloud.com.cn' || normalized === 'www.icloud.com.cn'
      ? 'icloud.com.cn'
      : '';
}
function getErrorMessage(error) {
  return String(typeof error === 'string' ? error : error?.message || '');
}
async function getPreferredIcloudLoginUrl(error) {
  return overrides.getPreferredIcloudLoginUrl
    ? overrides.getPreferredIcloudLoginUrl(error)
    : 'https://www.icloud.com/';
}
async function addLog(message, level = 'info') {
  calls.logs.push({ message, level });
}
async function openIcloudLoginPage(url) {
  calls.openedUrls.push(url);
}
async function getState() {
  return overrides.getState ? overrides.getState() : {};
}
async function getPreferredIcloudSetupUrls(state) {
  return overrides.getPreferredIcloudSetupUrls
    ? overrides.getPreferredIcloudSetupUrls(state)
    : ['https://setup.icloud.com/setup/ws/1'];
}
async function validateIcloudSession(setupUrl) {
  calls.validateCalls.push(setupUrl);
  if (overrides.validateIcloudSession) {
    return overrides.validateIcloudSession(setupUrl);
  }
  throw new Error('missing validateIcloudSession override');
}
async function setState(payload) {
  calls.setState.push(payload);
}

const chrome = {
  runtime: {
    sendMessage(payload) {
      calls.sentMessages.push(payload);
      return Promise.resolve();
    },
  },
  tabs: {
    async query(details) {
      calls.queryCalls.push(details);
      return overrides.queryTabs ? overrides.queryTabs(details) : [];
    },
  },
  scripting: {
    async executeScript(details) {
      calls.executeScriptCalls.push(details);
      if (overrides.executeScript) {
        return overrides.executeScript(details);
      }
      return [];
    },
  },
};

${bundle}

return {
  calls,
  isIcloudLoginRequiredError,
  promptIcloudLogin,
  withIcloudLoginHelp,
  resolveIcloudPremiumMailService,
};
`)(overrides);
}

test('promptIcloudLogin opens the iCloud+ page instead of the generic root page', async () => {
  const api = createApi({
    getPreferredIcloudLoginUrl() {
      return 'https://www.icloud.com.cn/';
    },
  });

  await api.promptIcloudLogin(new Error('status 401'), '检查 iCloud 会话');

  assert.equal(api.calls.sentMessages[0]?.payload?.loginUrl, 'https://www.icloud.com.cn/icloudplus/');
  assert.deepEqual(api.calls.openedUrls, ['https://www.icloud.com.cn/icloudplus/']);
});

test('resolveIcloudPremiumMailService uses background validation first even when an iCloud page is already open', async () => {
  const api = createApi({
    async getState() {
      return { preferredIcloudHost: '' };
    },
    async getPreferredIcloudSetupUrls() {
      return ['https://setup.icloud.com/setup/ws/1'];
    },
    async validateIcloudSession() {
      return {
        webservices: {
          premiummailsettings: {
            url: 'https://p1-mailws.icloud.com/',
          },
        },
      };
    },
    async queryTabs() {
      return [
        { id: 17, active: true, url: 'https://www.icloud.com/icloudplus/' },
      ];
    },
    async executeScript() {
      return [{
        result: {
          ok: true,
          data: {
            webservices: {
              premiummailsettings: {
                url: 'https://p1-mailws.icloud.com/',
              },
            },
          },
        },
      }];
    },
  });

  assert.deepEqual(
    await api.resolveIcloudPremiumMailService(),
    {
      setupUrl: 'https://setup.icloud.com/setup/ws/1',
      serviceUrl: 'https://p1-mailws.icloud.com',
    }
  );
  assert.equal(api.calls.validateCalls.length, 1);
  assert.equal(api.calls.queryCalls.length, 0);
  assert.equal(api.calls.executeScriptCalls.length, 0);
  assert.deepEqual(api.calls.setState, [{ preferredIcloudHost: 'icloud.com' }]);
});

test('resolveIcloudPremiumMailService falls back to page-context validation when background validation fails', async () => {
  const api = createApi({
    async getState() {
      return { preferredIcloudHost: '' };
    },
    async getPreferredIcloudSetupUrls() {
      return ['https://setup.icloud.com/setup/ws/1'];
    },
    async validateIcloudSession() {
      throw new Error('Could not validate iCloud session. status 401');
    },
    async queryTabs() {
      return [
        { id: 17, active: true, url: 'https://www.icloud.com/icloudplus/' },
      ];
    },
    async executeScript() {
      return [{
        result: {
          ok: true,
          data: {
            webservices: {
              premiummailsettings: {
                url: 'https://p1-mailws.icloud.com/',
              },
            },
          },
        },
      }];
    },
  });

  assert.deepEqual(
    await api.resolveIcloudPremiumMailService(),
    {
      setupUrl: 'https://setup.icloud.com/setup/ws/1',
      serviceUrl: 'https://p1-mailws.icloud.com',
    }
  );
  assert.equal(api.calls.validateCalls.length, 1);
  assert.equal(api.calls.queryCalls.length, 1);
  assert.equal(api.calls.executeScriptCalls.length, 1);
});

test('withIcloudLoginHelp does not misreport Hide My Email unavailability as a login problem', async () => {
  const api = createApi();

  await assert.rejects(
    api.withIcloudLoginHelp('检查 iCloud 会话', async () => {
      throw new Error('Could not validate iCloud session. Hide My Email service was unavailable.');
    }),
    /Hide My Email|iCloud\+|隐藏邮件地址/
  );
  assert.equal(api.calls.sentMessages.length, 0);
  assert.equal(api.calls.openedUrls.length, 0);
});
