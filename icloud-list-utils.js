(function icloudListUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.IcloudListUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createIcloudListUtils() {
  const ENTRY_ID_PREFIX = 'icloud-list-';
  const MAX_OBJECT_WALK_DEPTH = 4;
  const TIMESTAMP_TEXT_FRAGMENT_PATTERNS = [
    /\b\d{13}\b/g,
    /\b\d{10}\b/g,
    /\b\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?: ?(?:Z|[+-]\d{2}:?\d{2}))?\b/g,
    /\b\d{4}\/\d{1,2}\/\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?\b/g,
    /\b\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}(?::\d{2})?\b/g,
  ];

  function normalizeTimestampCandidateText(value = '') {
    let normalized = String(value || '').trim();
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

  function normalizeIcloudListEmail(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
  }

  function isIpv4Segment(value = '') {
    return /^\d{1,3}$/.test(value);
  }

  function isPrivateOrLoopbackIpv4(hostname = '') {
    const parts = String(hostname || '').trim().split('.');
    if (parts.length !== 4 || parts.some((part) => !isIpv4Segment(part))) {
      return false;
    }

    const [first, second, third, fourth] = parts.map((part) => Number(part));
    if ([first, second, third, fourth].some((part) => part < 0 || part > 255)) {
      return false;
    }

    return first === 10
      || first === 127
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }

  function isUnsafeIcloudListHost(hostname = '') {
    const normalized = String(hostname || '').trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    return normalized === 'localhost'
      || normalized === '::1'
      || normalized === '[::1]'
      || normalized === 'host.docker.internal'
      || normalized.endsWith('.local')
      || isPrivateOrLoopbackIpv4(normalized);
  }

  function normalizeIcloudListUrl(value = '') {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';

    try {
      const parsed = new URL(rawValue);
      if (!/^https?:$/i.test(String(parsed.protocol || ''))) {
        return '';
      }
      if (isUnsafeIcloudListHost(parsed.hostname)) {
        return '';
      }
      return parsed.toString();
    } catch {
      return '';
    }
  }

  function normalizeIcloudListTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value >= 1000000000000) {
        return Math.floor(value);
      }
      if (value >= 1000000000) {
        return Math.floor(value * 1000);
      }
      return 0;
    }

    const normalizedText = normalizeTimestampCandidateText(value);
    if (!normalizedText) {
      return 0;
    }

    const numeric = Number(normalizedText);
    if (Number.isFinite(numeric)) {
      if (numeric >= 1000000000000) {
        return Math.floor(numeric);
      }
      if (numeric >= 1000000000) {
        return Math.floor(numeric * 1000);
      }
      return 0;
    }

    const parsed = Date.parse(normalizedText);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function hasTimestampTimePrecision(value = '') {
    const normalizedText = normalizeTimestampCandidateText(value);
    if (!normalizedText) {
      return false;
    }

    if (/^\d{10,13}$/.test(normalizedText)) {
      return true;
    }

    return /(?:^|[ T])\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:$| ?(?:Z|[+-]\d{2}:?\d{2}))/.test(normalizedText);
  }

  function extractLatestTimestampFromText(value = '') {
    const source = String(value || '');
    let latest = hasTimestampTimePrecision(source)
      ? normalizeIcloudListTimestamp(source)
      : 0;

    for (const pattern of TIMESTAMP_TEXT_FRAGMENT_PATTERNS) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match) {
        if (hasTimestampTimePrecision(match[0])) {
          latest = Math.max(latest, normalizeIcloudListTimestamp(match[0]));
        }
        match = pattern.exec(source);
      }
    }

    return latest;
  }

  function normalizeIcloudListEntry(raw, options = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const email = normalizeIcloudListEmail(raw.email);
    const codeUrl = normalizeIcloudListUrl(raw.codeUrl);
    if (!email || !codeUrl) {
      return null;
    }

    const fallbackId = typeof options.fallbackId === 'string' ? options.fallbackId.trim() : '';
    const id = String(raw.id || fallbackId || '').trim();
    const lastUsedAt = normalizeIcloudListTimestamp(raw.lastUsedAt);

    return {
      id,
      email,
      codeUrl,
      note: String(raw.note || '').trim(),
      used: Boolean(raw.used),
      lastUsedAt,
    };
  }

  function getMaxIcloudListNumericId(entries = []) {
    return (Array.isArray(entries) ? entries : []).reduce((maxValue, entry) => {
      const id = String(entry?.id || '').trim();
      const match = id.match(/^icloud-list-(\d+)$/i);
      if (!match) return maxValue;
      return Math.max(maxValue, Number(match[1]) || 0);
    }, 0);
  }

  function createIcloudListIdGenerator(existingEntries = []) {
    let nextNumericId = getMaxIcloudListNumericId(existingEntries) + 1;

    return function generateIcloudListId() {
      const nextId = `${ENTRY_ID_PREFIX}${nextNumericId}`;
      nextNumericId += 1;
      return nextId;
    };
  }

  function normalizeIcloudListEntries(values = []) {
    const nextEntries = [];
    const seenEmails = new Set();
    const generateId = createIcloudListIdGenerator(values);

    for (const value of Array.isArray(values) ? values : []) {
      const normalized = normalizeIcloudListEntry(value, {
        fallbackId: generateId(),
      });
      if (!normalized || seenEmails.has(normalized.email)) {
        continue;
      }
      seenEmails.add(normalized.email);
      if (!normalized.id) {
        normalized.id = generateId();
      }
      nextEntries.push(normalized);
    }

    return nextEntries;
  }

  function findIcloudListEntryByEmail(entries = [], email = '') {
    const normalizedEmail = normalizeIcloudListEmail(email);
    if (!normalizedEmail) return null;

    return (Array.isArray(entries) ? entries : []).find((entry) => entry?.email === normalizedEmail) || null;
  }

  function allocateIcloudListEntry(entries = []) {
    return (Array.isArray(entries) ? entries : []).find((entry) => entry && !entry.used) || null;
  }

  function patchIcloudListEntry(entries = [], email = '', updates = {}) {
    const normalizedEmail = normalizeIcloudListEmail(email);
    if (!normalizedEmail) {
      return normalizeIcloudListEntries(entries);
    }

    return normalizeIcloudListEntries((Array.isArray(entries) ? entries : []).map((entry) => {
      if (entry?.email !== normalizedEmail) {
        return entry;
      }
      return {
        ...entry,
        ...updates,
        email: entry.email,
      };
    }));
  }

  function deleteIcloudListEntry(entries = [], email = '') {
    const normalizedEmail = normalizeIcloudListEmail(email);
    if (!normalizedEmail) {
      return normalizeIcloudListEntries(entries);
    }

    return normalizeIcloudListEntries((Array.isArray(entries) ? entries : []).filter((entry) => entry?.email !== normalizedEmail));
  }

  function resetIcloudListEntriesUsage(entries = []) {
    return normalizeIcloudListEntries((Array.isArray(entries) ? entries : []).map((entry) => ({
      ...entry,
      used: false,
      lastUsedAt: 0,
    })));
  }

  function resolveIcloudListCurrentEntry(entries = [], state = {}) {
    const rawEmail = state?.email;
    const explicitEmail = String(rawEmail || '').trim();
    if (explicitEmail) {
      return findIcloudListEntryByEmail(entries, rawEmail);
    }
    return findIcloudListEntryByEmail(entries, state?.currentIcloudListEmail);
  }

  function mergeIcloudListEntries(existingEntries = [], importedEntries = []) {
    const normalizedExistingEntries = normalizeIcloudListEntries(existingEntries);
    const existingMap = new Map(normalizedExistingEntries.map((entry) => [entry.email, entry]));
    const generateId = createIcloudListIdGenerator(normalizedExistingEntries);
    const nextEntries = [];
    const seenEmails = new Set();

    for (const rawEntry of Array.isArray(importedEntries) ? importedEntries : []) {
      const normalizedImportedEntry = normalizeIcloudListEntry(rawEntry);
      if (!normalizedImportedEntry || seenEmails.has(normalizedImportedEntry.email)) {
        continue;
      }

      seenEmails.add(normalizedImportedEntry.email);
      const existingEntry = existingMap.get(normalizedImportedEntry.email);
      nextEntries.push({
        id: existingEntry?.id || normalizedImportedEntry.id || generateId(),
        email: normalizedImportedEntry.email,
        codeUrl: normalizedImportedEntry.codeUrl,
        note: normalizedImportedEntry.note,
        used: existingEntry?.used ?? normalizedImportedEntry.used,
        lastUsedAt: existingEntry?.lastUsedAt ?? normalizedImportedEntry.lastUsedAt ?? 0,
      });
    }

    return normalizeIcloudListEntries(nextEntries);
  }

  function parseIcloudListText(text = '', options = {}) {
    const existingEntries = normalizeIcloudListEntries(options.existingEntries);
    const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const draftEntries = [];
    const errors = [];

    rawLines.forEach((line, index) => {
      const rawLine = String(line || '');
      const trimmedLine = rawLine.trim();
      const lineNumber = index + 1;

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return;
      }

      const columns = rawLine.split('\t').map((column) => String(column || '').trim());
      if (columns.length < 2) {
        errors.push({
          lineNumber,
          reason: '格式错误：请使用“邮箱<TAB>验证码链接<TAB>备注(可选)”',
          line: rawLine,
        });
        return;
      }

      const [rawEmail, rawCodeUrl, ...rawNoteParts] = columns;
      const email = normalizeIcloudListEmail(rawEmail);
      const codeUrl = normalizeIcloudListUrl(rawCodeUrl);
      const note = rawNoteParts.join('\t').trim();

      if (!email) {
        errors.push({
          lineNumber,
          reason: '邮箱格式无效',
          line: rawLine,
        });
        return;
      }
      if (!codeUrl) {
        errors.push({
          lineNumber,
          reason: '验证码链接为空或格式无效',
          line: rawLine,
        });
        return;
      }

      draftEntries.push({
        email,
        codeUrl,
        note,
        used: false,
        lastUsedAt: 0,
      });
    });

    return {
      entries: mergeIcloudListEntries(existingEntries, draftEntries),
      errors,
    };
  }

  function extractVerificationCodeFromText(value = '') {
    const source = String(value || '');
    const matchCn = source.match(/(?:验证码|校验码|动态码|代码为)[^0-9]{0,20}(\d{6})/i);
    if (matchCn) return matchCn[1];

    const matchEn = source.match(/(?:verification code|code is|security code|one-time code|login code)[^0-9]{0,20}(\d{6})/i);
    if (matchEn) return matchEn[1];

    const standaloneMatch = source.match(/\b(\d{6})\b/);
    return standaloneMatch ? standaloneMatch[1] : '';
  }

  function collectStringsFromValue(value, bucket, depth = 0, seen = new Set()) {
    if (depth > MAX_OBJECT_WALK_DEPTH || value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value).trim();
      if (text) {
        bucket.push(text);
      }
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => collectStringsFromValue(item, bucket, depth + 1, seen));
      return;
    }

    Object.values(value).forEach((item) => collectStringsFromValue(item, bucket, depth + 1, seen));
  }

  function extractVerificationCodeFromAny(value) {
    const strings = [];
    collectStringsFromValue(value, strings);
    for (const candidate of strings) {
      const code = extractVerificationCodeFromText(candidate);
      if (code) {
        return code;
      }
    }
    return '';
  }

  function extractLatestTimestampFromAny(value) {
    const strings = [];
    collectStringsFromValue(value, strings);
    return strings.reduce((latest, candidate) => Math.max(latest, extractLatestTimestampFromText(candidate)), 0);
  }

  return {
    allocateIcloudListEntry,
    deleteIcloudListEntry,
    extractLatestTimestampFromAny,
    extractLatestTimestampFromText,
    extractVerificationCodeFromAny,
    extractVerificationCodeFromText,
    findIcloudListEntryByEmail,
    mergeIcloudListEntries,
    normalizeIcloudListEmail,
    normalizeIcloudListEntries,
    normalizeIcloudListEntry,
    normalizeIcloudListTimestamp,
    normalizeIcloudListUrl,
    parseIcloudListText,
    patchIcloudListEntry,
    resetIcloudListEntriesUsage,
    resolveIcloudListCurrentEntry,
  };
});
