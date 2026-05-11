const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/verification-flow.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundVerificationFlow;`)(globalScope);

test('verification flow routes TempMail public inbox polling through the dedicated provider branch', async () => {
  const calls = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    IKONA_ONI_PROVIDER: 'ikona-oni',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => {
      throw new Error('cloudflare provider should not run');
    },
    pollHotmailVerificationCode: async () => {
      throw new Error('hotmail provider should not run');
    },
    pollIkonaOniVerificationCode: async () => {
      throw new Error('ikona provider should not run');
    },
    pollLuckmailVerificationCode: async () => {
      throw new Error('luckmail provider should not run');
    },
    pollTempmailPublicVerificationCode: async (step, state, payload) => {
      calls.push({ step, state, payload });
      return { code: '654321', emailTimestamp: 123 };
    },
    sendToContentScript: async () => ({}),
    sendToMailContentScriptResilient: async () => {
      throw new Error('mail content script should not run for tempmail public');
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    TEMPMAIL_PUBLIC_PROVIDER: 'tempmail-public',
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const result = await helpers.pollFreshVerificationCode(
    8,
    {
      email: 'user@example.com',
      lastLoginCode: null,
    },
    { provider: 'tempmail-public', label: 'TempMail 公共收件箱' },
    {}
  );

  assert.equal(result.code, '654321');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].step, 8);
  assert.equal(calls[0].payload.targetEmail, 'user@example.com');
});

test('verification flow routes Ikona-Oni polling through the dedicated provider branch', async () => {
  const calls = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    IKONA_ONI_PROVIDER: 'ikona-oni',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => {
      throw new Error('cloudflare provider should not run');
    },
    pollHotmailVerificationCode: async () => {
      throw new Error('hotmail provider should not run');
    },
    pollIkonaOniVerificationCode: async (step, state, payload) => {
      calls.push({ step, state, payload });
      return { code: '123456', emailTimestamp: 456 };
    },
    pollLuckmailVerificationCode: async () => {
      throw new Error('luckmail provider should not run');
    },
    pollTempmailPublicVerificationCode: async () => {
      throw new Error('tempmail provider should not run');
    },
    sendToContentScript: async () => ({}),
    sendToMailContentScriptResilient: async () => {
      throw new Error('mail content script should not run for ikona');
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    TEMPMAIL_PUBLIC_PROVIDER: 'tempmail-public',
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const result = await helpers.pollFreshVerificationCode(
    8,
    {
      email: 'user@example.com',
      lastLoginCode: null,
    },
    { provider: 'ikona-oni', label: 'Ikona-Oni API' },
    {}
  );

  assert.equal(result.code, '123456');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].step, 8);
  assert.equal(calls[0].payload.targetEmail, 'user@example.com');
});
