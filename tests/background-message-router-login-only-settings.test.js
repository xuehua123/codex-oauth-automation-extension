const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/message-router.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

function installLoginOnlyGlobals() {
  const previousIsLoginOnlyMode = globalThis.isCodex2ApiLoginOnlyMode;
  const previousGetLoginAccountForRun = globalThis.getCodex2ApiLoginAccountForRun;

  globalThis.isCodex2ApiLoginOnlyMode = (state = {}) => (
    String(state?.panelMode || '').trim().toLowerCase() === 'codex2api'
      && Boolean(state?.codex2apiLoginOnlyMode)
  );
  globalThis.getCodex2ApiLoginAccountForRun = (state = {}, targetRun = 1) => {
    const accounts = Array.isArray(state?.codex2apiLoginAccounts)
      ? state.codex2apiLoginAccounts
      : [];
    const index = Math.max(1, Math.floor(Number(targetRun) || 1)) - 1;
    return accounts[index] || null;
  };

  return () => {
    globalThis.isCodex2ApiLoginOnlyMode = previousIsLoginOnlyMode;
    globalThis.getCodex2ApiLoginAccountForRun = previousGetLoginAccountForRun;
  };
}

test('message router SAVE_SETTING preserves the active login-only account during auto-run', async () => {
  const restoreGlobals = installLoginOnlyGlobals();

  try {
    let state = {
      panelMode: 'codex2api',
      codex2apiLoginOnlyMode: true,
      codex2apiLoginAccounts: [
        { email: 'alpha@example.com', password: 'alpha-pass' },
        { email: 'beta@example.com', password: 'beta-pass' },
      ],
      autoRunCurrentRun: 2,
      email: 'beta@example.com',
      password: 'beta-pass',
      stepStatuses: { 7: 'running', 8: 'pending', 9: 'pending', 10: 'pending' },
    };

    const router = api.createMessageRouter({
      addLog: async () => {},
      buildPersistentSettingsPayload: (payload) => ({ codex2apiAdminKey: payload.codex2apiAdminKey || '' }),
      buildLuckmailSessionSettingsPayload: () => ({}),
      getState: async () => state,
      getStepIdsForState: () => [7, 8, 9, 10],
      setPersistentSettings: async () => {},
      setState: async (updates) => {
        state = { ...state, ...updates };
      },
    });

    const response = await router.handleMessage({
      type: 'SAVE_SETTING',
      source: 'sidepanel',
      payload: {
        codex2apiAdminKey: 'rotated-admin-key',
      },
    }, {});

    assert.equal(response?.ok, true);
    assert.equal(state.codex2apiAdminKey, 'rotated-admin-key');
    assert.equal(state.email, 'beta@example.com');
    assert.equal(state.password, 'beta-pass');
  } finally {
    restoreGlobals();
  }
});

test('message router SAVE_SETTING seeds the first login-only account when enabling the mode', async () => {
  const restoreGlobals = installLoginOnlyGlobals();

  try {
    let state = {
      panelMode: 'codex2api',
      codex2apiLoginOnlyMode: false,
      codex2apiLoginAccounts: [
        { email: 'alpha@example.com', password: 'alpha-pass' },
        { email: 'beta@example.com', password: 'beta-pass' },
      ],
      autoRunCurrentRun: 0,
      email: '',
      password: '',
      stepStatuses: { 1: 'pending', 2: 'pending', 3: 'pending' },
    };

    const router = api.createMessageRouter({
      addLog: async () => {},
      buildPersistentSettingsPayload: (payload) => ({
        codex2apiLoginOnlyMode: Boolean(payload.codex2apiLoginOnlyMode),
      }),
      buildLuckmailSessionSettingsPayload: () => ({}),
      getState: async () => state,
      getStepIdsForState: () => [7, 8, 9, 10],
      setPersistentSettings: async () => {},
      setState: async (updates) => {
        state = { ...state, ...updates };
      },
    });

    const response = await router.handleMessage({
      type: 'SAVE_SETTING',
      source: 'sidepanel',
      payload: {
        codex2apiLoginOnlyMode: true,
      },
    }, {});

    assert.equal(response?.ok, true);
    assert.equal(state.codex2apiLoginOnlyMode, true);
    assert.equal(state.email, 'alpha@example.com');
    assert.equal(state.password, 'alpha-pass');
  } finally {
    restoreGlobals();
  }
});
