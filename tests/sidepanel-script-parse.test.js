const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('sidepanel main script parses without syntax errors', () => {
  const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

  assert.doesNotThrow(() => {
    new vm.Script(source, { filename: 'sidepanel/sidepanel.js' });
  });
});

test('sidepanel defines IP proxy constants consumed by the proxy panel script', () => {
  const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

  assert.match(source, /const DEFAULT_IP_PROXY_SERVICE = '711proxy';/);
  assert.match(source, /const DEFAULT_IP_PROXY_MODE = 'account';/);
  assert.match(source, /const SUPPORTED_IP_PROXY_MODES = \['api', 'account'\];/);
  assert.match(source, /const DEFAULT_IP_PROXY_PROTOCOL = 'http';/);
  assert.match(source, /const SUPPORTED_IP_PROXY_PROTOCOLS = \['http', 'https', 'socks4', 'socks5'\];/);
});
