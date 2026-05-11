const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

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

const bundle = [
  extractFunction('getPageTextSnapshot'),
  extractFunction('getAccountDisabledAuthPageState'),
  extractFunction('getLoginVerificationDisplayedEmail'),
  extractFunction('getPhoneVerificationDisplayedPhone'),
  extractFunction('isPhoneVerificationPageReady'),
  extractFunction('inspectLoginAuthState'),
  extractFunction('normalizeStep6Snapshot'),
].join('\n');

function createApi(overrides = {}) {
  return new Function(`
const location = {
  href: ${JSON.stringify(overrides.href || 'https://auth.openai.com/log-in')},
  pathname: ${JSON.stringify(overrides.pathname || '/log-in')},
};

const OPENAI_ACCOUNT_DISABLED_PATTERN = /account[_\\s-]*(?:deactivated|disabled|suspended|banned|blocked|terminated|locked)|(?:your|this|openai|chatgpt)?\\s*(?:account|user)\\s+(?:has\\s+been|was|is)\\s+(?:deactivated|disabled|suspended|banned|blocked|terminated|locked)|(?:we|openai)\\s+(?:have|has)\\s+(?:deactivated|disabled|suspended|banned|blocked|terminated|locked)\\s+(?:your|this)?\\s*(?:account|user)|(?:你的|您的|此|该)?(?:账号|账户)(?:已被|已经|被|已)?(?:禁用|停用|封禁|暂停|锁定|不可用)|(?:禁用|停用|封禁|暂停|锁定)(?:你的|您的|此|该)?(?:账号|账户)/i;

const document = {
  title: ${JSON.stringify(overrides.title || '')},
  body: {
    innerText: ${JSON.stringify(overrides.pageText || '')},
    textContent: ${JSON.stringify(overrides.pageText || '')},
  },
  querySelector() {
    return null;
  },
};

function getLoginTimeoutErrorPageState() {
  return ${JSON.stringify(overrides.retryState || null)};
}

function getVerificationCodeTarget() {
  return ${JSON.stringify(overrides.verificationTarget || null)};
}

function getLoginPasswordInput() {
  return ${JSON.stringify(overrides.passwordInput || null)};
}

function getLoginEmailInput() {
  return ${JSON.stringify(overrides.emailInput || null)};
}

function getLoginPhoneInput() {
  return ${JSON.stringify(overrides.phoneInput || null)};
}

function findOneTimeCodeLoginTrigger() {
  return ${JSON.stringify(overrides.switchTrigger || null)};
}

function findLoginEntryTrigger() {
  return ${JSON.stringify(overrides.loginEntryTrigger || null)};
}

function findLoginPhoneEntryTrigger() {
  return ${JSON.stringify(overrides.phoneEntryTrigger || null)};
}

function findLoginMoreOptionsTrigger() {
  return ${JSON.stringify(overrides.moreOptionsTrigger || null)};
}

function getLoginSubmitButton() {
  return ${JSON.stringify(overrides.submitButton || null)};
}

function isVerificationPageStillVisible() {
  return ${JSON.stringify(Boolean(overrides.verificationVisible))};
}

function isAddPhonePageReady() {
  return ${JSON.stringify(Boolean(overrides.addPhonePage))};
}

function isAddEmailPageReady() {
  return ${JSON.stringify(Boolean(overrides.addEmailPage))};
}

function isVisibleElement() {
  return true;
}

function isStep8Ready() {
  return ${JSON.stringify(Boolean(overrides.consentReady))};
}

function isOAuthConsentPage() {
  return ${JSON.stringify(Boolean(overrides.oauthConsentPage))};
}

${bundle}

return {
  inspectLoginAuthState,
  isPhoneVerificationPageReady,
  normalizeStep6Snapshot,
};
`)();
}

{
  const api = createApi({
    emailInput: { id: 'email' },
    submitButton: { id: 'submit' },
    oauthConsentPage: true,
    consentReady: true,
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(
    snapshot.state,
    'email_page',
    '第六步在 /log-in 页应优先识别为邮箱页'
  );
}

{
  const api = createApi({
    verificationTarget: { id: 'otp' },
    pageText: 'We emailed a code to display.user@example.com. Enter it below.',
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(snapshot.displayedEmail, 'display.user@example.com');
}

{
  const api = createApi({
    pathname: '/email-verification',
    href: 'https://auth.openai.com/email-verification',
    verificationTarget: { id: 'otp' },
    pageText: 'We just sent to display.user@example.com. Enter it below.',
  });

  assert.strictEqual(
    api.isPhoneVerificationPageReady(),
    false,
    '邮箱验证码页不应被误判为手机验证码页'
  );

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(snapshot.state, 'verification_page');
}

{
  const api = createApi({
    pathname: '/phone-verification',
    href: 'https://auth.openai.com/phone-verification',
    verificationTarget: { id: 'otp' },
    pageText: 'Check your phone. We just sent a code to +66 81 234 5678.',
  });

  assert.strictEqual(api.isPhoneVerificationPageReady(), true);

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(snapshot.state, 'phone_verification_page');
}

{
  const api = createApi({
    pathname: '/email-verification',
    retryState: {
      retryEnabled: true,
      titleMatched: false,
      detailMatched: false,
      routeErrorMatched: true,
    },
    verificationTarget: { id: 'otp' },
    verificationVisible: true,
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(
    snapshot.state,
    'login_timeout_error_page',
    '第七步在 /email-verification 的登录重试页应优先识别为登录超时报错页'
  );
}

{
  const api = createApi({
    oauthConsentPage: true,
    consentReady: true,
  });

  const inspected = api.inspectLoginAuthState();
  assert.strictEqual(inspected.state, 'oauth_consent_page');

  const snapshot = api.normalizeStep6Snapshot({
    state: 'oauth_consent_page',
    url: 'https://auth.openai.com/authorize',
  });

  assert.strictEqual(snapshot.state, 'oauth_consent_page', '第六步应保留 oauth_consent_page 状态');
}

{
  const api = createApi({
    loginEntryTrigger: { id: 'continue-email' },
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(snapshot.state, 'entry_page');
}

{
  const api = createApi({
    phoneInput: { id: 'phone' },
    submitButton: { id: 'submit' },
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(snapshot.state, 'phone_entry_page');
}

{
  const api = createApi({
    pageText: 'Your account has been deactivated. If you believe this was an error, contact support.',
    title: 'Account disabled',
    retryState: {
      retryEnabled: true,
      titleMatched: true,
      detailMatched: false,
      routeErrorMatched: false,
    },
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(snapshot.state, 'account_disabled_page');
  assert.strictEqual(snapshot.accountDisabledBlocked, true);
  assert.match(snapshot.errorText, /deactivated/i);
}

{
  const api = createApi({
    pathname: '/add-email',
    href: 'https://auth.openai.com/add-email',
    emailInput: { id: 'email' },
    submitButton: { id: 'submit' },
    addEmailPage: true,
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(snapshot.state, 'add_email_page');
  assert.strictEqual(snapshot.addEmailPage, true);
}

{
  const api = createApi({
    pageText: 'Oops, an error occurred! An error occurred during authentication (account_deactivated). Please try again.',
    title: 'Oops, an error occurred!',
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(snapshot.state, 'account_disabled_page');
  assert.strictEqual(snapshot.accountDisabledBlocked, true);
  assert.match(snapshot.errorText, /account_deactivated/i);
}

{
  const api = createApi({
    pageText: '((storageKey2, restoreKey) => { window.history.replaceState({ key }, ""); const ariaDisabled = true; const accountMenuDisabled = false; })',
    title: 'Log in',
  });

  const snapshot = api.inspectLoginAuthState();
  assert.notStrictEqual(
    snapshot.state,
    'account_disabled_page',
    '脚本源码里的 disabled/account 不应触发账号禁用识别'
  );
}

assert.ok(
  extractFunction('inspectLoginAuthState').includes("state: 'oauth_consent_page'"),
  'inspectLoginAuthState 应产出 oauth_consent_page 状态'
);

assert.ok(
  extractFunction('inspectLoginAuthState').includes("state: 'phone_entry_page'"),
  'inspectLoginAuthState 应产出 phone_entry_page 状态'
);

assert.ok(
  extractFunction('inspectLoginAuthState').includes("state: 'add_email_page'"),
  'inspectLoginAuthState 应产出 add_email_page 状态'
);

console.log('step6 login state tests passed');
