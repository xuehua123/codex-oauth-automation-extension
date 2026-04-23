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

const bundle = [
  extractFunction('scoreIcloudPageTab'),
  extractFunction('getOrderedIcloudPageTabs'),
].join('\n');

function createApi() {
  return new Function(`
function normalizeIcloudHost(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'icloud.com' || normalized === 'setup.icloud.com' || normalized === 'www.icloud.com'
    ? 'icloud.com'
    : normalized === 'icloud.com.cn' || normalized === 'setup.icloud.com.cn' || normalized === 'www.icloud.com.cn'
      ? 'icloud.com.cn'
      : '';
}

${bundle}

return {
  scoreIcloudPageTab,
  getOrderedIcloudPageTabs,
};
`)();
}

test('getOrderedIcloudPageTabs prefers /icloudplus/ over a merely active root tab on the same host', () => {
  const api = createApi();

  const ordered = api.getOrderedIcloudPageTabs([
    { id: 1, active: true, url: 'https://www.icloud.com/' },
    { id: 2, active: false, url: 'https://www.icloud.com/icloudplus/' },
  ], 'icloud.com');

  assert.deepEqual(
    ordered.map((tab) => tab.id),
    [2, 1]
  );
});

test('getOrderedIcloudPageTabs still respects preferred host when both hosts are open', () => {
  const api = createApi();

  const ordered = api.getOrderedIcloudPageTabs([
    { id: 1, active: true, url: 'https://www.icloud.com.cn/icloudplus/' },
    { id: 2, active: false, url: 'https://www.icloud.com/icloudplus/' },
  ], 'icloud.com');

  assert.deepEqual(
    ordered.map((tab) => tab.id),
    [2, 1]
  );
});
