import TtcMessageTransformPlugin from "./ttc-message-transform.js";

const testApi = TtcMessageTransformPlugin._test ?? {};

export function buildTtcPluginConfig(...args) {
  return testApi.buildTtcPluginConfig(...args);
}

export function getPluginConfigPath(...args) {
  return testApi.getPluginConfigPath(...args);
}

export async function resolvePluginSettings(...args) {
  return testApi.resolvePluginSettings(...args);
}

export function resolveCompressionConfig(...args) {
  return testApi.resolveCompressionConfig(...args);
}

export function resolveBehaviorConfig(...args) {
  return testApi.resolveBehaviorConfig(...args);
}

export function resolveLockedBaseUrl(...args) {
  return testApi.resolveLockedBaseUrl(...args);
}

export function getAuthStorePath(...args) {
  return testApi.getAuthStorePath(...args);
}

export async function resolveApiKeyFromAuthStore(...args) {
  return testApi.resolveApiKeyFromAuthStore(...args);
}

export function resolveEffectiveApiKey(...args) {
  return testApi.resolveEffectiveApiKey(...args);
}

export function getSkipReasonForText(...args) {
  return testApi.getSkipReasonForText(...args);
}

export async function transformMessagesWithTtc(...args) {
  return testApi.transformMessagesWithTtc(...args);
}

export { TtcMessageTransformPlugin };
