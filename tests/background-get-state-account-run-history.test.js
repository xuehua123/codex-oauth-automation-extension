const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const backgroundSource = fs.readFileSync('background.js', 'utf8');

function extractFunction(source, name) {
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

test('getState keeps persisted account run history instead of session snapshot', async () => {
  const bundle = extractFunction(backgroundSource, 'getState');

  const api = new Function(`
const DEFAULT_STATE = {
  accountRunHistory: [],
  panelMode: 'cpa',
};
const chrome = {
  storage: {
    session: {
      async get() {
        return {
          accountRunHistory: [],
          panelMode: 'sub2api',
          email: 'runner@example.com',
        };
      },
    },
  },
};
async function getPersistedSettings() {
  return { vpsUrl: 'http://127.0.0.1:8317' };
}
async function getPersistedAliasState() {
  return { currentIcloudListEmail: 'list@example.com' };
}
const accountRunHistoryHelpers = {
  async getPersistedAccountRunHistory() {
    return [
      {
        email: 'success@example.com',
        password: 'Secret123!',
        finalStatus: 'success',
        finishedAt: '2026-04-22T08:00:00.000Z',
      },
    ];
  },
};
${bundle}
return { getState };
`)();

  const state = await api.getState();

  assert.deepStrictEqual(state.accountRunHistory, [
    {
      email: 'success@example.com',
      password: 'Secret123!',
      finalStatus: 'success',
      finishedAt: '2026-04-22T08:00:00.000Z',
    },
  ]);
  assert.equal(state.email, 'runner@example.com');
  assert.equal(state.panelMode, 'sub2api');
  assert.equal(state.vpsUrl, 'http://127.0.0.1:8317');
  assert.equal(state.currentIcloudListEmail, 'list@example.com');
});
