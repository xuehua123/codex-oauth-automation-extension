(function attachBackgroundMailRuleRegistry(root, factory) {
  root.MultiPageBackgroundMailRuleRegistry = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundMailRuleRegistryModule() {
  function createMailRuleRegistry(deps = {}) {
    const {
      defaultFlowId = 'openai',
      flowBuilders = {},
    } = deps;

    function resolveFlowId(state = {}) {
      const activeFlowId = String(state?.activeFlowId || '').trim();
      return activeFlowId || String(defaultFlowId || '').trim() || 'openai';
    }

    function getFlowBuilder(flowId) {
      const normalizedFlowId = String(flowId || '').trim();
      return normalizedFlowId ? flowBuilders[normalizedFlowId] || null : null;
    }

    function getVerificationMailRule(step, state = {}) {
      const flowId = resolveFlowId(state);
      const flowBuilder = getFlowBuilder(flowId);
      if (!flowBuilder || typeof flowBuilder.getRuleDefinition !== 'function') {
        throw new Error(`未找到 flow=${flowId} 的邮件规则定义。`);
      }
      return flowBuilder.getRuleDefinition(step, state);
    }

    function buildVerificationPollPayload(step, state = {}, overrides = {}) {
      const flowId = resolveFlowId(state);
      const flowBuilder = getFlowBuilder(flowId);
      if (!flowBuilder || typeof flowBuilder.buildVerificationPollPayload !== 'function') {
        throw new Error(`未找到 flow=${flowId} 的邮件轮询规则构造器。`);
      }
      return flowBuilder.buildVerificationPollPayload(step, state, overrides);
    }

    return {
      buildVerificationPollPayload,
      getVerificationMailRule,
      resolveFlowId,
    };
  }

  return {
    createMailRuleRegistry,
  };
});
