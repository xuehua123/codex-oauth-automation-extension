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
