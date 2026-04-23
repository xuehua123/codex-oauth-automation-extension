(function attachBackgroundBrowserProxy(root, factory) {
  root.MultiPageBackgroundBrowserProxy = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundBrowserProxyModule() {
  const DEFAULT_BYPASS_LIST = [
    '<local>',
    'localhost',
    '127.0.0.1',
    '[::1]',
    '*.local',
    'host.docker.internal',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16',
  ];

  function parseBrowserProxySpec(spec) {
    const raw = String(spec || '').trim();
    if (!raw) {
      return null;
    }

    const parts = raw.split(':');
    if (parts.length < 4) {
      return null;
    }

    const host = String(parts.shift() || '').trim();
    const port = Number(parts.shift());
    const username = String(parts.shift() || '').trim();
    const password = parts.join(':');

    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || !username || !password) {
      return null;
    }

    return {
      host,
      port,
      username,
      password,
    };
  }

  function buildProxyConfig(proxyConfig, options = {}) {
    const bypassList = Array.isArray(options.bypassList) && options.bypassList.length > 0
      ? options.bypassList
      : DEFAULT_BYPASS_LIST;

    return {
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: 'http',
          host: proxyConfig.host,
          port: proxyConfig.port,
        },
        bypassList: [...bypassList],
      },
    };
  }

  function createBrowserProxyManager(deps = {}) {
    const {
      addLog,
      chrome,
      getState,
    } = deps;

    let activeProxyConfig = null;

    function getConfiguredProxyConfig(state = {}) {
      if (!state || state.browserProxyEnabled !== true) {
        return null;
      }
      return parseBrowserProxySpec(state.browserProxySpec);
    }

    async function log(message, level) {
      if (typeof addLog === 'function' && message) {
        await addLog(message, level);
      }
    }

    async function applyProxyConfig(proxyConfig) {
      if (!chrome?.proxy?.settings?.set) {
        return;
      }

      await chrome.proxy.settings.set({
        value: buildProxyConfig(proxyConfig),
        scope: 'regular',
      });
      activeProxyConfig = proxyConfig;
    }

    async function clearProxyConfig() {
      activeProxyConfig = null;
      if (!chrome?.proxy?.settings?.clear) {
        return;
      }

      await chrome.proxy.settings.clear({ scope: 'regular' });
    }

    async function syncBrowserProxyFromState(stateOverride = null) {
      const state = stateOverride || (typeof getState === 'function' ? await getState() : {});
      const rawSpec = String(state?.browserProxySpec || '').trim();
      const proxyConfig = getConfiguredProxyConfig(state);

      if (!state?.browserProxyEnabled) {
        await clearProxyConfig();
        return {
          enabled: false,
          reason: 'disabled',
        };
      }

      if (!proxyConfig) {
        await clearProxyConfig();
        if (!rawSpec) {
          return {
            enabled: false,
            reason: 'missing',
          };
        }
        await log('浏览器代理：配置格式无效，已恢复默认代理设置。', 'warn');
        return {
          enabled: false,
          reason: 'invalid',
        };
      }

      await applyProxyConfig(proxyConfig);
      await log(`浏览器代理：已应用 ${proxyConfig.host}:${proxyConfig.port}，本地地址保持直连。`);
      return {
        enabled: true,
        proxyConfig: {
          host: proxyConfig.host,
          port: proxyConfig.port,
          username: proxyConfig.username,
        },
      };
    }

    function buildAuthResponse(details, proxyConfig) {
      if (!details?.isProxy || !proxyConfig) {
        return undefined;
      }

      const challengerHost = String(details?.challenger?.host || '').trim().toLowerCase();
      const challengerPort = Number(details?.challenger?.port);
      if (!challengerHost || challengerHost !== proxyConfig.host.toLowerCase() || challengerPort !== proxyConfig.port) {
        return undefined;
      }

      return {
        authCredentials: {
          username: proxyConfig.username,
          password: proxyConfig.password,
        },
      };
    }

    function handleAuthRequired(details) {
      return buildAuthResponse(details, activeProxyConfig);
    }

    async function resolveAuthRequired(details) {
      const activeResponse = buildAuthResponse(details, activeProxyConfig);
      if (activeResponse) {
        return activeResponse;
      }

      const state = typeof getState === 'function' ? await getState() : {};
      const proxyConfig = getConfiguredProxyConfig(state);
      return buildAuthResponse(details, proxyConfig);
    }

    function handleAuthRequiredAsync(details, callback) {
      resolveAuthRequired(details)
        .then((response) => callback(response))
        .catch(() => callback());
    }

    async function handleProxyError(details = {}) {
      const message = String(details?.error || '').trim();
      const detailText = String(details?.details || '').trim();
      if (!message && !detailText) {
        return;
      }

      const suffix = detailText ? `（${detailText}）` : '';
      await log(`浏览器代理：${message || '发生代理错误'}${suffix}`, 'warn');
    }

    return {
      handleAuthRequired,
      handleAuthRequiredAsync,
      handleProxyError,
      syncBrowserProxyFromState,
    };
  }

  return {
    DEFAULT_BYPASS_LIST,
    buildProxyConfig,
    createBrowserProxyManager,
    parseBrowserProxySpec,
  };
});
