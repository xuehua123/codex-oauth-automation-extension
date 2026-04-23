const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('rules.json should pin iCloud.com requests to the iCloud+ page as Referer', () => {
  const rules = JSON.parse(fs.readFileSync('rules.json', 'utf8'));
  const rule = rules.find((entry) => entry?.id === 1);

  assert.ok(rule, '缺少 iCloud.com 规则');
  const refererHeader = rule.action?.requestHeaders?.find((entry) => entry?.header === 'Referer');
  assert.equal(
    refererHeader?.value,
    'https://www.icloud.com/icloudplus/'
  );
});

test('rules.json should pin iCloud.cn requests to the iCloud+ page as Referer', () => {
  const rules = JSON.parse(fs.readFileSync('rules.json', 'utf8'));
  const rule = rules.find((entry) => entry?.id === 2);

  assert.ok(rule, '缺少 iCloud.cn 规则');
  const refererHeader = rule.action?.requestHeaders?.find((entry) => entry?.header === 'Referer');
  assert.equal(
    refererHeader?.value,
    'https://www.icloud.com.cn/icloudplus/'
  );
});
