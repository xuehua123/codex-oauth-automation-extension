(function attachSidepanelIcloudListManager(globalScope) {
  function createIcloudListManager(context = {}) {
    const {
      state,
      dom,
      helpers,
      runtime,
      constants,
      icloudListUtils,
    } = context;

    function getEntries() {
      return Array.isArray(state?.getLatestState?.()?.icloudListEntries)
        ? state.getLatestState().icloudListEntries
        : [];
    }

    function getCurrentEmail() {
      return String(state?.getLatestState?.()?.currentIcloudListEmail || '').trim().toLowerCase();
    }

    function escapeHtml(value) {
      return helpers?.escapeHtml ? helpers.escapeHtml(value) : String(value || '');
    }

    function formatDateTime(value) {
      const timestamp = Number(value) || 0;
      if (!timestamp) {
        return '-';
      }

      return new Date(timestamp).toLocaleString('zh-CN', {
        hour12: false,
        timeZone: constants?.displayTimeZone || 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function renderErrors(errors = []) {
      if (!dom.icloudListErrors) {
        return;
      }

      if (!errors.length) {
        dom.icloudListErrors.style.display = 'none';
        dom.icloudListErrors.innerHTML = '';
        return;
      }

      dom.icloudListErrors.style.display = '';
      dom.icloudListErrors.innerHTML = errors
        .map((error) => `<div>第 ${escapeHtml(error.lineNumber)} 行：${escapeHtml(error.reason || '格式无效')}</div>`)
        .join('');
    }

    function setBusy(loading) {
      const targets = [
        dom.btnIcloudListApply,
        dom.btnIcloudListImportFile,
        dom.btnIcloudListResetUnused,
        dom.btnIcloudListClear,
        dom.inputIcloudList,
        dom.inputIcloudListFile,
      ];
      targets.forEach((target) => {
        if (target) {
          target.disabled = Boolean(loading);
        }
      });
    }

    function renderIcloudListEntries(entries = getEntries()) {
      if (!dom.icloudListRecords || !dom.icloudListSummary) {
        return;
      }

      const list = Array.isArray(entries) ? entries : [];
      const currentEmail = getCurrentEmail();
      dom.icloudListRecords.innerHTML = '';

      if (!list.length) {
        dom.icloudListRecords.innerHTML = '<div class="icloud-empty">还没有 iCloud 列表邮箱，请先粘贴内容后点击“应用列表”。</div>';
        dom.icloudListSummary.textContent = '导入后会在这里管理 iCloud 列表邮箱。';
        return;
      }

      const usedCount = list.filter((entry) => entry.used).length;
      const unusedCount = Math.max(0, list.length - usedCount);
      dom.icloudListSummary.textContent = `已加载 ${list.length} 条记录，其中 ${usedCount} 条已用，${unusedCount} 条未用。`;

      list.forEach((entry) => {
        const row = document.createElement('div');
        row.className = `icloud-list-row${entry.email === currentEmail ? ' is-current' : ''}`;
        row.innerHTML = `
          <div class="icloud-list-cell icloud-list-email">
            <div class="icloud-list-email-main">${escapeHtml(entry.email)}</div>
            <div class="icloud-list-email-sub">${escapeHtml(entry.codeUrl)}</div>
          </div>
          <div class="icloud-list-cell">${escapeHtml(entry.note || '-')}</div>
          <div class="icloud-list-cell">
            <div class="icloud-list-status">
              <span class="icloud-tag ${entry.used ? 'used' : 'active'}">${escapeHtml(entry.used ? '已用' : '未用')}</span>
              ${entry.email === currentEmail ? '<span class="icloud-tag">当前</span>' : ''}
            </div>
          </div>
          <div class="icloud-list-cell mono">${escapeHtml(formatDateTime(entry.lastUsedAt))}</div>
          <div class="icloud-list-cell icloud-list-actions">
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-used">${entry.used ? '设为未用' : '设为已用'}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="delete">删除</button>
          </div>
        `;

        row.querySelector('[data-action="toggle-used"]')?.addEventListener('click', async () => {
          await setEntryUsedState(entry.email, !entry.used);
        });
        row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
          await deleteEntry(entry.email);
        });
        dom.icloudListRecords.appendChild(row);
      });
    }

    async function refreshIcloudListEntries(options = {}) {
      const { silent = false } = options;
      try {
        const response = await runtime.sendMessage({
          type: 'LIST_ICLOUD_LIST_ENTRIES',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        state?.syncLatestState?.({ icloudListEntries: response.entries || [] });
        renderIcloudListEntries(response.entries || []);
      } catch (err) {
        if (!silent && dom.icloudListSummary) {
          dom.icloudListSummary.textContent = err.message;
        }
        if (!silent) {
          helpers?.showToast?.(`iCloud 列表加载失败：${err.message}`, 'error');
        }
      }
    }

    async function applyCurrentText() {
      const text = String(dom.inputIcloudList?.value || '');
      if (!text.trim()) {
        throw new Error('请先粘贴 iCloud 列表内容。');
      }

      setBusy(true);
      try {
        const response = await runtime.sendMessage({
          type: 'APPLY_ICLOUD_LIST',
          source: 'sidepanel',
          payload: { text },
        });
        if (response?.error) {
          throw new Error(response.error);
        }

        state?.syncLatestState?.({ icloudListEntries: response.entries || [] });
        renderErrors(response.errors || []);
        renderIcloudListEntries(response.entries || []);
        if (dom.inputIcloudList) {
          dom.inputIcloudList.value = '';
        }
        helpers?.showToast?.(
          response.errors?.length
            ? `已应用 ${response.entries?.length || 0} 条记录，另有 ${response.errors.length} 行格式问题`
            : `已应用 ${response.entries?.length || 0} 条 iCloud 列表记录`,
          response.errors?.length ? 'warn' : 'success',
          2600
        );
      } finally {
        setBusy(false);
      }
    }

    async function setEntryUsedState(email, used) {
      setBusy(true);
      try {
        const response = await runtime.sendMessage({
          type: 'SET_ICLOUD_LIST_ENTRY_USED_STATE',
          source: 'sidepanel',
          payload: { email, used },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        await refreshIcloudListEntries({ silent: true });
        helpers?.showToast?.(`已将 ${email} 设为${used ? '已用' : '未用'}`, 'success', 2200);
      } catch (err) {
        helpers?.showToast?.(`更新 iCloud 列表失败：${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    }

    async function deleteEntry(email) {
      const confirmed = await helpers?.openConfirmModal?.({
        title: '删除 iCloud 列表邮箱',
        message: `确认删除 ${email} 吗？`,
        confirmLabel: '确认删除',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      setBusy(true);
      try {
        const response = await runtime.sendMessage({
          type: 'DELETE_ICLOUD_LIST_ENTRY',
          source: 'sidepanel',
          payload: { email },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        await refreshIcloudListEntries({ silent: true });
        helpers?.showToast?.(`已删除 ${email}`, 'success', 2200);
      } catch (err) {
        helpers?.showToast?.(`删除 iCloud 列表邮箱失败：${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    }

    async function resetAllUnused() {
      setBusy(true);
      try {
        const response = await runtime.sendMessage({
          type: 'RESET_ICLOUD_LIST_USAGE',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        state?.syncLatestState?.({ icloudListEntries: response.entries || [] });
        renderIcloudListEntries(response.entries || []);
        helpers?.showToast?.('已批量标记为未用', 'success', 2200);
      } catch (err) {
        helpers?.showToast?.(`批量更新失败：${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    }

    async function clearAll() {
      const confirmed = await helpers?.openConfirmModal?.({
        title: '清空 iCloud 列表',
        message: '确认清空全部 iCloud 列表邮箱吗？',
        confirmLabel: '确认清空',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      setBusy(true);
      try {
        const response = await runtime.sendMessage({
          type: 'CLEAR_ICLOUD_LIST',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        state?.syncLatestState?.({ icloudListEntries: [] });
        renderErrors([]);
        renderIcloudListEntries([]);
        helpers?.showToast?.('已清空 iCloud 列表', 'success', 2200);
      } catch (err) {
        helpers?.showToast?.(`清空 iCloud 列表失败：${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    }

    async function importSelectedFile() {
      const file = dom.inputIcloudListFile?.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        if (dom.inputIcloudList) {
          dom.inputIcloudList.value = text;
        }
        await applyCurrentText();
      } finally {
        if (dom.inputIcloudListFile) {
          dom.inputIcloudListFile.value = '';
        }
      }
    }

    function reset() {
      renderErrors([]);
      renderIcloudListEntries(getEntries());
    }

    function bindIcloudListEvents() {
      dom.btnIcloudListImportFile?.addEventListener('click', () => {
        dom.inputIcloudListFile?.click();
      });
      dom.inputIcloudListFile?.addEventListener('change', () => {
        importSelectedFile().catch((err) => {
          helpers?.showToast?.(`导入 TXT 失败：${err.message}`, 'error');
        });
      });
      dom.btnIcloudListApply?.addEventListener('click', () => {
        applyCurrentText().catch((err) => {
          helpers?.showToast?.(`应用 iCloud 列表失败：${err.message}`, 'error');
        });
      });
      dom.btnIcloudListResetUnused?.addEventListener('click', () => {
        resetAllUnused().catch((err) => {
          helpers?.showToast?.(`批量标记未用失败：${err.message}`, 'error');
        });
      });
      dom.btnIcloudListClear?.addEventListener('click', () => {
        clearAll().catch((err) => {
          helpers?.showToast?.(`清空 iCloud 列表失败：${err.message}`, 'error');
        });
      });
    }

    return {
      bindIcloudListEvents,
      refreshIcloudListEntries,
      renderErrors,
      renderIcloudListEntries,
      reset,
    };
  }

  globalScope.SidepanelIcloudListManager = {
    createIcloudListManager,
  };
})(window);
