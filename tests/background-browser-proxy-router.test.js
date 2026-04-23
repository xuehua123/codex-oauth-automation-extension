const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createRouter(overrides = {}) {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);
  return api.createMessageRouter(overrides);
}

test('message router syncs browser proxy after saving settings', async () => {
  const calls = [];
  const router = createRouter({
    buildPersistentSettingsPayload: (payload) => payload,
    buildLuckmailSessionSettingsPayload: () => ({}),
    setPersistentSettings: async (updates) => {
      calls.push({ type: 'persist', updates });
    },
    setState: async (updates) => {
      calls.push({ type: 'state', updates });
    },
    syncBrowserProxyFromState: async (state) => {
      calls.push({ type: 'sync', state });
    },
    getState: async () => ({
      browserProxyEnabled: true,
      browserProxySpec: 'proxy.example.com:8080:user:pass',
    }),
  });

  const response = await router.handleMessage({
    type: 'SAVE_SETTING',
    payload: {
      browserProxyEnabled: true,
      browserProxySpec: 'proxy.example.com:8080:user:pass',
    },
  });

  assert.equal(response.ok, true);
  assert.deepStrictEqual(calls, [
    {
      type: 'persist',
      updates: {
        browserProxyEnabled: true,
        browserProxySpec: 'proxy.example.com:8080:user:pass',
      },
    },
    {
      type: 'state',
      updates: {
        browserProxyEnabled: true,
        browserProxySpec: 'proxy.example.com:8080:user:pass',
      },
    },
    {
      type: 'sync',
      state: {
        browserProxyEnabled: true,
        browserProxySpec: 'proxy.example.com:8080:user:pass',
      },
    },
  ]);
});

test('message router syncs browser proxy after importing settings', async () => {
  const calls = [];
  const importedState = {
    browserProxyEnabled: true,
    browserProxySpec: 'proxy.example.com:8080:user:pass',
  };
  const router = createRouter({
    importSettingsBundle: async (config) => {
      calls.push({ type: 'import', config });
      return importedState;
    },
    syncBrowserProxyFromState: async (state) => {
      calls.push({ type: 'sync', state });
    },
  });

  const response = await router.handleMessage({
    type: 'IMPORT_SETTINGS',
    payload: {
      config: { settings: {} },
    },
  });

  assert.equal(response.ok, true);
  assert.deepStrictEqual(response.state, importedState);
  assert.deepStrictEqual(calls, [
    { type: 'import', config: { settings: {} } },
    { type: 'sync', state: importedState },
  ]);
});
