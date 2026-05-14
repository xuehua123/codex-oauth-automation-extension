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

test('sidepanel defines every DEFAULT_* constant it references', () => {
  const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
  const referencedNames = [...new Set(
    [...source.matchAll(/\bDEFAULT_[A-Z0-9_]+\b/g)].map((match) => match[0])
  )].sort();
  const missingNames = referencedNames.filter((name) => {
    const declarationPattern = new RegExp(`(?:const|let|var)\\s+${name}\\b`);
    return !declarationPattern.test(source);
  });

  assert.deepStrictEqual(missingNames, []);
  assert.match(source, /const DEFAULT_PHONE_VERIFICATION_ENABLED = false;/);
  assert.match(source, /const DEFAULT_HERO_SMS_COUNTRY_ID = 52;/);
  assert.match(source, /const DEFAULT_HERO_SMS_COUNTRY_LABEL = 'Thailand';/);
  assert.match(source, /const DEFAULT_FIVE_SIM_COUNTRY_ID = 'vietnam';/);
  assert.match(source, /const DEFAULT_FIVE_SIM_COUNTRY_LABEL = '越南 \(Vietnam\)';/);
});
