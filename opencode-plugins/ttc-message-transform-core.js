import TtcMessageTransformPlugin from "./ttc-message-transform.js";

const testApi = TtcMessageTransformPlugin._test ?? {};

export function buildTtcPluginConfig(...args) {
  return testApi.buildTtcPluginConfig(...args);
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
