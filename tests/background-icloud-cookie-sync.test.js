const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractConstArray(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`const ${escapedName} = \\[(.*?)\\];`, 's'));
  if (!match) {
    throw new Error(`missing const ${name}`);
  }
  const values = [];
  for (const entry of match[1].matchAll(/'([^']+)'/g)) {
    values.push(entry[1]);
  }
  return values;
}

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
  extractFunction('scoreIcloudPageTab'),
  extractFunction('getOrderedIcloudPageTabs'),
  extractFunction('syncIcloudAuthCookiesToServiceHost'),
].join('\n');

function createApi(overrides = {}) {
  return new Function('overrides', `
const ICLOUD_AUTH_COOKIE_NAMES = ${JSON.stringify(extractConstArray('ICLOUD_AUTH_COOKIE_NAMES'))};
const calls = {
  debuggerAttach: [],
  debuggerDetach: [],
  debuggerSendCommand: [],
  getAll: [],
  getPartitionKey: [],
  logs: [],
  set: [],
  queryTabs: [],
};

function normalizeIcloudHost(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'icloud.com' || normalized === 'setup.icloud.com' || normalized === 'www.icloud.com'
    ? 'icloud.com'
    : normalized === 'icloud.com.cn' || normalized === 'setup.icloud.com.cn' || normalized === 'www.icloud.com.cn'
      ? 'icloud.com.cn'
      : '';
}

async function addLog(message, level = 'info') {
  calls.logs.push({ message, level });
}

const chrome = {
  debugger: {
    async attach(target, version) {
      calls.debuggerAttach.push({ target, version });
      return overrides.debuggerAttach ? overrides.debuggerAttach(target, version) : undefined;
    },
    async detach(target) {
      calls.debuggerDetach.push(target);
      return overrides.debuggerDetach ? overrides.debuggerDetach(target) : undefined;
    },
    async sendCommand(target, method, params) {
      calls.debuggerSendCommand.push({ target, method, params });
      return overrides.debuggerSendCommand ? overrides.debuggerSendCommand(target, method, params) : {};
    },
  },
  tabs: {
    async query(details) {
      calls.queryTabs.push(details);
      return overrides.queryTabs ? overrides.queryTabs(details) : [];
    },
  },
  cookies: {
    async getAll(details) {
      calls.getAll.push(details);
      return overrides.getAll ? overrides.getAll(details) : [];
    },
    async getPartitionKey(details) {
      calls.getPartitionKey.push(details);
      return overrides.getPartitionKey ? overrides.getPartitionKey(details) : {};
    },
    async set(details) {
      calls.set.push(details);
      return overrides.set ? overrides.set(details) : details;
    },
  },
};

${bundle}

return {
  calls,
  syncIcloudAuthCookiesToServiceHost,
};
`)(overrides);
}

test('ICLOUD_AUTH_COOKIE_NAMES includes the broader Apple auth cookies required by maildomainws mutations', () => {
  const cookieNames = extractConstArray('ICLOUD_AUTH_COOKIE_NAMES');

  assert.deepEqual(
    cookieNames.filter((name) => [
      'X-APPLE-WEBAUTH-USER',
      'X-APPLE-WEBAUTH-TOKEN',
      'X-APPLE-WEBAUTH-HSA-TRUST',
      'X-APPLE-WEBAUTH-LOGIN',
      'X-APPLE-WEBAUTH-VALIDATE',
      'X-APPLE-WEBAUTH-PCS-Mail',
      'X-APPLE-DS-WEB-SESSION-TOKEN',
      'X-APPLE-WEB-ID',
      'X-APPLE-UNIQUE-CLIENT-ID',
    ].includes(name)),
    [
      'X-APPLE-WEBAUTH-USER',
      'X-APPLE-WEBAUTH-TOKEN',
      'X-APPLE-WEBAUTH-HSA-TRUST',
      'X-APPLE-WEBAUTH-LOGIN',
      'X-APPLE-WEBAUTH-VALIDATE',
      'X-APPLE-WEBAUTH-PCS-Mail',
      'X-APPLE-DS-WEB-SESSION-TOKEN',
      'X-APPLE-WEB-ID',
      'X-APPLE-UNIQUE-CLIENT-ID',
    ]
  );
});

test('syncIcloudAuthCookiesToServiceHost copies Apple web auth cookies onto the maildomainws host', async () => {
  const api = createApi({
    async getAll(details) {
      if (details.name === 'X-APPLE-WEBAUTH-USER') {
        return [{
          name: 'X-APPLE-WEBAUTH-USER',
          value: 'v=1:s=1:d=123',
          domain: 'www.icloud.com',
          path: '/',
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: 'no_restriction',
          storeId: '0',
        }];
      }
      if (details.name === 'X-APPLE-WEBAUTH-TOKEN') {
        return [{
          name: 'X-APPLE-WEBAUTH-TOKEN',
          value: 'v=2:t=abc',
          domain: 'setup.icloud.com',
          path: '/',
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: 'no_restriction',
          storeId: '0',
        }];
      }
      return [];
    },
  });

  await api.syncIcloudAuthCookiesToServiceHost('https://p178-maildomainws.icloud.com:443/v1/hme/generate');

  assert.equal(api.calls.getAll.length >= 2, true);
  assert.deepEqual(
    api.calls.set.map((entry) => ({
      url: entry.url,
      name: entry.name,
      value: entry.value,
      storeId: entry.storeId,
    })),
    [
      {
        url: 'https://p178-maildomainws.icloud.com/',
        name: 'X-APPLE-WEBAUTH-USER',
        value: 'v=1:s=1:d=123',
        storeId: '0',
      },
      {
        url: 'https://p178-maildomainws.icloud.com/',
        name: 'X-APPLE-WEBAUTH-TOKEN',
        value: 'v=2:t=abc',
        storeId: '0',
      },
    ]
  );
});

test('syncIcloudAuthCookiesToServiceHost falls back to the other iCloud family when the target family has no matching cookie', async () => {
  const api = createApi({
    async getAll(details) {
      if (details.name === 'X-APPLE-WEBAUTH-USER') {
        return [{
          name: 'X-APPLE-WEBAUTH-USER',
          value: 'cn-session',
          domain: 'www.icloud.com.cn',
          path: '/',
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: 'no_restriction',
          storeId: '0',
        }];
      }
      return [];
    },
  });

  await api.syncIcloudAuthCookiesToServiceHost('https://p178-maildomainws.icloud.com:443/v1/hme/generate');

  assert.deepEqual(
    api.calls.set.map((entry) => ({
      url: entry.url,
      name: entry.name,
      value: entry.value,
    })),
    [{
      url: 'https://p178-maildomainws.icloud.com/',
      name: 'X-APPLE-WEBAUTH-USER',
      value: 'cn-session',
    }]
  );
});

test('syncIcloudAuthCookiesToServiceHost copies the broader Apple session cookie set used by generate requests', async () => {
  const cookiesByName = {
    'X-APPLE-WEBAUTH-USER': 'user-cookie',
    'X-APPLE-WEBAUTH-TOKEN': 'token-cookie',
    'X-APPLE-WEBAUTH-HSA-TRUST': 'trust-cookie',
    'X-APPLE-WEBAUTH-LOGIN': 'login-cookie',
    'X-APPLE-WEBAUTH-VALIDATE': 'validate-cookie',
    'X-APPLE-WEBAUTH-PCS-Mail': 'pcs-mail-cookie',
    'X-APPLE-DS-WEB-SESSION-TOKEN': 'session-token-cookie',
    'X-APPLE-WEB-ID': 'web-id-cookie',
    'X-APPLE-UNIQUE-CLIENT-ID': 'unique-client-cookie',
  };
  const api = createApi({
    async getAll(details) {
      const value = cookiesByName[details.name];
      if (!value) {
        return [];
      }
      return [{
        name: details.name,
        value,
        domain: '.icloud.com',
        path: '/',
        secure: true,
        httpOnly: true,
        session: true,
        sameSite: 'no_restriction',
        storeId: '0',
      }];
    },
  });

  await api.syncIcloudAuthCookiesToServiceHost('https://p178-maildomainws.icloud.com:443/v1/hme/generate');

  assert.deepEqual(
    api.calls.set.map((entry) => entry.name),
    [
      'X-APPLE-WEBAUTH-USER',
      'X-APPLE-WEBAUTH-TOKEN',
      'X-APPLE-WEBAUTH-HSA-TRUST',
      'X-APPLE-WEBAUTH-LOGIN',
      'X-APPLE-WEBAUTH-VALIDATE',
      'X-APPLE-WEBAUTH-PCS-Mail',
      'X-APPLE-DS-WEB-SESSION-TOKEN',
      'X-APPLE-WEB-ID',
      'X-APPLE-UNIQUE-CLIENT-ID',
    ]
  );
});

test('syncIcloudAuthCookiesToServiceHost also copies auth cookies onto setup hosts for cross-host validate requests', async () => {
  const api = createApi({
    async getAll(details) {
      if (details.name === 'X-APPLE-WEBAUTH-USER') {
        return [{
          name: 'X-APPLE-WEBAUTH-USER',
          value: 'user-cookie',
          domain: '.icloud.com',
          path: '/',
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: 'no_restriction',
          storeId: '0',
        }];
      }
      return [];
    },
  });

  await api.syncIcloudAuthCookiesToServiceHost('https://setup.icloud.com.cn/setup/ws/1/validate');

  assert.deepEqual(
    api.calls.set.map((entry) => ({
      url: entry.url,
      name: entry.name,
      value: entry.value,
    })),
    [{
      url: 'https://setup.icloud.com.cn/',
      name: 'X-APPLE-WEBAUTH-USER',
      value: 'user-cookie',
    }]
  );
});

test('syncIcloudAuthCookiesToServiceHost forces synced auth cookies to SameSite=None for extension fetches', async () => {
  const api = createApi({
    async getAll(details) {
      if (details.name === 'X-APPLE-WEBAUTH-USER') {
        return [{
          name: 'X-APPLE-WEBAUTH-USER',
          value: 'strict-user-cookie',
          domain: '.icloud.com',
          path: '/',
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: 'strict',
          storeId: '0',
        }];
      }
      return [];
    },
  });

  await api.syncIcloudAuthCookiesToServiceHost('https://setup.icloud.com/setup/ws/1/validate');

  assert.deepEqual(
    api.calls.set.map((entry) => ({
      name: entry.name,
      sameSite: entry.sameSite,
      secure: entry.secure,
    })),
    [{
      name: 'X-APPLE-WEBAUTH-USER',
      sameSite: 'no_restriction',
      secure: true,
    }]
  );
});

test('syncIcloudAuthCookiesToServiceHost falls back to partitioned cookies from the open iCloud tab when unpartitioned lookups are empty', async () => {
  const api = createApi({
    async queryTabs() {
      return [{
        id: 17,
        active: true,
        url: 'https://www.icloud.com/icloudplus/',
      }];
    },
    async getAll(details) {
      if (!details.partitionKey) {
        return [];
      }
      if (details.name === 'X-APPLE-WEBAUTH-USER'
        && details.partitionKey.topLevelSite === 'https://www.icloud.com'
        && details.url === 'https://www.icloud.com/') {
        return [{
          name: 'X-APPLE-WEBAUTH-USER',
          value: 'partitioned-user-cookie',
          domain: 'www.icloud.com',
          path: '/',
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: 'no_restriction',
          storeId: '0',
          partitionKey: {
            topLevelSite: 'https://www.icloud.com',
          },
        }];
      }
      return [];
    },
  });

  await api.syncIcloudAuthCookiesToServiceHost('https://setup.icloud.com/setup/ws/1/validate');

  assert.deepEqual(
    api.calls.set.map((entry) => ({
      url: entry.url,
      name: entry.name,
      value: entry.value,
      partitionKey: entry.partitionKey,
    })),
    [{
      url: 'https://setup.icloud.com/',
      name: 'X-APPLE-WEBAUTH-USER',
      value: 'partitioned-user-cookie',
      partitionKey: undefined,
    }]
  );
  assert.equal(api.calls.queryTabs.length, 1);
  assert.equal(api.calls.getAll.some((details) => Boolean(details.partitionKey)), true);
});

test('syncIcloudAuthCookiesToServiceHost also checks path-specific setup URLs for partitioned auth cookies', async () => {
  const api = createApi({
    async queryTabs() {
      return [{
        id: 17,
        active: true,
        url: 'https://www.icloud.com/icloudplus/',
      }];
    },
    async getAll(details) {
      if (!details.partitionKey) {
        return [];
      }
      if (details.name === 'X-APPLE-WEBAUTH-USER'
        && details.partitionKey.topLevelSite === 'https://www.icloud.com'
        && details.url === 'https://setup.icloud.com/setup/ws/1/validate') {
        return [{
          name: 'X-APPLE-WEBAUTH-USER',
          value: 'path-bound-user-cookie',
          domain: 'setup.icloud.com',
          path: '/setup/ws/1',
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: 'no_restriction',
          storeId: '0',
          partitionKey: {
            topLevelSite: 'https://www.icloud.com',
          },
        }];
      }
      return [];
    },
  });

  await api.syncIcloudAuthCookiesToServiceHost('https://setup.icloud.com/setup/ws/1/validate');

  assert.deepEqual(
    api.calls.set.map((entry) => ({
      url: entry.url,
      name: entry.name,
      value: entry.value,
      path: entry.path,
    })),
    [{
      url: 'https://setup.icloud.com/',
      name: 'X-APPLE-WEBAUTH-USER',
      value: 'path-bound-user-cookie',
      path: '/setup/ws/1',
    }]
  );
  assert.equal(
    api.calls.getAll.some((details) => details.url === 'https://setup.icloud.com/setup/ws/1/validate'),
    true
  );
});

test('syncIcloudAuthCookiesToServiceHost falls back to debugger Network.getCookies when chrome.cookies lookups miss the iCloud auth cookies', async () => {
  const api = createApi({
    async queryTabs() {
      return [{
        id: 17,
        active: true,
        url: 'https://www.icloud.com/icloudplus/',
      }];
    },
    async getAll() {
      return [];
    },
    async debuggerSendCommand(_target, method, params) {
      if (method !== 'Network.getCookies') {
        return {};
      }
      assert.deepEqual(params, {
        urls: [
          'https://www.icloud.com/icloudplus/',
          'https://www.icloud.com/',
          'https://setup.icloud.com/',
          'https://setup.icloud.com/setup/ws/1/',
          'https://setup.icloud.com/setup/ws/1/validate',
        ],
      });
      return {
        cookies: [{
          name: 'X-APPLE-WEBAUTH-USER',
          value: 'debugger-user-cookie',
          domain: '.icloud.com',
          path: '/',
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: 'Lax',
        }],
      };
    },
  });

  await api.syncIcloudAuthCookiesToServiceHost('https://setup.icloud.com/setup/ws/1/validate');

  assert.deepEqual(
    api.calls.set.map((entry) => ({
      url: entry.url,
      name: entry.name,
      value: entry.value,
      httpOnly: entry.httpOnly,
      sameSite: entry.sameSite,
    })),
    [{
      url: 'https://setup.icloud.com/',
      name: 'X-APPLE-WEBAUTH-USER',
      value: 'debugger-user-cookie',
      httpOnly: true,
      sameSite: 'no_restriction',
    }]
  );
  assert.equal(api.calls.debuggerAttach.length, 1);
  assert.equal(api.calls.debuggerSendCommand.some((call) => call.method === 'Network.getCookies'), true);
  assert.equal(api.calls.debuggerDetach.length, 1);
});
