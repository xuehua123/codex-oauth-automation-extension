const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findIcloudAliasArray,
  findIcloudAliasByEmail,
  getConfiguredIcloudHostPreference,
  getIcloudHostHintFromMessage,
  getIcloudLoginUrlForHost,
  getIcloudMailUrlForHost,
  getIcloudSetupUrlForHost,
  normalizeAppleAccountAliasList,
  normalizeAppleAccountAliasRecord,
  normalizeBooleanMap,
  normalizeIcloudAliasList,
  normalizeIcloudAliasRecord,
  normalizeIcloudHost,
  pickReusableIcloudAlias,
  toNormalizedEmailSet,
} = require('../icloud-utils.js');

test('normalizeIcloudHost and host preference helpers resolve supported hosts', () => {
  assert.equal(normalizeIcloudHost('www.icloud.com'), 'icloud.com');
  assert.equal(normalizeIcloudHost('setup.icloud.com.cn'), 'icloud.com.cn');
  assert.equal(normalizeIcloudHost('setup.icloud.com:443'), 'icloud.com');
  assert.equal(normalizeIcloudHost('https://setup.icloud.com.cn/setup/ws/1'), 'icloud.com.cn');
  assert.equal(normalizeIcloudHost('example.com'), '');

  assert.equal(getConfiguredIcloudHostPreference({ icloudHostPreference: 'icloud.com' }), 'icloud.com');
  assert.equal(getConfiguredIcloudHostPreference({ icloudHostPreference: 'auto' }), '');
  assert.equal(getIcloudLoginUrlForHost('icloud.com.cn'), 'https://www.icloud.com.cn/');
  assert.equal(getIcloudMailUrlForHost('icloud.com'), 'https://www.icloud.com/mail/');
  assert.equal(getIcloudSetupUrlForHost('icloud.com'), 'https://setup.icloud.com/setup/ws/1');
});

test('getIcloudHostHintFromMessage can infer host from error text', () => {
  assert.equal(getIcloudHostHintFromMessage('status 401 from setup.icloud.com.cn/setup/ws/1'), 'icloud.com.cn');
  assert.equal(getIcloudHostHintFromMessage('request failed at https://www.icloud.com/'), 'icloud.com');
  assert.equal(getIcloudHostHintFromMessage('unknown host'), '');
});

test('findIcloudAliasArray finds nested alias collections', () => {
  const payload = {
    result: {
      data: {
        items: [
          { hme: 'first@icloud.com', anonymousId: 'a1' },
          { hme: 'second@icloud.com', anonymousId: 'a2' },
        ],
      },
    },
  };

  assert.deepEqual(findIcloudAliasArray(payload), payload.result.data.items);
});

test('normalizeIcloudAliasRecord merges used and preserved state', () => {
  const alias = normalizeIcloudAliasRecord({
    anonymousId: 'alias-1',
    hme: 'Demo@iCloud.com',
    label: 'Test',
    note: 'Created by test',
    state: 'active',
  }, {
    usedEmails: ['demo@icloud.com'],
    preservedEmails: ['demo@icloud.com'],
  });

  assert.deepEqual(alias, {
    anonymousId: 'alias-1',
    email: 'demo@icloud.com',
    label: 'Test',
    note: 'Created by test',
    state: 'active',
    active: true,
    used: true,
    preserved: true,
    createdAt: null,
  });
});

test('normalizeIcloudAliasList orders active unused aliases before used aliases', () => {
  const aliases = normalizeIcloudAliasList({
    hmeEmails: [
      { hme: 'used@icloud.com', anonymousId: 'u1', active: true },
      { hme: 'fresh@icloud.com', anonymousId: 'f1', active: true },
      { hme: 'inactive@icloud.com', anonymousId: 'i1', active: false },
    ],
  }, {
    usedEmails: ['used@icloud.com'],
    preservedEmails: ['inactive@icloud.com'],
  });

  assert.deepEqual(aliases.map((alias) => alias.email), [
    'fresh@icloud.com',
    'used@icloud.com',
    'inactive@icloud.com',
  ]);
  assert.equal(aliases[2].preserved, true);
});

test('normalizeAppleAccountAliasRecord maps Apple Account private email records to alias objects', () => {
  const alias = normalizeAppleAccountAliasRecord({
    id: 'alias-1',
    emailAddress: 'Demo@iCloud.com',
    label: 'Shopping',
    note: 'Created in settings',
    createdDate: '2026年4月12日',
    forwardToEmail: 'Forward@Target.com',
    active: true,
  }, {
    usedEmails: ['demo@icloud.com'],
  });

  assert.deepEqual(alias, {
    anonymousId: 'alias-1',
    email: 'demo@icloud.com',
    label: 'Shopping',
    note: 'Created in settings',
    state: 'active',
    active: true,
    used: true,
    preserved: false,
    createdAt: '2026年4月12日',
    forwardToEmail: 'forward@target.com',
    source: 'apple-account',
  });
});

test('normalizeAppleAccountAliasList merges active and inactive Apple Account aliases and preserves forward targets', () => {
  const aliases = normalizeAppleAccountAliasList({
    privateEmailList: [
      {
        id: 'fresh-1',
        emailAddress: 'fresh@icloud.com',
        label: 'Fresh',
        note: '',
        createdDate: '2026年4月12日',
        active: true,
      },
      {
        id: 'used-1',
        emailAddress: 'used@icloud.com',
        label: 'Used',
        note: '',
        forwardToEmail: 'alias-target@icloud.com',
        createdDate: '2026年4月10日',
        active: true,
      },
    ],
    inactivePrivateEmailList: [
      {
        id: 'inactive-1',
        emailAddress: 'inactive@icloud.com',
        label: 'Inactive',
        note: 'Disabled',
        createdDate: '2026年4月8日',
      },
    ],
    forwardToEmailAddress: 'default-target@icloud.com',
  }, {
    usedEmails: ['used@icloud.com'],
    preservedEmails: ['inactive@icloud.com'],
  });

  assert.deepEqual(aliases, [
    {
      anonymousId: 'fresh-1',
      email: 'fresh@icloud.com',
      label: 'Fresh',
      note: '',
      state: 'active',
      active: true,
      used: false,
      preserved: false,
      createdAt: '2026年4月12日',
      forwardToEmail: 'default-target@icloud.com',
      source: 'apple-account',
    },
    {
      anonymousId: 'used-1',
      email: 'used@icloud.com',
      label: 'Used',
      note: '',
      state: 'active',
      active: true,
      used: true,
      preserved: false,
      createdAt: '2026年4月10日',
      forwardToEmail: 'alias-target@icloud.com',
      source: 'apple-account',
    },
    {
      anonymousId: 'inactive-1',
      email: 'inactive@icloud.com',
      label: 'Inactive',
      note: 'Disabled',
      state: 'inactive',
      active: false,
      used: false,
      preserved: true,
      createdAt: '2026年4月8日',
      forwardToEmail: 'default-target@icloud.com',
      source: 'apple-account',
    },
  ]);
});

test('pickReusableIcloudAlias and findIcloudAliasByEmail select expected aliases', () => {
  const aliases = normalizeIcloudAliasList({
    hmeEmails: [
      { hme: 'used@icloud.com', anonymousId: 'u1', active: true },
      { hme: 'fresh@icloud.com', anonymousId: 'f1', active: true },
    ],
  }, {
    usedEmails: ['used@icloud.com'],
  });

  assert.equal(pickReusableIcloudAlias(aliases)?.email, 'fresh@icloud.com');
  assert.equal(findIcloudAliasByEmail(aliases, 'FRESH@ICLOUD.COM')?.anonymousId, 'f1');
});

test('normalizeBooleanMap and toNormalizedEmailSet normalize keys and truthy entries', () => {
  const normalized = normalizeBooleanMap({
    ' Demo@icloud.com ': 1,
    'skip@icloud.com': 0,
  });

  assert.deepEqual(normalized, {
    'demo@icloud.com': true,
    'skip@icloud.com': false,
  });
  assert.deepEqual([...toNormalizedEmailSet(normalized)], ['demo@icloud.com']);
});
