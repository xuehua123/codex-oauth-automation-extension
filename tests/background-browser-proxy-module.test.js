const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadBrowserProxyModule() {
  const source = fs.readFileSync('background/browser-proxy.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundBrowserProxy;`)(globalScope);
}

test('background imports browser proxy module and persists browser proxy settings', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  assert.match(source, /importScripts\([\s\S]*'background\/browser-proxy\.js'/);
  assert.match(source, /browserProxyEnabled:\s*false/);
  assert.match(source, /browserProxySpec:\s*''/);
});

test('background initializes browserProxyManager before registering proxy listeners', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const managerIndex = source.indexOf('const browserProxyManager = self.MultiPageBackgroundBrowserProxy?.createBrowserProxyManager(');
  const authListenerIndex = source.indexOf('if (chrome.webRequest?.onAuthRequired && browserProxyManager?.handleAuthRequiredAsync) {');
  const errorListenerIndex = source.indexOf('if (chrome.proxy?.onProxyError && browserProxyManager?.handleProxyError) {');

  assert.ok(managerIndex >= 0, 'browserProxyManager should be declared');
  assert.ok(authListenerIndex >= 0, 'proxy auth listener should exist');
  assert.ok(errorListenerIndex >= 0, 'proxy error listener should exist');
  assert.ok(managerIndex < authListenerIndex, 'browserProxyManager must be initialized before auth listener registration');
  assert.ok(managerIndex < errorListenerIndex, 'browserProxyManager must be initialized before proxy error listener registration');
});

test('manifest grants browser proxy and auth permissions', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

  assert.ok(manifest.permissions.includes('proxy'));
  assert.ok(manifest.permissions.includes('webRequest'));
  assert.ok(manifest.permissions.includes('webRequestAuthProvider'));
});

test('browser proxy module exposes a factory', () => {
  const api = loadBrowserProxyModule();

  assert.equal(typeof api?.createBrowserProxyManager, 'function');
  assert.equal(typeof api?.parseBrowserProxySpec, 'function');
  assert.equal(typeof api?.buildProxyConfig, 'function');
});

test('browser proxy module parses host port username password specs', () => {
  const api = loadBrowserProxyModule();

  assert.deepStrictEqual(
    api.parseBrowserProxySpec(' proxyus.starryproxy.com:10000:accountId-5103-tunnelId-9067-area-us:7oqHU8 '),
    {
      host: 'proxyus.starryproxy.com',
      port: 10000,
      username: 'accountId-5103-tunnelId-9067-area-us',
      password: '7oqHU8',
    }
  );
  assert.equal(api.parseBrowserProxySpec('missing:parts'), null);
  assert.equal(api.parseBrowserProxySpec('proxy.example.com:not-a-port:user:pass'), null);
});

test('browser proxy module builds fixed server config with local bypass rules', () => {
  const api = loadBrowserProxyModule();
  const config = api.buildProxyConfig({
    host: 'proxyus.starryproxy.com',
    port: 10000,
    username: 'user',
    password: 'pass',
  });

  assert.deepStrictEqual(config, {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: 'http',
        host: 'proxyus.starryproxy.com',
        port: 10000,
      },
      bypassList: [
        '<local>',
        'localhost',
        '127.0.0.1',
        '[::1]',
        '*.local',
        'host.docker.internal',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '169.254.0.0/16',
      ],
    },
  });
});

test('browser proxy manager applies proxy config and only answers matching proxy auth challenges', async () => {
  const api = loadBrowserProxyModule();
  const calls = [];
  const manager = api.createBrowserProxyManager({
    chrome: {
      proxy: {
        settings: {
          set: async (payload) => {
            calls.push({ type: 'set', payload });
          },
          clear: async (payload) => {
            calls.push({ type: 'clear', payload });
          },
        },
      },
    },
    addLog: async () => {},
    getState: async () => ({
      browserProxyEnabled: true,
      browserProxySpec: 'proxyus.starryproxy.com:10000:accountId-5103-tunnelId-9067-area-us:7oqHU8',
    }),
  });

  await manager.syncBrowserProxyFromState();

  assert.deepStrictEqual(calls, [
    {
      type: 'set',
      payload: {
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: {
              scheme: 'http',
              host: 'proxyus.starryproxy.com',
              port: 10000,
            },
            bypassList: [
              '<local>',
              'localhost',
              '127.0.0.1',
              '[::1]',
              '*.local',
              'host.docker.internal',
              '10.0.0.0/8',
              '172.16.0.0/12',
              '192.168.0.0/16',
              '169.254.0.0/16',
            ],
          },
        },
        scope: 'regular',
      },
    },
  ]);

  assert.deepStrictEqual(
    manager.handleAuthRequired({
      isProxy: true,
      challenger: { host: 'proxyus.starryproxy.com', port: 10000 },
      requestId: 'proxy-auth-1',
    }),
    {
      authCredentials: {
        username: 'accountId-5103-tunnelId-9067-area-us',
        password: '7oqHU8',
      },
    }
  );
  assert.equal(
    manager.handleAuthRequired({
      isProxy: false,
      challenger: { host: 'proxyus.starryproxy.com', port: 10000 },
      requestId: 'site-auth-1',
    }),
    undefined
  );
  assert.equal(
    manager.handleAuthRequired({
      isProxy: true,
      challenger: { host: 'proxy.example.com', port: 10000 },
      requestId: 'proxy-auth-2',
    }),
    undefined
  );
});

test('browser proxy manager does not warn when the proxy switch is on but the spec is still empty', async () => {
  const api = loadBrowserProxyModule();
  const calls = [];
  const manager = api.createBrowserProxyManager({
    chrome: {
      proxy: {
        settings: {
          set: async () => {
            calls.push({ type: 'set' });
          },
          clear: async () => {
            calls.push({ type: 'clear' });
          },
        },
      },
    },
    addLog: async (message, level) => {
      calls.push({ type: 'log', message, level });
    },
    getState: async () => ({
      browserProxyEnabled: true,
      browserProxySpec: '',
    }),
  });

  const result = await manager.syncBrowserProxyFromState();

  assert.deepStrictEqual(result, {
    enabled: false,
    reason: 'missing',
  });
  assert.deepStrictEqual(calls, [
    { type: 'clear' },
  ]);
});
