const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/message-router.js', 'utf8');

function createRouter(overrides = {}) {
  const events = {
    refreshes: [],
    switches: [],
    changes: [],
    probes: [],
    applies: [],
    autoSyncs: [],
  };
  const globalScope = {};
  const refreshIpProxyPool = async (options = {}) => {
    events.refreshes.push(options);
    return {
      mode: options.mode || 'account',
      count: 2,
      display: 'proxy-a',
    };
  };
  const normalizeIpProxyMode = (value = '') => (
    String(value || '').trim().toLowerCase() === 'api' ? 'api' : 'account'
  );
  const normalizeIpProxyProviderValue = (value = '') => (
    String(value || '').trim().toLowerCase() || '711proxy'
  );
  const api = new Function(
    'self',
    'refreshIpProxyPool',
    'normalizeIpProxyMode',
    'normalizeIpProxyProviderValue',
    `${source}; return self.MultiPageBackgroundMessageRouter;`
  )(globalScope, refreshIpProxyPool, normalizeIpProxyMode, normalizeIpProxyProviderValue);

  const router = api.createMessageRouter({
    applyIpProxySettingsFromState: async (state, options) => {
      events.applies.push({ state, options });
      return { applied: true };
    },
    exportSettingsBundle: async () => ({}),
    getState: async () => overrides.state || {
      ipProxyEnabled: false,
      ipProxyMode: 'account',
      ipProxyService: '711proxy',
    },
    probeIpProxyExit: async (options = {}) => {
      events.probes.push(options);
      return {
        proxyRouting: {
          applied: true,
          reason: 'applied',
          host: 'proxy.example.com',
          port: 8080,
        },
      };
    },
    runIpProxyAutoSync: async (trigger) => {
      events.autoSyncs.push(trigger);
      return { skipped: false, trigger };
    },
    switchIpProxy: async (direction, options = {}) => {
      events.switches.push({ direction, options });
      return {
        direction,
        mode: options.mode || 'account',
        display: 'proxy-b',
      };
    },
    changeIpProxyExit: async (options = {}) => {
      events.changes.push(options);
      return {
        mode: options.mode || 'account',
        display: 'proxy-c',
      };
    },
  });

  return { router, events };
}

test('message router handles sidepanel IP proxy action messages', async () => {
  const { router, events } = createRouter();

  assert.deepStrictEqual(
    await router.handleMessage({
      type: 'RUN_IP_PROXY_AUTO_SYNC_NOW',
      source: 'sidepanel',
      payload: {},
    }),
    { ok: true, skipped: false, trigger: 'manual' }
  );
  assert.deepStrictEqual(
    await router.handleMessage({
      type: 'REFRESH_IP_PROXY_POOL',
      source: 'sidepanel',
      payload: {
        mode: 'account',
        maxItems: 5,
        skipExitProbe: true,
      },
    }),
    { ok: true, mode: 'account', count: 2, display: 'proxy-a' }
  );
  assert.deepStrictEqual(
    await router.handleMessage({
      type: 'SWITCH_IP_PROXY',
      source: 'sidepanel',
      payload: {
        direction: 'next',
        mode: 'account',
        forceRefresh: false,
        skipExitProbe: true,
      },
    }),
    { ok: true, direction: 'next', mode: 'account', display: 'proxy-b' }
  );
  assert.deepStrictEqual(
    await router.handleMessage({
      type: 'CHANGE_IP_PROXY_EXIT',
      source: 'sidepanel',
      payload: {
        mode: 'account',
        skipExitProbe: true,
      },
    }),
    { ok: true, mode: 'account', display: 'proxy-c' }
  );
  assert.deepStrictEqual(
    await router.handleMessage({
      type: 'PROBE_IP_PROXY_EXIT',
      source: 'sidepanel',
      payload: {},
    }),
    {
      ok: true,
      proxyRouting: {
        applied: true,
        reason: 'applied',
        host: 'proxy.example.com',
        port: 8080,
      },
    }
  );

  assert.deepStrictEqual(events.autoSyncs, ['manual']);
  assert.deepStrictEqual(events.refreshes, [
    { maxItems: 5, mode: 'account', skipExitProbe: true },
  ]);
  assert.deepStrictEqual(events.switches, [
    {
      direction: 'next',
      options: {
        maxItems: undefined,
        mode: 'account',
        forceRefresh: false,
        skipExitProbe: true,
      },
    },
  ]);
  assert.deepStrictEqual(events.changes, [
    { mode: 'account', skipExitProbe: true },
  ]);
  assert.deepStrictEqual(events.probes, [
    { timeoutMs: 12000, authRebindMaxAttempts: 1 },
  ]);
});

test('message router rebinds proxy auth before probing after a missing auth challenge', async () => {
  const state = {
    ipProxyEnabled: true,
    ipProxyMode: 'account',
    ipProxyService: '711proxy',
    ipProxyAppliedReason: 'connectivity_failed',
    ipProxyAppliedExitError: 'challenge=0 provided=0',
  };
  const { router, events } = createRouter({ state });

  await router.handleMessage({
    type: 'PROBE_IP_PROXY_EXIT',
    source: 'sidepanel',
    payload: {},
  });

  assert.deepStrictEqual(events.applies, [
    {
      state,
      options: {
        skipExitProbe: true,
        resetNetworkState: true,
        forceAuthRebind: true,
        suppressAuthRebind: false,
      },
    },
  ]);
  assert.deepStrictEqual(events.probes, [
    { timeoutMs: 15000, authRebindMaxAttempts: 1 },
  ]);
});
