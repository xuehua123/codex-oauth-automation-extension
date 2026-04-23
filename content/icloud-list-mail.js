const ICLOUD_LIST_MAIL_PREFIX = '[MultiPage:icloud-list-mail]';
const icloudListMailIsTopFrame = window === window.top;

console.log(ICLOUD_LIST_MAIL_PREFIX, 'Content script loaded on', location.href, 'frame:', icloudListMailIsTopFrame ? 'top' : 'child');

if (!icloudListMailIsTopFrame) {
  console.log(ICLOUD_LIST_MAIL_PREFIX, 'Skipping child frame');
} else {
  const TIMESTAMP_TEXT_FRAGMENT_PATTERNS = [
    /\b\d{13}\b/g,
    /\b\d{10}\b/g,
    /\b\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?: ?(?:Z|[+-]\d{2}:?\d{2}))?\b/g,
    /\b\d{4}\/\d{1,2}\/\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?\b/g,
    /\b\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}(?::\d{2})?\b/g,
  ];

  function extractVerificationCode(text) {
    const source = String(text || '');
    const matchCn = source.match(/(?:验证码|校验码|动态码|代码为)[^0-9]{0,20}(\d{6})/i);
    if (matchCn) return matchCn[1];

    const matchEn = source.match(/(?:verification code|code is|security code|one-time code|login code)[^0-9]{0,20}(\d{6})/i);
    if (matchEn) return matchEn[1];

    const matchStandalone = source.match(/\b(\d{6})\b/);
    return matchStandalone ? matchStandalone[1] : '';
  }

  function normalizeTimestampCandidateText(text) {
    let normalized = String(text || '').trim();
    if (!normalized) {
      return '';
    }

    normalized = normalized
      .replace(/年/g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, ' ')
      .replace(/\//g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}/.test(normalized)) {
      normalized = normalized.replace(/\s+/, 'T');
    }

    return normalized;
  }

  function normalizeTimestampValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0;
    }
    if (numeric >= 1000000000000) {
      return Math.floor(numeric);
    }
    if (numeric >= 1000000000) {
      return Math.floor(numeric * 1000);
    }
    return 0;
  }

  function hasTimestampTimePrecision(text) {
    const normalized = normalizeTimestampCandidateText(text);
    if (!normalized) {
      return false;
    }

    if (/^\d{10,13}$/.test(normalized)) {
      return true;
    }

    return /(?:^|[ T])\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:$| ?(?:Z|[+-]\d{2}:?\d{2}))/.test(normalized);
  }

  function extractTimestamp(text) {
    const source = String(text || '');
    const normalizedSource = normalizeTimestampCandidateText(source);
    let latest = 0;

    if (normalizedSource && hasTimestampTimePrecision(source)) {
      const parsed = Date.parse(normalizedSource);
      if (Number.isFinite(parsed)) {
        latest = parsed;
      } else {
        latest = normalizeTimestampValue(normalizedSource);
      }
    }

    for (const pattern of TIMESTAMP_TEXT_FRAGMENT_PATTERNS) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match) {
        const normalizedMatch = normalizeTimestampCandidateText(match[0]);
        if (normalizedMatch && hasTimestampTimePrecision(match[0])) {
          const parsed = Date.parse(normalizedMatch);
          if (Number.isFinite(parsed)) {
            latest = Math.max(latest, parsed);
          } else {
            latest = Math.max(latest, normalizeTimestampValue(normalizedMatch));
          }
        }
        match = pattern.exec(source);
      }
    }

    return latest;
  }

  function extractFreshTimestamp(text) {
    const source = String(text || '').trim();
    if (!source) return 0;
    return extractTimestamp(source);
  }

  function collectVisibleTexts() {
    const bucket = [];
    const appendText = (value) => {
      const normalized = String(value || '').replace(/\s+/g, ' ').trim();
      if (normalized) {
        bucket.push(normalized);
      }
    };

    appendText(document.title);
    appendText(document.body?.innerText || '');

    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
      try {
        appendText(frame.contentDocument?.body?.innerText || '');
      } catch {}
    }

    return bucket;
  }

  async function inspectCurrentPageSnapshot(step, payload = {}) {
    const texts = collectVisibleTexts();
    const excludedCodes = new Set((payload.excludeCodes || []).filter(Boolean));
    const filterAfterTimestamp = Number(payload.filterAfterTimestamp || 0) || 0;

    for (const text of texts) {
      const code = extractVerificationCode(text);
      if (!code) {
        continue;
      }
      if (excludedCodes.has(code)) {
        continue;
      }

      const emailTimestamp = extractFreshTimestamp(text);
      if (emailTimestamp > 0 && filterAfterTimestamp > 0 && emailTimestamp < filterAfterTimestamp) {
        continue;
      }

      return {
        ok: true,
        code,
        emailTimestamp: emailTimestamp || Date.now(),
      };
    }

    throw new Error(`步骤 ${step}：当前验证码链接页面中未找到新的 6 位验证码。`);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'POLL_EMAIL') {
      return undefined;
    }

    resetStopState();
    inspectCurrentPageSnapshot(message.step, message.payload || {})
      .then((result) => {
        sendResponse(result);
      })
      .catch((err) => {
        if (isStopError(err)) {
          sendResponse({ stopped: true, error: err.message });
          return;
        }
        sendResponse({ error: err.message });
      });

    return true;
  });
}
