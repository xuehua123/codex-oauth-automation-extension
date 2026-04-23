const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/icloud-list-mail.js', 'utf8');

function createContentScriptHarness(options = {}) {
  let messageListener = null;
  const location = {
    href: options.href || 'https://example.com/code',
  };
  const windowObject = {
    top: null,
    location,
  };
  windowObject.top = windowObject;

  const document = {
    title: options.title || '',
    body: {
      innerText: options.bodyText || '',
    },
    querySelectorAll() {
      return [];
    },
  };

  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
  };

  const consoleObject = {
    log() {},
    warn() {},
    error() {},
  };

  const resetStopState = () => {};
  const isStopError = () => false;

  new Function(
    'window',
    'document',
    'chrome',
    'console',
    'location',
    'resetStopState',
    'isStopError',
    source
  )(
    windowObject,
    document,
    chrome,
    consoleObject,
    location,
    resetStopState,
    isStopError
  );

  return {
    async dispatch(message) {
      return new Promise((resolve) => {
        const handled = messageListener(message, {}, resolve);
        assert.equal(handled, true);
      });
    },
  };
}

test('icloud-list mail ignores stale codes when the page text contains an embedded timestamp', async () => {
  const harness = createContentScriptHarness({
    bodyText: 'Your verification code is 654321 at 2026-04-21 10:20:30',
  });

  const response = await harness.dispatch({
    type: 'POLL_EMAIL',
    step: 4,
    payload: {
      filterAfterTimestamp: Date.parse('2026-04-21T10:20:31'),
    },
  });

  assert.match(String(response?.error || ''), /未找到新的 6 位验证码/);
});

test('icloud-list mail does not treat date-only text as stale later the same day', async () => {
  const harness = createContentScriptHarness({
    bodyText: 'Your verification code is 654321. Sent on 2026-04-21',
  });

  const response = await harness.dispatch({
    type: 'POLL_EMAIL',
    step: 4,
    payload: {
      filterAfterTimestamp: Date.parse('2026-04-21T10:00:00'),
    },
  });

  assert.equal(response?.error, undefined);
  assert.equal(response?.code, '654321');
  assert.equal(typeof response?.emailTimestamp, 'number');
});
