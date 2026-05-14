const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadRuntimeStateApi() {
  const source = fs.readFileSync('background/runtime-state.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundRuntimeState;`)(globalScope);
}

test('background imports runtime-state module and wires state view helpers', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/runtime-state\.js/);
  assert.match(source, /createRuntimeStateHelpers/);
  assert.match(source, /buildStateViewWithRuntimeState/);
  assert.match(source, /buildStatePatchWithRuntimeState/);
  assert.match(source, /runtimeState:/);
});

test('runtime-state module exposes a factory', () => {
  const api = loadRuntimeStateApi();
  assert.equal(typeof api?.createRuntimeStateHelpers, 'function');
});

test('runtime-state view derives canonical flow metadata from legacy step state', () => {
  const api = loadRuntimeStateApi();
  const helpers = api.createRuntimeStateHelpers({
    DEFAULT_ACTIVE_FLOW_ID: 'openai',
    defaultStepStatuses: {
      1: 'pending',
      2: 'pending',
      10: 'pending',
    },
    getStepDefinitionForState(step) {
      return {
        1: { id: 1, key: 'open-chatgpt' },
        2: { id: 2, key: 'submit-signup-email' },
        10: { id: 10, key: 'oauth-login' },
      }[Number(step)] || null;
    },
  });

  const view = helpers.buildStateView({
    currentStep: 2,
    stepStatuses: {
      1: 'completed',
      2: 'running',
    },
    oauthUrl: 'https://auth.example.com/start',
    plusCheckoutTabId: 88,
    currentPhoneActivation: {
      activationId: 'active-1',
      phoneNumber: '+447700900123',
    },
    tabRegistry: {
      'signup-page': { tabId: 12 },
    },
    sourceLastUrls: {
      'signup-page': 'https://auth.example.com/start',
    },
    flowStartTime: 12345,
  });

  assert.equal(view.activeFlowId, 'openai');
  assert.equal(view.currentNodeId, 'submit-signup-email');
  assert.deepStrictEqual(view.legacyStepCompat, {
    currentStep: 2,
    stepStatuses: {
      1: 'completed',
      2: 'running',
      10: 'pending',
    },
  });
  assert.deepStrictEqual(view.nodeStatuses, {
    'open-chatgpt': 'completed',
    'submit-signup-email': 'running',
    'oauth-login': 'pending',
  });
  assert.equal(view.runtimeState.flowState.openai.auth.oauthUrl, 'https://auth.example.com/start');
  assert.equal(view.runtimeState.flowState.openai.plus.plusCheckoutTabId, 88);
  assert.deepStrictEqual(view.runtimeState.flowState.openai.phoneVerification.currentPhoneActivation, {
    activationId: 'active-1',
    phoneNumber: '+447700900123',
  });
  assert.deepStrictEqual(view.sharedState, {
    tabRegistry: {
      'signup-page': { tabId: 12 },
    },
    sourceLastUrls: {
      'signup-page': 'https://auth.example.com/start',
    },
    flowStartTime: 12345,
  });
});

test('runtime-state patch accepts nested flow updates while keeping legacy compatibility fields in sync', () => {
  const api = loadRuntimeStateApi();
  const helpers = api.createRuntimeStateHelpers({
    DEFAULT_ACTIVE_FLOW_ID: 'openai',
    defaultStepStatuses: {
      1: 'pending',
      2: 'pending',
      10: 'pending',
    },
    getStepDefinitionForState(step) {
      return {
        1: { id: 1, key: 'open-chatgpt' },
        2: { id: 2, key: 'submit-signup-email' },
        10: { id: 10, key: 'oauth-login' },
      }[Number(step)] || null;
    },
  });

  const patch = helpers.buildSessionStatePatch({
    currentStep: 1,
    stepStatuses: {
      1: 'running',
      2: 'pending',
      10: 'pending',
    },
    oauthUrl: 'https://old.example.com/start',
  }, {
    runtimeState: {
      activeRunId: 'run-001',
      flowState: {
        openai: {
          auth: {
            oauthUrl: 'https://new.example.com/start',
          },
          plus: {
            plusCheckoutTabId: 99,
          },
        },
      },
      legacyStepCompat: {
        currentStep: 10,
        stepStatuses: {
          1: 'completed',
          10: 'running',
        },
      },
    },
  });

  assert.equal(patch.activeFlowId, 'openai');
  assert.equal(patch.activeRunId, 'run-001');
  assert.equal(patch.currentNodeId, 'oauth-login');
  assert.equal(patch.oauthUrl, 'https://new.example.com/start');
  assert.equal(patch.plusCheckoutTabId, 99);
  assert.equal(patch.currentStep, 10);
  assert.deepStrictEqual(patch.stepStatuses, {
    1: 'completed',
    2: 'pending',
    10: 'running',
  });
  assert.deepStrictEqual(patch.nodeStatuses, {
    'open-chatgpt': 'completed',
    'submit-signup-email': 'pending',
    'oauth-login': 'running',
  });
  assert.equal(patch.runtimeState.flowState.openai.auth.oauthUrl, 'https://new.example.com/start');
  assert.equal(patch.runtimeState.flowState.openai.plus.plusCheckoutTabId, 99);
});
