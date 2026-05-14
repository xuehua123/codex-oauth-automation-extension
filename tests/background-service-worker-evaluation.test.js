const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createChromeStub() {
  const fn = function chromeStubFunction() {
    return Promise.resolve({});
  };
  const handler = {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'toString') return () => '';
      if (prop === 'getManifest') return () => ({ version: 'test' });
      if (prop === 'getURL') return (filePath = '') => `chrome-extension://test/${filePath}`;
      if (prop === 'addListener' || prop === 'removeListener' || prop === 'hasListener') {
        return () => undefined;
      }
      if (prop === 'clear' || prop === 'create' || prop === 'get' || prop === 'set' || prop === 'remove') {
        return async () => ({});
      }
      return new Proxy(fn, handler);
    },
    apply() {
      return Promise.resolve({});
    },
  };
  return new Proxy(fn, handler);
}

test('background service worker evaluates without load-time reference errors', () => {
  const root = process.cwd();
  const context = {
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    Blob,
    FormData,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    clearInterval,
    clearTimeout,
    console: {
      debug() {},
      error() {},
      info() {},
      log() {},
      warn() {},
    },
    fetch: async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
    }),
    setInterval,
    setTimeout,
    chrome: createChromeStub(),
  };
  context.self = context;
  context.globalThis = context;
  context.importScripts = (...files) => {
    files.forEach((file) => {
      const fullPath = path.join(root, file);
      const source = fs.readFileSync(fullPath, 'utf8');
      vm.runInContext(source, context, { filename: file });
    });
  };

  vm.createContext(context);

  assert.doesNotThrow(() => {
    vm.runInContext(fs.readFileSync('background.js', 'utf8'), context, { filename: 'background.js' });
  });
});
