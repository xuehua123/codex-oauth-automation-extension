const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('sidepanel loads icloud manager before sidepanel bootstrap', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const icloudManagerIndex = html.indexOf('<script src="icloud-manager.js"></script>');
  const sidepanelIndex = html.indexOf('<script src="sidepanel.js"></script>');

  assert.notEqual(icloudManagerIndex, -1);
  assert.notEqual(sidepanelIndex, -1);
  assert.ok(icloudManagerIndex < sidepanelIndex);
});

test('sidepanel source binds the icloud fetch mode control before using it', () => {
  const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

  assert.match(source, /const selectIcloudFetchMode = document\.getElementById\('select-icloud-fetch-mode'\);/);
  assert.match(source, /selectIcloudFetchMode\?\.addEventListener\('change'/);
});

test('update card highlights exporting config before upgrade', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const css = fs.readFileSync('sidepanel/sidepanel.css', 'utf8');

  assert.match(html, /id="btn-ignore-release"/);
  assert.match(html, /class="update-card-actions"/);
  assert.match(css, /\.update-card-actions\s*\{/);
  assert.match(html, /<p class="update-card-reminder">一定请先导出配置，再执行更新<\/p>/);
  assert.match(css, /\.update-card-reminder\s*\{/);
  assert.match(css, /font-weight:\s*700;/);
  assert.match(css, /color:\s*var\(--orange\);/);
});

test('icloud manager exposes a factory and renders empty state', () => {
  const source = fs.readFileSync('sidepanel/icloud-manager.js', 'utf8');
  const windowObject = {};

  const api = new Function('window', `${source}; return window.SidepanelIcloudManager;`)(windowObject);

  assert.equal(typeof api?.createIcloudManager, 'function');

  const manager = api.createIcloudManager({
    dom: {
      btnIcloudBulkDelete: { disabled: false },
      btnIcloudBulkPreserve: { disabled: false },
      btnIcloudBulkUnpreserve: { disabled: false },
      btnIcloudBulkUnused: { disabled: false },
      btnIcloudBulkUsed: { disabled: false },
      btnIcloudDeleteUsed: { disabled: false },
      btnIcloudLoginDone: { disabled: false },
      btnIcloudRefresh: { disabled: false },
      checkboxIcloudSelectAll: { checked: false, indeterminate: false, disabled: false },
      icloudList: { innerHTML: '' },
      icloudLoginHelp: { style: { display: 'none' } },
      icloudLoginHelpText: { textContent: '' },
      icloudLoginHelpTitle: { textContent: '' },
      icloudSection: { style: { display: '' } },
      icloudSelectionSummary: { textContent: '' },
      icloudSummary: { textContent: '' },
      inputIcloudSearch: { value: '', disabled: false },
      selectIcloudFilter: { value: 'all', disabled: false },
    },
    helpers: {
      escapeHtml: (value) => String(value || ''),
      openConfirmModal: async () => true,
      showToast() {},
    },
    runtime: {
      sendMessage: async () => ({ aliases: [] }),
    },
  });

  assert.equal(typeof manager.renderIcloudAliases, 'function');
  assert.equal(typeof manager.refreshIcloudAliases, 'function');
  assert.equal(typeof manager.queueIcloudAliasRefresh, 'function');
  assert.equal(typeof manager.reset, 'function');

  manager.renderIcloudAliases([]);
  assert.equal(manager.hasDeletableUsedAliases(), false);
});

test('icloud manager retries alias refresh instead of CHECK_ICLOUD_SESSION when the login help is for Apple Account', async () => {
  const source = fs.readFileSync('sidepanel/icloud-manager.js', 'utf8');
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelIcloudManager;`)(windowObject);

  const listeners = {};
  const runtimeCalls = [];
  const createButton = () => ({
    disabled: false,
    addEventListener() {},
  });
  const dom = {
    btnIcloudBulkDelete: createButton(),
    btnIcloudBulkPreserve: createButton(),
    btnIcloudBulkUnpreserve: createButton(),
    btnIcloudBulkUnused: createButton(),
    btnIcloudBulkUsed: createButton(),
    btnIcloudDeleteUsed: createButton(),
    btnIcloudLoginDone: {
      disabled: false,
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
    },
    btnIcloudRefresh: createButton(),
    checkboxIcloudSelectAll: { checked: false, indeterminate: false, disabled: false, addEventListener() {} },
    icloudList: { innerHTML: '' },
    icloudLoginHelp: { style: { display: 'none' } },
    icloudLoginHelpText: { textContent: '' },
    icloudLoginHelpTitle: { textContent: '' },
    icloudSection: { style: { display: '' } },
    icloudSelectionSummary: { textContent: '' },
    icloudSummary: { textContent: '' },
    inputIcloudSearch: { value: '', disabled: false, addEventListener() {} },
    selectIcloudFilter: { value: 'all', disabled: false, addEventListener() {} },
  };

  const manager = api.createIcloudManager({
    dom,
    helpers: {
      escapeHtml: (value) => String(value || ''),
      openConfirmModal: async () => true,
      showToast() {},
    },
    runtime: {
      async sendMessage(message) {
        runtimeCalls.push(message);
        if (message.type === 'LIST_ICLOUD_ALIASES') {
          return {
            aliases: [
              { email: 'fresh@icloud.com', anonymousId: 'alias-1', active: true, used: false, preserved: false, source: 'apple-account' },
            ],
          };
        }
        return { ok: true };
      },
    },
  });

  manager.bindIcloudEvents();
  manager.showIcloudLoginHelp({
    loginContext: 'apple-account',
    title: '需要登录 Apple Account',
    text: '我已经为你打开 account.apple.com。请登录后再回来点击“我已登录”。',
    loginUrl: 'https://account.apple.com/account/manage/section/privacy',
  });

  await listeners.click();

  assert.equal(runtimeCalls.length, 1);
  assert.equal(runtimeCalls[0]?.type, 'LIST_ICLOUD_ALIASES');
  assert.equal(dom.icloudLoginHelp.style.display, 'none');
});
