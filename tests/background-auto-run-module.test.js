const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports auto-run controller module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/auto-run-controller\.js/);
});

test('auto-run controller module exposes a factory', () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);

  assert.equal(typeof api?.createAutoRunController, 'function');
});

test('auto-run account record status preserves the real failed step instead of parsing guidance text', () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);
  const controller = api.createAutoRunController({});

  const state = {
    currentStep: 11,
    stepStatuses: {
      2: 'completed',
      10: 'completed',
      11: 'failed',
    },
  };
  const error = new Error('缺少登录账号：请先完成步骤 2，或在侧栏填写账号后再执行当前步骤。');

  assert.equal(
    controller.resolveAutoRunAccountRecordStatus('failed', state, error),
    'step11_failed'
  );

  error.failedStep = 13;
  assert.equal(
    controller.resolveAutoRunAccountRecordStatus('failed', state, error),
    'step13_failed'
  );
});

function createDisabledAccountAutoRunHarness({ loginOnly = false } = {}) {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);

  let state = {
    stepStatuses: {},
    autoRunFallbackThreadIntervalMinutes: 0,
    panelMode: loginOnly ? 'codex2api' : 'sub2api',
    codex2apiLoginOnlyMode: loginOnly,
  };
  const runtimeState = {
    autoRunActive: false,
    autoRunCurrentRun: 0,
    autoRunTotalRuns: 0,
    autoRunAttemptRun: 0,
    autoRunSessionId: 0,
  };
  const events = {
    sequenceCalls: [],
    records: [],
    statuses: [],
    logs: [],
    cancels: [],
    contentStops: 0,
  };

  const controller = api.createAutoRunController({
    addLog: async (message, level = 'info') => {
      events.logs.push({ message, level });
    },
    appendAccountRunRecord: async (status, _state, reason) => {
      events.records.push({ status, reason });
      return { status, reason };
    },
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 2,
    AUTO_RUN_RETRY_DELAY_MS: 1,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async (phase, payload) => {
      events.statuses.push({ phase, payload });
      state = { ...state, autoRunPhase: phase, ...payload };
    },
    broadcastStopToContentScripts: async () => {
      events.contentStops += 1;
    },
    cancelPendingCommands: (reason) => {
      events.cancels.push(reason);
    },
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 1,
    ensureHotmailMailboxReadyForAutoRunRound: async () => {},
    getAutoRunStatusPayload: (phase, payload = {}) => ({
      autoRunning: phase === 'running' || phase === 'retrying',
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun ?? 0,
      autoRunTotalRuns: payload.totalRuns ?? 1,
      autoRunAttemptRun: payload.attemptRun ?? 0,
      autoRunSessionId: payload.sessionId ?? 0,
    }),
    getErrorMessage: (error) => error?.message || String(error || ''),
    getFirstUnfinishedStep: () => 1,
    getPendingAutoRunTimerPlan: () => null,
    getRunningSteps: () => [],
    getState: async () => state,
    getStopRequested: () => false,
    hasSavedProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isCodex2ApiLoginOnlyMode: (currentState = {}) => currentState.panelMode === 'codex2api'
      && Boolean(currentState.codex2apiLoginOnlyMode),
    isOpenAiAccountDisabledFailure: (error) => /OPENAI_ACCOUNT_DISABLED::/.test(error?.message || String(error || '')),
    isRestartCurrentAttemptError: () => false,
    isSignupUserAlreadyExistsFailure: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: () => 0,
    persistAutoRunTimerPlan: async () => {},
    resetState: async () => {
      state = {
        stepStatuses: {},
        autoRunFallbackThreadIntervalMinutes: 0,
        panelMode: loginOnly ? 'codex2api' : 'sub2api',
        codex2apiLoginOnlyMode: loginOnly,
      };
    },
    runAutoSequenceFromStep: async (_startStep, context) => {
      events.sequenceCalls.push(context);
      throw new Error('OPENAI_ACCOUNT_DISABLED::disabled account');
    },
    runtime: {
      get: () => ({ ...runtimeState }),
      set: (updates = {}) => Object.assign(runtimeState, updates),
    },
    setState: async (updates = {}) => {
      state = { ...state, ...updates };
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningStepsToFinish: async () => state,
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
      },
    },
  });

  return { controller, events };
}

test('auto-run controller skips remaining retries for disabled OpenAI accounts when skip failures is enabled', async () => {
  const { controller, events } = createDisabledAccountAutoRunHarness();

  await controller.autoRunLoop(2, {
    autoRunSkipFailures: true,
    mode: 'restart',
  });

  assert.deepStrictEqual(
    events.sequenceCalls.map((call) => [call.targetRun, call.attemptRuns]),
    [[1, 1], [2, 1]]
  );
  assert.equal(events.records.length, 2);
  assert.ok(events.records.every((record) => record.status === 'failed'));
  assert.equal(events.contentStops, 2);
  assert.ok(events.logs.some(({ message }) => /账号已禁用\/停用，本轮将直接失败并跳过剩余重试/.test(message)));
  assert.ok(!events.statuses.some(({ phase }) => phase === 'retrying'));
});

test('Codex2API login-only mode advances after a disabled account even when skip failures is disabled', async () => {
  const { controller, events } = createDisabledAccountAutoRunHarness({ loginOnly: true });

  await controller.autoRunLoop(2, {
    autoRunSkipFailures: false,
    mode: 'restart',
  });

  assert.deepStrictEqual(
    events.sequenceCalls.map((call) => [call.targetRun, call.attemptRuns]),
    [[1, 1], [2, 1]]
  );
  assert.equal(events.records.length, 2);
  assert.ok(events.records.every((record) => record.status === 'failed'));
  assert.equal(events.contentStops, 2);
  assert.ok(events.logs.some(({ message }) => /Codex2API 仅登录模式将记录失败并继续下一轮/.test(message)));
  assert.ok(!events.statuses.some(({ phase }) => phase === 'stopped'));
});
