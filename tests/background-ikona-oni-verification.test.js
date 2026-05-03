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

function buildHarness(fetchImpl, matcherImpl = null) {
  const bundle = [
    extractFunction('normalizeIkonaOniBaseUrl'),
    extractFunction('normalizeTempmailPublicInboxEmails'),
    extractFunction('fetchIkonaOniOtpPayload'),
    extractFunction('extractIkonaOniOtpFromPayload'),
    extractFunction('fetchIkonaOniPublicInboxEmails'),
    extractFunction('pollIkonaOniVerificationCode'),
  ].join('\n');

  return new Function('fetch', 'pickVerificationMessageWithTimeFallback', `
const DEFAULT_IKONA_ONI_BASE_URL = 'https://tempmail-worker.hasildia1.workers.dev';
const logs = [];
function normalizeHotmailMailApiMessages(messages = []) {
  return Array.isArray(messages) ? messages : [];
}
function extractVerificationCodeFromMessage(message = {}) {
  const source = [message.subject, message.bodyPreview, message.text].filter(Boolean).join(' ');
  const match = source.match(/\\b(\\d{6})\\b/);
  return match ? match[1] : null;
}
async function addLog(message, level = 'info') {
  logs.push({ message, level });
}
function throwIfStopped() {}
async function sleepWithStop() {}

${bundle}

return {
  logs,
  pollIkonaOniVerificationCode,
};
`)(fetchImpl, matcherImpl || (() => ({ match: null })));
}

test('Ikona-Oni polling uses the official OTP API when an API key is configured', async () => {
  const requests = [];
  const api = buildHarness(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          otp: '654321',
          email: { id: 'mail-1' },
        },
      }),
    };
  });

  const result = await api.pollIkonaOniVerificationCode(8, {
    email: 'User@Example.com',
    ikonaOniApiKey: 'tmp_test',
    ikonaOniBaseUrl: 'https://tempmail-worker.hasildia1.workers.dev/',
  }, {});

  assert.equal(result.code, '654321');
  assert.equal(result.mailId, 'mail-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://tempmail-worker.hasildia1.workers.dev/api/otp/user%40example.com');
  assert.equal(requests[0].options.headers['x-api-key'], 'tmp_test');
});

test('Ikona-Oni polling falls back to the public inbox when no API key is configured', async () => {
  const requests = [];
  const api = buildHarness(
    async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          data: {
            emails: [{ id: 'mail-2', subject: 'OpenAI code 112233' }],
          },
        }),
      };
    },
    (messages) => ({
      match: {
        code: '112233',
        receivedAt: 789,
        message: messages[0],
      },
    })
  );

  const result = await api.pollIkonaOniVerificationCode(8, {
    email: 'user@example.com',
    ikonaOniBaseUrl: 'https://tempmail-worker.hasildia1.workers.dev',
  }, {});

  assert.equal(result.code, '112233');
  assert.equal(result.emailTimestamp, 789);
  assert.equal(result.mailId, 'mail-2');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://tempmail-worker.hasildia1.workers.dev/inbox/user%40example.com');
  assert.equal(requests[0].options.headers.Accept, 'application/json');
});
