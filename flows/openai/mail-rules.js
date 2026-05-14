(function attachOpenAiMailRules(root, factory) {
  root.MultiPageOpenAiMailRules = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOpenAiMailRulesModule() {
  const SIGNUP_CODE_RULE_ID = 'openai-signup-code';
  const LOGIN_CODE_RULE_ID = 'openai-login-code';
  const OPENAI_CODE_PATTERNS = Object.freeze([
    Object.freeze({
      source: '(?:chatgpt\\s+log-?in\\s+code|enter\\s+this\\s+code)[^0-9]{0,24}(\\d{6})',
      flags: 'i',
    }),
    Object.freeze({
      source: 'your\\s+chatgpt\\s+code\\s+is\\s+(\\d{6})',
      flags: 'i',
    }),
    Object.freeze({
      source: '(?:verification\\s+code|temporary\\s+verification\\s+code|your\\s+chatgpt\\s+code|code(?:\\s+is)?)[^0-9]{0,16}(\\d{6})',
      flags: 'i',
    }),
  ]);
  const OPENAI_REQUIRED_KEYWORDS = Object.freeze([
    'openai',
    'chatgpt',
    'verify',
    'verification',
    'confirm',
    '验证码',
    '代码',
  ]);

  function buildTargetEmailHints(targetEmail = '') {
    const normalizedTarget = String(targetEmail || '').trim().toLowerCase();
    if (!normalizedTarget) {
      return [];
    }
    const hints = [normalizedTarget];
    const atIndex = normalizedTarget.indexOf('@');
    if (atIndex > 0) {
      hints.push(`${normalizedTarget.slice(0, atIndex)}=${normalizedTarget.slice(atIndex + 1)}`);
    }
    return [...new Set(hints)];
  }

  function createOpenAiMailRules(deps = {}) {
    const {
      getHotmailVerificationRequestTimestamp = () => 0,
      MAIL_2925_VERIFICATION_INTERVAL_MS = 15000,
      MAIL_2925_VERIFICATION_MAX_ATTEMPTS = 15,
    } = deps;

    function isMail2925Provider(state = {}) {
      return String(state?.mailProvider || '').trim().toLowerCase() === '2925';
    }

    function shouldMatchMail2925TargetEmail(state = {}) {
      return isMail2925Provider(state)
        && String(state?.mail2925Mode || '').trim().toLowerCase() === 'receive';
    }

    function getRuleDefinition(step, state = {}) {
      const normalizedStep = Number(step) === 4 ? 4 : 8;
      const mail2925Provider = isMail2925Provider(state);
      const signupStep = normalizedStep === 4;
      const targetEmail = signupStep
        ? state?.email
        : (String(state?.step8VerificationTargetEmail || '').trim() || state?.email);

      return {
        flowId: 'openai',
        ruleId: signupStep ? SIGNUP_CODE_RULE_ID : LOGIN_CODE_RULE_ID,
        step: normalizedStep,
        artifactType: 'code',
        codePatterns: OPENAI_CODE_PATTERNS,
        filterAfterTimestamp: mail2925Provider
          ? 0
          : getHotmailVerificationRequestTimestamp(normalizedStep, state),
        requiredKeywords: signupStep
          ? OPENAI_REQUIRED_KEYWORDS
          : [...OPENAI_REQUIRED_KEYWORDS, 'login'],
        senderFilters: signupStep
          ? ['openai', 'noreply', 'verify', 'auth', 'duckduckgo', 'forward']
          : ['openai', 'noreply', 'verify', 'auth', 'chatgpt', 'duckduckgo', 'forward'],
        subjectFilters: signupStep
          ? ['verify', 'verification', 'code', '验证码', 'confirm']
          : ['verify', 'verification', 'code', '验证码', 'confirm', 'login'],
        targetEmail,
        targetEmailHints: buildTargetEmailHints(targetEmail),
        mail2925MatchTargetEmail: shouldMatchMail2925TargetEmail(state),
        maxAttempts: mail2925Provider ? MAIL_2925_VERIFICATION_MAX_ATTEMPTS : 5,
        intervalMs: mail2925Provider ? MAIL_2925_VERIFICATION_INTERVAL_MS : 3000,
      };
    }

    function buildVerificationPollPayload(step, state = {}, overrides = {}) {
      return {
        ...getRuleDefinition(step, state),
        ...(overrides || {}),
      };
    }

    return {
      buildVerificationPollPayload,
      getRuleDefinition,
    };
  }

  return {
    LOGIN_CODE_RULE_ID,
    SIGNUP_CODE_RULE_ID,
    createOpenAiMailRules,
  };
});
