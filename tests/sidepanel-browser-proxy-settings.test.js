const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('sidepanel html exposes browser proxy controls', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(html, /id="input-browser-proxy-enabled"/);
  assert.match(html, /id="input-browser-proxy-spec"/);
  assert.match(html, /id="btn-toggle-browser-proxy-spec"/);
});

test('sidepanel collects and restores browser proxy settings', () => {
  const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

  assert.match(source, /browserProxyEnabled:\s*Boolean\(inputBrowserProxyEnabled\??\.checked\)/);
  assert.match(source, /browserProxySpec:\s*inputBrowserProxySpec\.value\.trim\(\)/);
  assert.match(source, /inputBrowserProxyEnabled\.checked = Boolean\(state\?\.browserProxyEnabled\)/);
  assert.match(source, /inputBrowserProxySpec\.value = state\?\.browserProxySpec \|\| ''/);
});
