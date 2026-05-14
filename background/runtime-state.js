(function attachBackgroundRuntimeState(root, factory) {
  root.MultiPageBackgroundRuntimeState = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundRuntimeStateModule() {
  function createRuntimeStateHelpers(deps = {}) {
    const {
      DEFAULT_ACTIVE_FLOW_ID = 'openai',
      defaultStepStatuses = {},
      getStepDefinitionForState = null,
    } = deps;

    const RUNTIME_SHARED_FIELDS = Object.freeze([
      'automationWindowId',
      'tabRegistry',
      'sourceLastUrls',
      'flowStartTime',
    ]);
    const RUNTIME_PROXY_FIELDS = Object.freeze([
      'ipProxyApiPool',
      'ipProxyApiCurrentIndex',
      'ipProxyApiCurrent',
      'ipProxyAccountPool',
      'ipProxyAccountCurrentIndex',
      'ipProxyAccountCurrent',
      'ipProxyPool',
      'ipProxyCurrentIndex',
      'ipProxyCurrent',
    ]);
    const OPENAI_FLOW_FIELD_GROUPS = Object.freeze({
      auth: Object.freeze([
        'oauthUrl',
        'localhostUrl',
      ]),
      platformBinding: Object.freeze([
        'cpaOAuthState',
        'cpaManagementOrigin',
        'sub2apiSessionId',
        'sub2apiOAuthState',
        'sub2apiGroupId',
        'sub2apiDraftName',
        'sub2apiProxyId',
        'sub2apiGroupIds',
        'codex2apiSessionId',
        'codex2apiOAuthState',
      ]),
      plus: Object.freeze([
        'plusCheckoutTabId',
        'plusCheckoutUrl',
        'plusCheckoutCountry',
        'plusCheckoutCurrency',
        'plusCheckoutSource',
        'plusBillingCountryText',
        'plusBillingAddress',
        'plusPaypalApprovedAt',
        'plusGoPayApprovedAt',
        'plusReturnUrl',
        'plusManualConfirmationPending',
        'plusManualConfirmationRequestId',
        'plusManualConfirmationStep',
        'plusManualConfirmationMethod',
        'plusManualConfirmationTitle',
        'plusManualConfirmationMessage',
        'gopayHelperReferenceId',
        'gopayHelperGoPayGuid',
        'gopayHelperRedirectUrl',
        'gopayHelperNextAction',
        'gopayHelperFlowId',
        'gopayHelperChallengeId',
        'gopayHelperStartPayload',
        'gopayHelperTaskId',
        'gopayHelperTaskStatus',
        'gopayHelperStatusText',
        'gopayHelperRemoteStage',
        'gopayHelperApiWaitingFor',
        'gopayHelperApiInputDeadlineAt',
        'gopayHelperApiInputWaitSeconds',
        'gopayHelperLastInputError',
        'gopayHelperOtpInvalidCount',
        'gopayHelperFailureStage',
        'gopayHelperFailureDetail',
        'gopayHelperTaskPayload',
        'gopayHelperOrderCreatedAt',
        'gopayHelperTaskProgressSignature',
        'gopayHelperTaskProgressAt',
        'gopayHelperTaskProgressTaskId',
        'gopayHelperPinPayload',
        'gopayHelperResolvedOtp',
        'gopayHelperOtpRequestId',
        'gopayHelperOtpReferenceId',
      ]),
      phoneVerification: Object.freeze([
        'currentPhoneActivation',
        'phoneNumber',
        'currentPhoneVerificationCode',
        'currentPhoneVerificationCountdownEndsAt',
        'currentPhoneVerificationCountdownWindowIndex',
        'currentPhoneVerificationCountdownWindowTotal',
        'reusablePhoneActivation',
        'freeReusablePhoneActivation',
        'phoneReusableActivationPool',
        'signupPhoneNumber',
        'signupPhoneActivation',
        'signupPhoneCompletedActivation',
        'signupPhoneVerificationRequestedAt',
        'signupPhoneVerificationPurpose',
      ]),
      luckmail: Object.freeze([
        'currentLuckmailPurchase',
        'currentLuckmailMailCursor',
      ]),
      identity: Object.freeze([
        'resolvedSignupMethod',
        'accountIdentifierType',
        'accountIdentifier',
        'registrationEmailState',
        'email',
        'password',
        'lastEmailTimestamp',
        'lastSignupCode',
        'lastLoginCode',
        'step8VerificationTargetEmail',
      ]),
    });

    function isPlainObject(value) {
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function cloneValue(value) {
      if (Array.isArray(value)) {
        return value.map((item) => cloneValue(item));
      }
      if (isPlainObject(value)) {
        return Object.fromEntries(
          Object.entries(value).map(([key, entryValue]) => [key, cloneValue(entryValue)])
        );
      }
      return value;
    }

    function normalizePlainObject(value) {
      return isPlainObject(value) ? value : {};
    }

    function normalizeFlowId(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized || DEFAULT_ACTIVE_FLOW_ID;
    }

    function normalizeRunId(value = '') {
      return String(value || '').trim();
    }

    function normalizeStepNumber(value) {
      const step = Math.floor(Number(value) || 0);
      return step > 0 ? step : 0;
    }

    function normalizeNodeStatus(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) {
        return 'pending';
      }
      return normalized;
    }

    function buildDefaultStepStatuses() {
      return Object.fromEntries(
        Object.entries(normalizePlainObject(defaultStepStatuses)).map(([key, value]) => [
          String(key),
          normalizeNodeStatus(value),
        ])
      );
    }

    function normalizeStepStatuses(value) {
      const base = buildDefaultStepStatuses();
      if (!isPlainObject(value)) {
        return base;
      }

      const next = { ...base };
      for (const [key, status] of Object.entries(value)) {
        const step = normalizeStepNumber(key);
        if (!step) continue;
        next[String(step)] = normalizeNodeStatus(status);
      }
      return next;
    }

    function normalizeLegacyStepCompat(value = {}, state = {}) {
      const candidate = normalizePlainObject(value);
      const currentStep = normalizeStepNumber(
        Object.prototype.hasOwnProperty.call(state, 'currentStep')
          ? state.currentStep
          : candidate.currentStep
      );
      const stepStatuses = normalizeStepStatuses(
        Object.prototype.hasOwnProperty.call(state, 'stepStatuses')
          ? state.stepStatuses
          : candidate.stepStatuses
      );

      return {
        currentStep,
        stepStatuses,
      };
    }

    function resolveStepKey(step, state = {}) {
      const numericStep = normalizeStepNumber(step);
      if (!numericStep || typeof getStepDefinitionForState !== 'function') {
        return '';
      }
      return String(getStepDefinitionForState(numericStep, state)?.key || '').trim();
    }

    function normalizeNodeStatuses(value, state = {}, legacyStepCompat = null) {
      if (isPlainObject(value) && Object.keys(value).length > 0) {
        return Object.fromEntries(
          Object.entries(value)
            .map(([key, status]) => [String(key || '').trim(), normalizeNodeStatus(status)])
            .filter(([key]) => Boolean(key))
        );
      }

      const compat = legacyStepCompat || normalizeLegacyStepCompat({}, state);
      const next = {};
      for (const [stepKey, status] of Object.entries(compat.stepStatuses || {})) {
        const step = normalizeStepNumber(stepKey);
        if (!step) continue;
        const nodeKey = resolveStepKey(step, state) || `step-${step}`;
        next[nodeKey] = normalizeNodeStatus(status);
      }
      return next;
    }

    function pickDefinedFields(state = {}, fields = []) {
      const next = {};
      for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(state, field)) {
          next[field] = cloneValue(state[field]);
        }
      }
      return next;
    }

    function buildSharedState(baseValue = {}, state = {}) {
      return {
        ...cloneValue(normalizePlainObject(baseValue)),
        ...pickDefinedFields(state, RUNTIME_SHARED_FIELDS),
      };
    }

    function buildServiceState(baseValue = {}, state = {}) {
      const base = cloneValue(normalizePlainObject(baseValue));
      return {
        ...base,
        proxy: {
          ...cloneValue(normalizePlainObject(base.proxy)),
          ...pickDefinedFields(state, RUNTIME_PROXY_FIELDS),
        },
      };
    }

    function flattenOpenAiFlowState(flowState = {}) {
      const openaiState = normalizePlainObject(flowState.openai);
      const next = {};
      for (const [groupKey, fields] of Object.entries(OPENAI_FLOW_FIELD_GROUPS)) {
        const group = normalizePlainObject(openaiState[groupKey]);
        for (const field of fields) {
          if (Object.prototype.hasOwnProperty.call(group, field)) {
            next[field] = cloneValue(group[field]);
          }
        }
      }
      return next;
    }

    function buildOpenAiFlowState(baseValue = {}, state = {}) {
      const baseFlowState = cloneValue(normalizePlainObject(baseValue));
      const baseOpenAi = cloneValue(normalizePlainObject(baseFlowState.openai));
      const openaiState = {
        ...baseOpenAi,
      };

      for (const [groupKey, fields] of Object.entries(OPENAI_FLOW_FIELD_GROUPS)) {
        openaiState[groupKey] = {
          ...cloneValue(normalizePlainObject(baseOpenAi[groupKey])),
          ...pickDefinedFields(state, fields),
        };
      }

      return {
        ...baseFlowState,
        openai: openaiState,
      };
    }

    function buildRuntimeStateDefault() {
      return {
        activeFlowId: DEFAULT_ACTIVE_FLOW_ID,
        activeRunId: '',
        currentNodeId: '',
        nodeStatuses: {},
        sharedState: {},
        serviceState: {
          proxy: {},
        },
        flowState: {
          openai: {
            auth: {},
            platformBinding: {},
            plus: {},
            phoneVerification: {},
            luckmail: {},
            identity: {},
          },
        },
        legacyStepCompat: {
          currentStep: 0,
          stepStatuses: buildDefaultStepStatuses(),
        },
      };
    }

    function ensureRuntimeState(state = {}) {
      const baseRuntimeState = {
        ...buildRuntimeStateDefault(),
        ...cloneValue(normalizePlainObject(state.runtimeState)),
      };
      const activeFlowId = normalizeFlowId(
        Object.prototype.hasOwnProperty.call(state, 'activeFlowId')
          ? state.activeFlowId
          : baseRuntimeState.activeFlowId
      );
      const legacyStepCompat = normalizeLegacyStepCompat(baseRuntimeState.legacyStepCompat, state);
      const currentNodeId = String(
        Object.prototype.hasOwnProperty.call(state, 'currentNodeId')
          ? state.currentNodeId
          : (baseRuntimeState.currentNodeId || resolveStepKey(legacyStepCompat.currentStep, state))
      ).trim();
      const nodeStatuses = normalizeNodeStatuses(
        Object.prototype.hasOwnProperty.call(state, 'nodeStatuses')
          ? state.nodeStatuses
          : baseRuntimeState.nodeStatuses,
        state,
        legacyStepCompat
      );

      return {
        ...baseRuntimeState,
        activeFlowId,
        activeRunId: normalizeRunId(
          Object.prototype.hasOwnProperty.call(state, 'activeRunId')
            ? state.activeRunId
            : baseRuntimeState.activeRunId
        ),
        currentNodeId,
        nodeStatuses,
        sharedState: buildSharedState(baseRuntimeState.sharedState, state),
        serviceState: buildServiceState(baseRuntimeState.serviceState, state),
        flowState: buildOpenAiFlowState(baseRuntimeState.flowState, state),
        legacyStepCompat,
      };
    }

    function buildFlattenedUpdates(updates = {}) {
      const next = {
        ...updates,
      };
      const runtimeState = normalizePlainObject(updates.runtimeState);
      const legacyStepCompat = normalizePlainObject(updates.legacyStepCompat);
      const sharedState = normalizePlainObject(updates.sharedState);
      const serviceState = normalizePlainObject(updates.serviceState);
      const flowState = normalizePlainObject(updates.flowState);

      if (Object.prototype.hasOwnProperty.call(runtimeState, 'activeFlowId')) {
        next.activeFlowId = runtimeState.activeFlowId;
      }
      if (Object.prototype.hasOwnProperty.call(runtimeState, 'activeRunId')) {
        next.activeRunId = runtimeState.activeRunId;
      }
      if (Object.prototype.hasOwnProperty.call(runtimeState, 'currentNodeId')) {
        next.currentNodeId = runtimeState.currentNodeId;
      }
      if (Object.prototype.hasOwnProperty.call(runtimeState, 'nodeStatuses')) {
        next.nodeStatuses = cloneValue(runtimeState.nodeStatuses);
      }
      if (Object.prototype.hasOwnProperty.call(legacyStepCompat, 'currentStep')) {
        next.currentStep = legacyStepCompat.currentStep;
      }
      if (Object.prototype.hasOwnProperty.call(legacyStepCompat, 'stepStatuses')) {
        next.stepStatuses = cloneValue(legacyStepCompat.stepStatuses);
      }
      if (Object.prototype.hasOwnProperty.call(runtimeState, 'legacyStepCompat')) {
        const compatCandidate = normalizePlainObject(runtimeState.legacyStepCompat);
        if (Object.prototype.hasOwnProperty.call(compatCandidate, 'currentStep')) {
          next.currentStep = compatCandidate.currentStep;
        }
        if (Object.prototype.hasOwnProperty.call(compatCandidate, 'stepStatuses')) {
          next.stepStatuses = cloneValue(compatCandidate.stepStatuses);
        }
      }

      Object.assign(next, pickDefinedFields(sharedState, RUNTIME_SHARED_FIELDS));
      if (Object.prototype.hasOwnProperty.call(runtimeState, 'sharedState')) {
        Object.assign(
          next,
          pickDefinedFields(normalizePlainObject(runtimeState.sharedState), RUNTIME_SHARED_FIELDS)
        );
      }

      const serviceProxy = normalizePlainObject(serviceState.proxy);
      Object.assign(next, pickDefinedFields(serviceProxy, RUNTIME_PROXY_FIELDS));
      if (Object.prototype.hasOwnProperty.call(runtimeState, 'serviceState')) {
        const runtimeServiceState = normalizePlainObject(runtimeState.serviceState);
        Object.assign(
          next,
          pickDefinedFields(normalizePlainObject(runtimeServiceState.proxy), RUNTIME_PROXY_FIELDS)
        );
      }

      Object.assign(next, flattenOpenAiFlowState(flowState));
      if (Object.prototype.hasOwnProperty.call(runtimeState, 'flowState')) {
        Object.assign(next, flattenOpenAiFlowState(normalizePlainObject(runtimeState.flowState)));
      }

      return next;
    }

    function buildStateView(state = {}) {
      const runtimeState = ensureRuntimeState(state);
      return {
        ...state,
        activeFlowId: runtimeState.activeFlowId,
        activeRunId: runtimeState.activeRunId,
        currentNodeId: runtimeState.currentNodeId,
        nodeStatuses: cloneValue(runtimeState.nodeStatuses),
        flowState: cloneValue(runtimeState.flowState),
        sharedState: cloneValue(runtimeState.sharedState),
        serviceState: cloneValue(runtimeState.serviceState),
        legacyStepCompat: cloneValue(runtimeState.legacyStepCompat),
        currentStep: runtimeState.legacyStepCompat.currentStep,
        stepStatuses: cloneValue(runtimeState.legacyStepCompat.stepStatuses),
        runtimeState,
      };
    }

    function buildSessionStatePatch(currentState = {}, updates = {}) {
      const flattenedUpdates = buildFlattenedUpdates(updates);
      const nextState = {
        ...currentState,
        ...flattenedUpdates,
      };
      const runtimeState = ensureRuntimeState(nextState);

      return {
        ...flattenedUpdates,
        activeFlowId: runtimeState.activeFlowId,
        activeRunId: runtimeState.activeRunId,
        currentNodeId: runtimeState.currentNodeId,
        nodeStatuses: cloneValue(runtimeState.nodeStatuses),
        currentStep: runtimeState.legacyStepCompat.currentStep,
        stepStatuses: cloneValue(runtimeState.legacyStepCompat.stepStatuses),
        runtimeState,
      };
    }

    return {
      DEFAULT_ACTIVE_FLOW_ID,
      OPENAI_FLOW_FIELD_GROUPS,
      RUNTIME_PROXY_FIELDS,
      RUNTIME_SHARED_FIELDS,
      buildDefaultRuntimeState: buildRuntimeStateDefault,
      buildSessionStatePatch,
      buildStateView,
      ensureRuntimeState,
    };
  }

  return {
    createRuntimeStateHelpers,
  };
});
