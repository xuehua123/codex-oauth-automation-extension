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
  extractFunction('buildIcloudHttpErrorMessage'),
  extractFunction('scoreIcloudPageTab'),
  extractFunction('getOrderedIcloudPageTabs'),
  extractFunction('icloudRequest'),
  extractFunction('isIcloudLoginRequiredError'),
].join('\n');

function createApi(overrides = {}) {
  return new Function('overrides', `
const calls = {
  fetches: [],
  queryCalls: [],
  executeScriptCalls: [],
  logs: [],
  synced: [],
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
async function addLog(message, level = 'info') {
  calls.logs.push({ message, level });
}
async function getState() {
  return overrides.getState ? overrides.getState() : {};
}
async function syncIcloudAuthCookiesToServiceHost(url) {
  calls.synced.push(url);
}
async function fetch(url, init) {
  calls.fetches.push({ url, init });
  if (overrides.fetch) {
    return overrides.fetch(url, init);
  }
  throw new Error('missing fetch override');
}

const chrome = {
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
  buildIcloudHttpErrorMessage,
  icloudRequest,
  isIcloudLoginRequiredError,
};
`)(overrides);
}

test('buildIcloudHttpErrorMessage includes server-side JSON error details', () => {
  const api = createApi();

  assert.equal(
    api.buildIcloudHttpErrorMessage(
      'POST',
      'https://p1-mailws.icloud.com/v1/hme/generate',
      409,
      JSON.stringify({ error: { errorMessage: 'Maximum aliases reached' } })
    ),
    'iCloud 请求失败：POST https://p1-mailws.icloud.com/v1/hme/generate，status 409，Maximum aliases reached'
  );
});

test('isIcloudLoginRequiredError only treats validate or list auth failures as login-required', () => {
  const api = createApi();

  assert.equal(
    api.isIcloudLoginRequiredError('iCloud 请求失败：POST https://setup.icloud.com/setup/ws/1/validate，status 401'),
    true
  );
  assert.equal(
    api.isIcloudLoginRequiredError('iCloud 请求失败：GET https://p1-mailws.icloud.com/v2/hme/list，status 403'),
    true
  );
  assert.equal(
    api.isIcloudLoginRequiredError('iCloud 请求失败：POST https://p1-mailws.icloud.com/v1/hme/generate，status 409，Maximum aliases reached'),
    false
  );
});

test('icloudRequest falls back to page-context fetch for hme endpoints when background fetch fails', async () => {
  const api = createApi({
    async getState() {
      return { preferredIcloudHost: 'icloud.com' };
    },
    async fetch() {
      return {
        ok: false,
        status: 401,
        async text() {
          return '{"error":{"errorMessage":"missing session in extension context"}}';
        },
      };
    },
    async queryTabs() {
      return [
        { id: 5, active: true, url: 'https://www.icloud.com/icloudplus/' },
      ];
    },
    async executeScript() {
      return [{
        result: {
          ok: true,
          data: {
            success: true,
            result: {
              hme: 'alias@icloud.com',
            },
          },
        },
      }];
    },
  });

  const result = await api.icloudRequest('POST', 'https://p1-mailws.icloud.com/v1/hme/generate');
  assert.deepEqual(result, {
    success: true,
    result: {
      hme: 'alias@icloud.com',
    },
  });
  assert.equal(api.calls.queryCalls.length, 1);
  assert.equal(api.calls.executeScriptCalls.length, 1);
});

test('icloudRequest syncs auth cookies before validate requests', async () => {
  const api = createApi({
    async fetch() {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            webservices: {
              premiummailsettings: {
                url: 'https://p1-maildomainws.icloud.com/',
              },
            },
          });
        },
      };
    },
  });

  const result = await api.icloudRequest('POST', 'https://setup.icloud.com.cn/setup/ws/1/validate');

  assert.deepEqual(result, {
    webservices: {
      premiummailsettings: {
        url: 'https://p1-maildomainws.icloud.com/',
      },
    },
  });
  assert.deepEqual(api.calls.synced, ['https://setup.icloud.com.cn/setup/ws/1/validate']);
});

test('icloudRequest uses the iCloud+ page as referrer for setup validate requests', async () => {
  const api = createApi({
    async fetch() {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            webservices: {
              premiummailsettings: {
                url: 'https://p1-maildomainws.icloud.com/',
              },
            },
          });
        },
      };
    },
  });

  await api.icloudRequest('POST', 'https://setup.icloud.com/setup/ws/1/validate');

  assert.equal(
    api.calls.fetches[0]?.init?.referrer,
    'https://www.icloud.com/icloudplus/'
  );
  assert.equal(
    api.calls.fetches[0]?.init?.referrerPolicy,
    'strict-origin-when-cross-origin'
  );
});
