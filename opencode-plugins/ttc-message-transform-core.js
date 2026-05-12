import TtcMessageTransformPlugin from "./ttc-message-transform.js";

const testApi = TtcMessageTransformPlugin._test ?? {};

export function buildTtcPluginConfig(...args) {
  return testApi.buildTtcPluginConfig(...args);
}

export function getPluginConfigPath(...args) {
  return testApi.getPluginConfigPath(...args);
}

export function getSidebarStateDir(...args) {
  return testApi.getSidebarStateDir(...args);
}

export function getSidebarStatePath(...args) {
  return testApi.getSidebarStatePath(...args);
}

export async function resolvePluginSettings(...args) {
  return testApi.resolvePluginSettings(...args);
}

export async function resolveRuntimeConfig(...args) {
  return testApi.resolveRuntimeConfig(...args);
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

export function resolveSessionIDFromTransformInput(...args) {
  return testApi.resolveSessionIDFromTransformInput(...args);
}

export function getSkipReasonForText(...args) {
  return testApi.getSkipReasonForText(...args);
}

export function createSessionStats(...args) {
  return testApi.createSessionStats(...args);
}

export function resetLastMessageStats(...args) {
  return testApi.resetLastMessageStats(...args);
}

export function recordSkipReason(...args) {
  return testApi.recordSkipReason(...args);
}

export function recordProcessedPart(...args) {
  return testApi.recordProcessedPart(...args);
}

export function buildSidebarState(...args) {
  return testApi.buildSidebarState(...args);
}

export function writeSidebarState(...args) {
  return testApi.writeSidebarState(...args);
}

export async function transformMessagesWithTtc(...args) {
  return testApi.transformMessagesWithTtc(...args);
}

export { TtcMessageTransformPlugin };
