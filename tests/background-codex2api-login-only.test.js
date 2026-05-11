const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('background normalizes Codex2API login-only accounts and resolves the public inbox provider', () => {
  const bundle = [
    extractFunction('normalizePanelMode'),
    extractFunction('isCodex2ApiLoginOnlyMode'),
    extractFunction('normalizeCodex2ApiLoginAccounts'),
    extractFunction('getCodex2ApiLoginAccounts'),
    extractFunction('getCodex2ApiLoginAccountForRun'),
    extractFunction('normalizeCodex2ApiLoginCodeProvider'),
    extractFunction('normalizeMailProvider'),
    extractFunction('shouldUseCustomRegistrationEmail'),
    extractFunction('getMailConfig'),
  ].join('\n');

  const api = new Function(`
const HOTMAIL_PROVIDER = 'hotmail-api';
const ICLOUD_PROVIDER = 'icloud';
const GMAIL_PROVIDER = 'gmail';
const LUCKMAIL_PROVIDER = 'luckmail-api';
const CLOUDFLARE_TEMP_EMAIL_PROVIDER = 'cloudflare-temp-email';
const TEMPMAIL_PUBLIC_PROVIDER = 'tempmail-public';
const IKONA_ONI_PROVIDER = 'ikona-oni';
const PERSISTED_SETTING_DEFAULTS = {
  mailProvider: '163',
};
function normalizeEmailGenerator(value = '') {
  return String(value || '').trim().toLowerCase() || 'duck';
}
function isHotmailProvider(state = {}) {
  return String(state?.mailProvider || '').trim().toLowerCase() === HOTMAIL_PROVIDER;
}
function isGeneratedAliasProvider() {
  return false;
}
function getConfiguredIcloudHostPreference() {
  return '';
}
function normalizeIcloudHost() {
  return '';
}
function normalizeIcloudTargetMailboxType() {
  return 'icloud-inbox';
}
function normalizeIcloudForwardMailProvider() {
  return 'qq';
}
function getSharedIcloudForwardMailConfig() {
  return { provider: 'qq', label: 'QQ 邮箱' };
}
function getIcloudLoginUrlForHost() {
  return 'https://www.icloud.com/';
}
function getIcloudMailUrlForHost() {
  return 'https://www.icloud.com/mail/';
}
function normalizeInbucketOrigin(value = '') {
  return String(value || '').trim();
}

${bundle}

return {
  getCodex2ApiLoginAccountForRun,
  getCodex2ApiLoginAccounts,
  getMailConfig,
  isCodex2ApiLoginOnlyMode,
  normalizeCodex2ApiLoginAccounts,
  shouldUseCustomRegistrationEmail,
};
`)();

  assert.deepStrictEqual(
    api.normalizeCodex2ApiLoginAccounts(' Foo@Example.com | pass-1 \\ninvalid\\nbar@example.com| pass-2 \\nbaz@example.com\\nqux@example.com | '),
    [
      { email: 'foo@example.com', password: 'pass-1' },
      { email: 'bar@example.com', password: 'pass-2' },
      { email: 'baz@example.com', password: '' },
      { email: 'qux@example.com', password: '' },
    ]
  );

  assert.deepStrictEqual(
    api.normalizeCodex2ApiLoginAccounts([
      { email: 'ObjectUser@Example.com' },
      { email: 'PasswordUser@Example.com', password: ' pass ' },
    ]),
    [
      { email: 'objectuser@example.com', password: '' },
      { email: 'passworduser@example.com', password: 'pass' },
    ]
  );

  const state = {
    panelMode: 'codex2api',
    codex2apiLoginOnlyMode: true,
    codex2apiLoginAccounts: [
      { email: 'alpha@example.com', password: 'alpha-pass' },
      { email: 'beta@example.com', password: 'beta-pass' },
    ],
    mailProvider: 'custom',
    emailGenerator: 'custom',
  };

  assert.equal(api.isCodex2ApiLoginOnlyMode(state), true);
  assert.deepStrictEqual(
    api.getCodex2ApiLoginAccountForRun(state, 2),
    { email: 'beta@example.com', password: 'beta-pass' }
  );
  assert.equal(api.getCodex2ApiLoginAccountForRun(state, 3), null);
  assert.equal(api.shouldUseCustomRegistrationEmail(state), false);
  assert.deepStrictEqual(api.getMailConfig(state), {
    provider: 'tempmail-public',
    label: 'TempMail 公共收件箱',
  });
  assert.deepStrictEqual(api.getMailConfig({
    ...state,
    codex2apiLoginCodeProvider: 'ikona-oni',
  }), {
    provider: 'ikona-oni',
    label: 'Ikona-Oni API',
  });
});

test('background auto-run jumps directly into steps 7-10 for Codex2API login-only mode', async () => {
  const bundle = [
    extractFunction('isAddPhoneAuthFailure'),
    extractFunction('isAddPhoneAuthUrl'),
    extractFunction('isAddPhoneAuthState'),
    extractFunction('isOpenAiAccountDisabledFailure'),
    extractFunction('isOpenAiAccountDisabledAuthState'),
    extractFunction('getPostStep6AutoRestartDecision'),
    extractFunction('isCodex2ApiLoginOnlyMode'),
    extractFunction('runAutoSequenceFromStep'),
  ].join('\n');

  const harness = new Function(`
const AUTO_STEP_DELAYS = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
const FINAL_OAUTH_CHAIN_START_STEP = 7;
const LOG_PREFIX = '[test]';
const SIGNUP_METHOD_PHONE = 'phone';
const chrome = {
  tabs: {
    update: async () => {},
  },
};
const events = {
  steps: [],
  ensureCalls: 0,
};

async function addLog() {}
async function ensureAutoEmailReady() {
  events.ensureCalls += 1;
}
async function broadcastAutoRunStatus() {}
async function ensureResolvedSignupMethodForRun() {
  return 'email';
}
async function getState() {
  return {
    panelMode: 'codex2api',
    codex2apiLoginOnlyMode: true,
    stepStatuses: {},
  };
}
function normalizePanelMode(value = '') {
  return String(value || '').trim().toLowerCase() === 'codex2api' ? 'codex2api' : 'cpa';
}
function isStopError(error) {
  return (error?.message || String(error || '')) === '流程已被用户停止。';
}
function isStepDoneStatus(status) {
  return status === 'completed' || status === 'manual_completed' || status === 'skipped';
}
async function executeStepAndWait(step) {
  events.steps.push(step);
}
async function executeStepAndWaitWithAutoRunIdleLogWatchdog(step) {
  events.steps.push(step);
}
async function runAutoStepActionWithIdleLogWatchdog(_step, action) {
  return action();
}
function isAutoRunStepIdleRestartError() {
  return false;
}
async function getTabId() {
  return 0;
}
function getLastStepIdForState() {
  return 10;
}
function getStepDefinitionForState(step) {
  return [7, 8, 9, 10].includes(Number(step))
    ? { id: Number(step), key: ['oauth-login', 'fetch-login-code', 'confirm-oauth', 'platform-verify'][Number(step) - 7] }
    : null;
}
async function invalidateDownstreamAfterStepRestart() {}
async function setState() {}
function getLoginAuthStateLabel(state) {
  return state || 'unknown';
}
function getErrorMessage(error) {
  return error?.message || String(error || '');
}
async function getLoginAuthStateFromContent() {
  return { state: 'oauth_consent_page', url: 'https://auth.openai.com/authorize?client=test' };
}
function isSignupUserAlreadyExistsFailure() {
  return false;
}
function isMail2925ThreadTerminatedError() {
  return false;
}
function getAuthChainStartStepId() {
  return 7;
}

${bundle}

return {
  async run() {
    await runAutoSequenceFromStep(1, {
      targetRun: 1,
      totalRuns: 1,
      attemptRuns: 1,
      continued: false,
    });
    return events;
  },
};
`)();

  const events = await harness.run();

  assert.equal(events.ensureCalls, 1);
  assert.deepStrictEqual(events.steps, [7, 8, 9, 10]);
});
