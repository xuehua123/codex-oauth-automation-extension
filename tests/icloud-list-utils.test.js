const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateIcloudListEntry,
  extractLatestTimestampFromAny,
  extractVerificationCodeFromAny,
  findIcloudListEntryByEmail,
  mergeIcloudListEntries,
  normalizeIcloudListEntries,
  parseIcloudListText,
  patchIcloudListEntry,
  resetIcloudListEntriesUsage,
  resolveIcloudListCurrentEntry,
} = require('../icloud-list-utils.js');

test('parseIcloudListText accepts tab-delimited rows and reports line errors', () => {
  const result = parseIcloudListText(`
# comment
first@icloud.com\thttps://example.com/code/1\t主号
bad-row
second@icloud.com\thttps://example.com/code/2
third@icloud.com\tnot-a-url
`);

  assert.deepEqual(result.entries, [
    {
      id: 'icloud-list-1',
      email: 'first@icloud.com',
      codeUrl: 'https://example.com/code/1',
      note: '主号',
      used: false,
      lastUsedAt: 0,
    },
    {
      id: 'icloud-list-2',
      email: 'second@icloud.com',
      codeUrl: 'https://example.com/code/2',
      note: '',
      used: false,
      lastUsedAt: 0,
    },
  ]);
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].lineNumber, 4);
  assert.match(result.errors[0].reason, /格式错误/);
  assert.equal(result.errors[1].lineNumber, 6);
  assert.match(result.errors[1].reason, /验证码链接/);
});

test('mergeIcloudListEntries dedupes by email and preserves used state on re-import', () => {
  const merged = mergeIcloudListEntries(
    [
      {
        id: 'icloud-list-7',
        email: 'first@icloud.com',
        codeUrl: 'https://old.example.com/code/1',
        note: 'old',
        used: true,
        lastUsedAt: 1710000000000,
      },
      {
        id: 'icloud-list-8',
        email: 'missing@icloud.com',
        codeUrl: 'https://old.example.com/code/2',
        note: '',
        used: false,
        lastUsedAt: 0,
      },
    ],
    [
      {
        email: 'FIRST@ICLOUD.COM',
        codeUrl: 'https://new.example.com/code/1',
        note: 'new',
      },
      {
        email: 'second@icloud.com',
        codeUrl: 'https://new.example.com/code/2',
        note: '',
      },
      {
        email: 'second@icloud.com',
        codeUrl: 'https://duplicate.example.com/code/2',
        note: 'duplicate',
      },
    ]
  );

  assert.deepEqual(merged, [
    {
      id: 'icloud-list-7',
      email: 'first@icloud.com',
      codeUrl: 'https://new.example.com/code/1',
      note: 'new',
      used: true,
      lastUsedAt: 1710000000000,
    },
    {
      id: 'icloud-list-9',
      email: 'second@icloud.com',
      codeUrl: 'https://new.example.com/code/2',
      note: '',
      used: false,
      lastUsedAt: 0,
    },
  ]);
});

test('allocateIcloudListEntry and resolveIcloudListCurrentEntry pick the expected row', () => {
  const entries = normalizeIcloudListEntries([
    {
      id: 'icloud-list-1',
      email: 'used@icloud.com',
      codeUrl: 'https://example.com/code/used',
      note: '',
      used: true,
      lastUsedAt: 10,
    },
    {
      id: 'icloud-list-2',
      email: 'fresh@icloud.com',
      codeUrl: 'https://example.com/code/fresh',
      note: '',
      used: false,
      lastUsedAt: 0,
    },
  ]);

  assert.equal(allocateIcloudListEntry(entries)?.email, 'fresh@icloud.com');
  assert.equal(findIcloudListEntryByEmail(entries, 'FRESH@ICLOUD.COM')?.id, 'icloud-list-2');
  assert.equal(resolveIcloudListCurrentEntry(entries, { currentIcloudListEmail: 'fresh@icloud.com' })?.id, 'icloud-list-2');
  assert.equal(resolveIcloudListCurrentEntry(entries, { email: 'used@icloud.com' })?.id, 'icloud-list-1');
});

test('resolveIcloudListCurrentEntry does not fallback to current row when explicit email does not match', () => {
  const entries = normalizeIcloudListEntries([
    {
      id: 'icloud-list-1',
      email: 'used@icloud.com',
      codeUrl: 'https://example.com/code/used',
      note: '',
      used: true,
      lastUsedAt: 10,
    },
  ]);

  assert.equal(resolveIcloudListCurrentEntry(entries, {
    email: 'other@icloud.com',
    currentIcloudListEmail: 'used@icloud.com',
  }), null);
  assert.equal(resolveIcloudListCurrentEntry(entries, { email: '', currentIcloudListEmail: 'used@icloud.com' })?.id, 'icloud-list-1');
});

test('patchIcloudListEntry and resetIcloudListEntriesUsage update usage state without losing rows', () => {
  const entries = normalizeIcloudListEntries([
    {
      id: 'icloud-list-1',
      email: 'fresh@icloud.com',
      codeUrl: 'https://example.com/code/fresh',
      note: 'main',
      used: false,
      lastUsedAt: 0,
    },
  ]);

  const patched = patchIcloudListEntry(entries, 'fresh@icloud.com', {
    used: true,
    lastUsedAt: 1710000000000,
  });
  assert.deepEqual(patched[0], {
    id: 'icloud-list-1',
    email: 'fresh@icloud.com',
    codeUrl: 'https://example.com/code/fresh',
    note: 'main',
    used: true,
    lastUsedAt: 1710000000000,
  });

  const reset = resetIcloudListEntriesUsage(patched);
  assert.equal(reset[0].used, false);
  assert.equal(reset[0].lastUsedAt, 0);
});

test('extractVerificationCodeFromAny and extractLatestTimestampFromAny scan nested payloads', () => {
  const payload = {
    data: {
      message: 'OpenAI 验证码：654321',
      receivedAt: '2026-04-21T10:20:30.000Z',
    },
    items: [
      {
        html: '<p>ignore me</p>',
      },
    ],
  };

  assert.equal(extractVerificationCodeFromAny(payload), '654321');
  assert.equal(extractLatestTimestampFromAny(payload), Date.parse('2026-04-21T10:20:30.000Z'));
});

test('extractLatestTimestampFromAny finds timestamps embedded inside HTML/text strings', () => {
  const payload = {
    html: '<div>Your verification code is 654321 at 2026-04-21 10:20:30</div>',
  };

  assert.equal(
    extractLatestTimestampFromAny(payload),
    Date.parse('2026-04-21T10:20:30')
  );
});

test('extractLatestTimestampFromAny ignores date-only text without time precision', () => {
  const payload = {
    html: '<div>Your verification code is 654321. Sent on 2026-04-21</div>',
  };

  assert.equal(extractLatestTimestampFromAny(payload), 0);
});

test('parseIcloudListText accepts public http urls but still rejects local-network code urls', () => {
  const result = parseIcloudListText(`
public-http@icloud.com\thttp://example.com/code/1
localhost@icloud.com\thttps://127.0.0.1/code/2
lan@icloud.com\thttps://192.168.1.20/code/3
`);

  assert.deepEqual(result.entries, [
    {
      id: 'icloud-list-1',
      email: 'public-http@icloud.com',
      codeUrl: 'http://example.com/code/1',
      note: '',
      used: false,
      lastUsedAt: 0,
    },
  ]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].reason, /验证码链接/);
  assert.match(result.errors[1].reason, /验证码链接/);
});

test('parseIcloudListText accepts api798 auth_code links from TXT exports', () => {
  const result = parseIcloudListText(
    'colas-drachma-6t@icloud.com\thttp://api798.com/latest?email=colas-drachma-6t%40icloud.com&auth_code=SSS888'
  );

  assert.deepEqual(result.entries, [
    {
      id: 'icloud-list-1',
      email: 'colas-drachma-6t@icloud.com',
      codeUrl: 'http://api798.com/latest?email=colas-drachma-6t%40icloud.com&auth_code=SSS888',
      note: '',
      used: false,
      lastUsedAt: 0,
    },
  ]);
  assert.equal(result.errors.length, 0);
});
