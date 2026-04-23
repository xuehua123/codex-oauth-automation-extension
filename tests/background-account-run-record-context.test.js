const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (!Number.isInteger(start) || start < 0) {
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

test('background resolves account run record context from icloud-list rows and panel mode', () => {
  const bundle = [
    extractFunction('normalizeMailProvider'),
    extractFunction('normalizeEmailGenerator'),
    extractFunction('normalizeLocalCpaStep9Mode'),
    extractFunction('parseUrlSafely'),
    extractFunction('isLocalCpaUrl'),
    extractFunction('shouldBypassStep9ForLocalCpa'),
    extractFunction('getIcloudListEntries'),
    extractFunction('getCurrentIcloudListEntry'),
    extractFunction('resolveAccountRunRecordContext'),
  ].join('\n');

  const api = new Function(`
const ICLOUD_LIST_PROVIDER = 'icloud-list';
const ICLOUD_PROVIDER = 'icloud';
const GMAIL_PROVIDER = 'gmail';
const HOTMAIL_PROVIDER = 'hotmail-api';
const LUCKMAIL_PROVIDER = 'luckmail-api';
const CLOUDFLARE_TEMP_EMAIL_PROVIDER = 'cloudflare-temp-email';
const CLOUDFLARE_TEMP_EMAIL_GENERATOR = 'cloudflare-temp-email';
const DEFAULT_LOCAL_CPA_STEP9_MODE = 'submit';
const PERSISTED_SETTING_DEFAULTS = {
  mailProvider: '163',
  emailGenerator: 'duck',
};
function normalizeIcloudListEntries(value) { return Array.isArray(value) ? value : []; }
function normalizeIcloudListEmail(value) { return String(value || '').trim().toLowerCase(); }
function resolveIcloudListCurrentEntry(entries = [], state = {}) {
  const targetEmail = normalizeIcloudListEmail(state?.email) || normalizeIcloudListEmail(state?.currentIcloudListEmail);
  return (Array.isArray(entries) ? entries : []).find((entry) => normalizeIcloudListEmail(entry?.email) === targetEmail) || null;
}
${bundle}
return { resolveAccountRunRecordContext };
`)();

  assert.deepStrictEqual(api.resolveAccountRunRecordContext({
    email: 'fresh@icloud.com',
    currentIcloudListEmail: 'fresh@icloud.com',
    emailGenerator: 'icloud-list',
    panelMode: 'cpa',
    icloudListEntries: [
      {
        email: 'fresh@icloud.com',
        codeUrl: 'https://example.com/code/1',
        note: 'main',
      },
    ],
  }, 'success'), {
    verificationCodeUrl: 'https://example.com/code/1',
    verificationCodeNote: 'main',
    importTarget: 'cpa',
    importedToPanel: true,
  });

  assert.deepStrictEqual(api.resolveAccountRunRecordContext({
    email: 'fresh@icloud.com',
    currentIcloudListEmail: 'fresh@icloud.com',
    mailProvider: 'icloud-list',
    panelMode: 'cpa',
    localCpaStep9Mode: 'bypass',
    vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
    localhostUrl: 'http://127.0.0.1:8317/callback?code=1',
    icloudListEntries: [
      {
        email: 'fresh@icloud.com',
        codeUrl: 'https://example.com/code/1',
        note: '',
      },
    ],
  }, 'success'), {
    verificationCodeUrl: 'https://example.com/code/1',
    verificationCodeNote: '',
    importTarget: 'cpa',
    importedToPanel: false,
  });

  assert.deepStrictEqual(api.resolveAccountRunRecordContext({
    email: 'fresh@icloud.com',
    currentIcloudListEmail: 'fresh@icloud.com',
    mailProvider: 'icloud-list',
    panelMode: 'sub2api',
    icloudListEntries: [
      {
        email: 'fresh@icloud.com',
        codeUrl: 'https://example.com/code/1',
        note: '',
      },
    ],
  }, 'failed'), {
    verificationCodeUrl: 'https://example.com/code/1',
    verificationCodeNote: '',
    importTarget: 'sub2api',
    importedToPanel: false,
  });
});
