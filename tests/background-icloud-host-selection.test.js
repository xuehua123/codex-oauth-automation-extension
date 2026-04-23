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

function extractConst(name) {
  const match = source.match(new RegExp(`const ${name} = \\[[\\s\\S]*?\\];`));
  if (!match) {
    throw new Error(`missing const ${name}`);
  }
  return match[0];
}

const bundle = [
  extractConst('ICLOUD_SETUP_URLS'),
  extractConst('ICLOUD_LOGIN_URLS'),
  extractFunction('getPreferredIcloudLoginUrl'),
  extractFunction('getPreferredIcloudSetupUrls'),
].join('\n');

function createApi(overrides = {}) {
  return new Function('overrides', `
function normalizeIcloudHost(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'icloud.com' || normalized === 'icloud.com.cn' ? normalized : '';
}
function getConfiguredIcloudHostPreference(state) {
  return normalizeIcloudHost(state?.icloudHostPreference);
}
function getIcloudHostHintFromMessage(message = '') {
  return overrides.getIcloudHostHintFromMessage ? overrides.getIcloudHostHintFromMessage(message) : '';
}
function getIcloudLoginUrlForHost(host) {
  return host === 'icloud.com.cn' ? 'https://www.icloud.com.cn/' : host === 'icloud.com' ? 'https://www.icloud.com/' : '';
}
function getIcloudSetupUrlForHost(host) {
  return host === 'icloud.com.cn' ? 'https://setup.icloud.com.cn/setup/ws/1' : host === 'icloud.com' ? 'https://setup.icloud.com/setup/ws/1' : '';
}
function getErrorMessage(error) {
  return String(typeof error === 'string' ? error : error?.message || '');
}
async function getState() {
  return overrides.getState ? overrides.getState() : {};
}
async function getOpenIcloudHostPreference() {
  return overrides.getOpenIcloudHostPreference ? overrides.getOpenIcloudHostPreference() : '';
}

${bundle}

return {
  getPreferredIcloudLoginUrl,
  getPreferredIcloudSetupUrls,
};
`)(overrides);
}

test('getPreferredIcloudLoginUrl defaults to icloud.com in auto mode without stronger signals', async () => {
  const api = createApi();

  assert.equal(
    await api.getPreferredIcloudLoginUrl(null, { icloudHostPreference: 'auto' }),
    'https://www.icloud.com/'
  );
});

test('getPreferredIcloudLoginUrl keeps manual icloud.com.cn preference', async () => {
  const api = createApi();

  assert.equal(
    await api.getPreferredIcloudLoginUrl(null, { icloudHostPreference: 'icloud.com.cn' }),
    'https://www.icloud.com.cn/'
  );
});

test('getPreferredIcloudLoginUrl prefers saved host over an error-message hint in auto mode', async () => {
  const api = createApi({
    getIcloudHostHintFromMessage() {
      return 'icloud.com.cn';
    },
  });

  assert.equal(
    await api.getPreferredIcloudLoginUrl(new Error('Please log in to icloud.com.cn'), {
      icloudHostPreference: 'auto',
      preferredIcloudHost: 'icloud.com',
    }),
    'https://www.icloud.com/'
  );
});

test('getPreferredIcloudLoginUrl prefers the open iCloud tab host over an error-message hint in auto mode', async () => {
  const api = createApi({
    getIcloudHostHintFromMessage() {
      return 'icloud.com.cn';
    },
    async getOpenIcloudHostPreference() {
      return 'icloud.com';
    },
  });

  assert.equal(
    await api.getPreferredIcloudLoginUrl(new Error('Please log in to icloud.com.cn'), {
      icloudHostPreference: 'auto',
    }),
    'https://www.icloud.com/'
  );
});

test('getPreferredIcloudLoginUrl lets the currently open iCloud host override a stale saved host in auto mode', async () => {
  const api = createApi({
    async getOpenIcloudHostPreference() {
      return 'icloud.com';
    },
  });

  assert.equal(
    await api.getPreferredIcloudLoginUrl(null, {
      icloudHostPreference: 'auto',
      preferredIcloudHost: 'icloud.com.cn',
    }),
    'https://www.icloud.com/'
  );
});

test('getPreferredIcloudSetupUrls keeps both setup endpoints and puts the preferred host first', async () => {
  const api = createApi({
    getIcloudHostHintFromMessage() {
      return 'icloud.com.cn';
    },
  });

  assert.deepEqual(
    await api.getPreferredIcloudSetupUrls({
      icloudHostPreference: 'auto',
      preferredIcloudHost: 'icloud.com',
    }, new Error('Please log in to icloud.com.cn')),
    [
      'https://setup.icloud.com/setup/ws/1',
      'https://setup.icloud.com.cn/setup/ws/1',
    ]
  );
});
