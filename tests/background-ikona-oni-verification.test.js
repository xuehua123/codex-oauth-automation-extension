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
    extractFunction('fetchTempmailPublicInboxEmails'),
    extractFunction('decodeTempmailPublicHtmlText'),
    extractFunction('fetchTempmailPublicEmailViewText'),
    extractFunction('enrichTempmailPublicMessagesWithViewText'),
    extractFunction('fetchIkonaOniOtpPayload'),
    extractFunction('extractIkonaOniOtpFromPayload'),
    extractFunction('fetchIkonaOniPublicInboxEmails'),
    extractFunction('pollIkonaOniVerificationCode'),
    extractFunction('pollTempmailPublicVerificationCode'),
  ].join('\n');

  return new Function('fetch', 'pickVerificationMessageWithTimeFallback', `
const DEFAULT_IKONA_ONI_BASE_URL = 'https://tempmail-worker.hasildia1.workers.dev';
const TEMPMAIL_PUBLIC_INBOX_BASE_URL = 'https://tempmail-worker.hasildia1.workers.dev';
const logs = [];
function normalizeHotmailMailApiMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    id: String(message.id || message.message_id || ''),
    subject: String(message.subject || message.title || ''),
    from: { emailAddress: { address: String(message.from_address || message.sender_address || message.from_email || message.sender_email || message.from || '') } },
    bodyPreview: String(message.bodyPreview || message.preview || message.snippet || message.text_content || message.text || message.body || message.html_content || message.html || message.content || ''),
    receivedDateTime: String(message.receivedDateTime || message.received_at || message.receivedAt || message.date || message.created_at || message.time || ''),
  }));
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
  pollTempmailPublicVerificationCode,
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

test('Ikona-Oni public inbox polling reads the configured detail view when list mail has no body', async () => {
  const requests = [];
  const api = buildHarness(
    async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/inbox/user%40example.com')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              emails: [
                {
                  id: 'ikona-mail-1',
                  from_address: 'bounces+user@em7877.tm.openai.com',
                  subject: 'Your temporary ChatGPT login code',
                  created_at: '2026-05-03T19:01:42.790346+00:00',
                },
              ],
            },
          }),
        };
      }
      if (url.endsWith('/view/ikona-mail-1')) {
        return {
          ok: true,
          text: async () => '<main>Enter this temporary verification code to continue: 445566.</main>',
        };
      }
      throw new Error(`unexpected url ${url}`);
    },
    (messages) => {
      assert.match(messages[0].bodyPreview, /445566/);
      return {
        match: {
          code: '445566',
          receivedAt: 999,
          message: messages[0],
        },
      };
    }
  );

  const result = await api.pollIkonaOniVerificationCode(8, {
    email: 'user@example.com',
    ikonaOniBaseUrl: 'https://ikona-oni.com/',
  }, {
    maxAttempts: 1,
  });

  assert.equal(result.code, '445566');
  assert.equal(result.mailId, 'ikona-mail-1');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://ikona-oni.com/inbox/user%40example.com');
  assert.equal(requests[1].url, 'https://ikona-oni.com/view/ikona-mail-1');
});

test('TempMail public polling reads the message detail view when the inbox list omits the code body', async () => {
  const requests = [];
  const api = buildHarness(
    async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/inbox/user%40example.com')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              address: 'user@example.com',
              emails: [
                {
                  id: 'mail-detail-1',
                  from_address: 'bounces+user@em7877.tm.openai.com',
                  subject: 'Your temporary ChatGPT login code',
                  created_at: '2026-05-03T19:01:42.790346+00:00',
                },
              ],
            },
          }),
        };
      }
      if (url.endsWith('/view/mail-detail-1')) {
        return {
          ok: true,
          text: async () => `
            <html>
              <head><style>.detail { color: #718096; }</style></head>
              <body>Enter this temporary verification code to continue: 030199.</body>
            </html>
          `,
        };
      }
      throw new Error(`unexpected url ${url}`);
    },
    (messages) => {
      assert.equal(messages.length, 1);
      assert.match(messages[0].bodyPreview, /030199/);
      assert.doesNotMatch(messages[0].bodyPreview, /718096/);
      return {
        match: {
          code: '030199',
          receivedAt: Date.parse(messages[0].receivedDateTime),
          message: messages[0],
        },
      };
    }
  );

  const result = await api.pollTempmailPublicVerificationCode(8, {
    email: 'User@Example.com',
  }, {
    maxAttempts: 1,
  });

  assert.equal(result.code, '030199');
  assert.equal(result.mailId, 'mail-detail-1');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://tempmail-worker.hasildia1.workers.dev/inbox/user%40example.com');
  assert.equal(requests[1].url, 'https://tempmail-worker.hasildia1.workers.dev/view/mail-detail-1');
  assert.equal(requests[1].options.headers.Accept, 'text/html,application/json');
});
