const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('sidepanel exposes icloud-list provider, generator, and manager script', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(html, /<option value="icloud-list">iCloud 列表（链接取码）<\/option>/);
  assert.match(html, /<option value="icloud-list">iCloud 列表<\/option>/);

  const managerIndex = html.indexOf('<script src="icloud-list-manager.js"></script>');
  const sidepanelIndex = html.indexOf('<script src="sidepanel.js"></script>');
  assert.notEqual(managerIndex, -1);
  assert.notEqual(sidepanelIndex, -1);
  assert.ok(managerIndex < sidepanelIndex);
});

test('icloud-list manager exposes a factory and renders entries', () => {
  const source = fs.readFileSync('sidepanel/icloud-list-manager.js', 'utf8');
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelIcloudListManager;`)(windowObject);

  assert.equal(typeof api?.createIcloudListManager, 'function');

  const dom = {
    btnIcloudListApply: { disabled: false, addEventListener() {} },
    btnIcloudListClear: { disabled: false, addEventListener() {} },
    btnIcloudListImportFile: { disabled: false, addEventListener() {} },
    btnIcloudListResetUnused: { disabled: false, addEventListener() {} },
    icloudListErrors: { style: { display: 'none' }, innerHTML: '' },
    icloudListRecords: { innerHTML: '', appendChild() {} },
    icloudListSummary: { textContent: '' },
    inputIcloudList: { value: '', disabled: false, addEventListener() {} },
    inputIcloudListFile: { disabled: false, files: [], value: '', addEventListener() {}, click() {} },
  };

  const manager = api.createIcloudListManager({
    state: {
      getLatestState: () => ({
        icloudListEntries: [
          {
            id: 'icloud-list-1',
            email: 'fresh@icloud.com',
            codeUrl: 'https://example.com/code/1',
            note: 'main',
            used: false,
            lastUsedAt: 0,
          },
        ],
        currentIcloudListEmail: 'fresh@icloud.com',
      }),
      syncLatestState() {},
    },
    dom,
    helpers: {
      escapeHtml: (value) => String(value || ''),
      openConfirmModal: async () => true,
      showToast() {},
    },
    runtime: {
      sendMessage: async () => ({ entries: [] }),
    },
    constants: {
      displayTimeZone: 'Asia/Shanghai',
    },
    icloudListUtils: {},
  });

  assert.equal(typeof manager.renderIcloudListEntries, 'function');
  assert.equal(typeof manager.refreshIcloudListEntries, 'function');
  assert.equal(typeof manager.bindIcloudListEvents, 'function');
  assert.equal(typeof manager.reset, 'function');
});

test('icloud-list manager clears the import textarea after a successful apply', async () => {
  const source = fs.readFileSync('sidepanel/icloud-list-manager.js', 'utf8');
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelIcloudListManager;`)(windowObject);
  const originalDocument = global.document;
  global.document = {
    createElement() {
      return {
        className: '',
        innerHTML: '',
        querySelector() {
          return {
            addEventListener() {},
          };
        },
      };
    },
  };

  const listeners = new Map();
  const dom = {
    btnIcloudListApply: {
      disabled: false,
      addEventListener(event, handler) {
        listeners.set(`apply:${event}`, handler);
      },
    },
    btnIcloudListClear: { disabled: false, addEventListener() {} },
    btnIcloudListImportFile: { disabled: false, addEventListener() {} },
    btnIcloudListResetUnused: { disabled: false, addEventListener() {} },
    icloudListErrors: { style: { display: 'none' }, innerHTML: '' },
    icloudListRecords: { innerHTML: '', appendChild() {} },
    icloudListSummary: { textContent: '' },
    inputIcloudList: {
      value: 'fresh@icloud.com\thttps://example.com/code/1',
      disabled: false,
      addEventListener() {},
    },
    inputIcloudListFile: { disabled: false, files: [], value: '', addEventListener() {}, click() {} },
  };

  const manager = api.createIcloudListManager({
    state: {
      getLatestState: () => ({ icloudListEntries: [] }),
      syncLatestState() {},
    },
    dom,
    helpers: {
      escapeHtml: (value) => String(value || ''),
      openConfirmModal: async () => true,
      showToast() {},
    },
    runtime: {
      sendMessage: async () => ({
        entries: [
          {
            id: 'icloud-list-1',
            email: 'fresh@icloud.com',
            codeUrl: 'https://example.com/code/1',
            note: '',
            used: false,
            lastUsedAt: 0,
          },
        ],
        errors: [],
      }),
    },
    constants: {
      displayTimeZone: 'Asia/Shanghai',
    },
    icloudListUtils: {},
  });

  try {
    manager.bindIcloudListEvents();
    listeners.get('apply:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(dom.inputIcloudList.value, '');
  } finally {
    global.document = originalDocument;
  }
});

test('sidepanel keeps icloud and icloud-list visibility logic isolated', () => {
  const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

  assert.match(source, /const showIcloudSection = \(useEmailGenerator && useIcloud\) \|\| useIcloudProvider;/);
  assert.match(source, /const showIcloudListSection = \(useEmailGenerator && useIcloudList\) \|\| useIcloudListProvider;/);
});

test('icloud-list manager renders used and unused rows with matching toggle labels', () => {
  const source = fs.readFileSync('sidepanel/icloud-list-manager.js', 'utf8');
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelIcloudListManager;`)(windowObject);
  const appendedRows = [];
  const originalDocument = global.document;
  global.document = {
    createElement() {
      return {
        className: '',
        innerHTML: '',
        querySelector() {
          return {
            addEventListener() {},
          };
        },
      };
    },
  };

  const dom = {
    btnIcloudListApply: { disabled: false, addEventListener() {} },
    btnIcloudListClear: { disabled: false, addEventListener() {} },
    btnIcloudListImportFile: { disabled: false, addEventListener() {} },
    btnIcloudListResetUnused: { disabled: false, addEventListener() {} },
    icloudListErrors: { style: { display: 'none' }, innerHTML: '' },
    icloudListRecords: {
      innerHTML: '',
      appendChild(node) {
        appendedRows.push(node);
      },
    },
    icloudListSummary: { textContent: '' },
    inputIcloudList: { value: '', disabled: false, addEventListener() {} },
    inputIcloudListFile: { disabled: false, files: [], value: '', addEventListener() {}, click() {} },
  };

  const manager = api.createIcloudListManager({
    state: {
      getLatestState: () => ({
        icloudListEntries: [],
        currentIcloudListEmail: 'used@icloud.com',
      }),
      syncLatestState() {},
    },
    dom,
    helpers: {
      escapeHtml: (value) => String(value || ''),
      openConfirmModal: async () => true,
      showToast() {},
    },
    runtime: {
      sendMessage: async () => ({ entries: [] }),
    },
    constants: {
      displayTimeZone: 'Asia/Shanghai',
    },
    icloudListUtils: {},
  });

  try {
    manager.renderIcloudListEntries([
      {
        id: 'icloud-list-1',
        email: 'used@icloud.com',
        codeUrl: 'https://example.com/code/used',
        note: 'used',
        used: true,
        lastUsedAt: 1710000000000,
      },
      {
        id: 'icloud-list-2',
        email: 'fresh@icloud.com',
        codeUrl: 'https://example.com/code/fresh',
        note: 'fresh',
        used: false,
        lastUsedAt: 0,
      },
    ]);

    assert.equal(dom.icloudListSummary.textContent, '已加载 2 条记录，其中 1 条已用，1 条未用。');
    assert.equal(appendedRows.length, 2);
    assert.match(appendedRows[0].innerHTML, /已用/);
    assert.match(appendedRows[0].innerHTML, /设为未用/);
    assert.match(appendedRows[1].innerHTML, /未用/);
    assert.match(appendedRows[1].innerHTML, /设为已用/);
  } finally {
    global.document = originalDocument;
  }
});
