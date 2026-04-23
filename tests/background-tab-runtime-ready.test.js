const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('ensureContentScriptReadyOnTab waits briefly for signup-page auto injection before manual executeScript', async () => {
  const source = fs.readFileSync('background/tab-runtime.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundTabRuntime;`)(globalScope);

  const executeScriptCalls = [];
  const sendMessageCalls = [];
  let registry = {};
  let pingCount = 0;

  const runtime = api.createTabRuntime({
    addLog: async () => {},
    chrome: {
      tabs: {
        async sendMessage(tabId, payload) {
          sendMessageCalls.push({ tabId, payload });
          pingCount += 1;
          if (pingCount < 3) {
            throw new Error('Receiving end does not exist.');
          }
          return { ok: true, source: 'signup-page' };
        },
        async get(tabId) {
          return { id: tabId, url: 'https://auth.openai.com/email-verification' };
        },
        onUpdated: {
          addListener() {},
          removeListener() {},
        },
      },
      scripting: {
        async executeScript(details) {
          executeScriptCalls.push(details);
          return [];
        },
      },
    },
    getSourceLabel: (value) => value,
    getState: async () => ({
      tabRegistry: registry,
      sourceLastUrls: {},
    }),
    isLocalhostOAuthCallbackUrl: () => false,
    isRetryableContentScriptTransportError: () => true,
    LOG_PREFIX: '[test]',
    matchesSourceUrlFamily: () => false,
    setState: async (updates) => {
      registry = updates.tabRegistry || registry;
    },
    sleepWithStop: async () => {},
    STOP_ERROR_MESSAGE: 'stopped',
    throwIfStopped: () => {},
  });

  await runtime.ensureContentScriptReadyOnTab('signup-page', 123, {
    inject: ['content/utils.js', 'content/auth-page-recovery.js', 'content/signup-page.js'],
    timeoutMs: 1000,
    retryDelayMs: 1,
  });

  assert.equal(executeScriptCalls.length, 0);
  assert.ok(sendMessageCalls.length >= 3);
});
