/**
 * SPS public UI runtime bridge.
 *
 * The host owns the hook implementations. This module deliberately has no
 * React or Core imports so a plugin bundle can use it as a runtime boundary.
 */
export const SPS_UI_BRIDGE_GLOBAL = "__spsPluginBridge__";
export const SPS_UI_BRIDGE_LEGACY_GLOBAL = "__paperclipPluginBridge__";

export class SpsUiBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SpsUiBridgeError";
    this.code = code;
  }
}

function getSdkHook(name) {
  const registry = globalThis[SPS_UI_BRIDGE_GLOBAL]
    ?? globalThis[SPS_UI_BRIDGE_LEGACY_GLOBAL];
  if (!registry || typeof registry !== "object") {
    throw new SpsUiBridgeError(
      "SPS_UI_BRIDGE_UNINITIALIZED",
      "SPS UI runtime bridge is not initialized. The SPS host must initialize __spsPluginBridge__ before rendering plugin UI.",
    );
  }
  const hook = registry.sdkUi?.[name];
  if (typeof hook !== "function") {
    throw new SpsUiBridgeError(
      "SPS_UI_BRIDGE_UNSUPPORTED_HOOK",
      `SPS UI runtime bridge does not support hook \"${name}\".`,
    );
  }
  return hook;
}

export function usePluginData(key, params) {
  return getSdkHook("usePluginData")(key, params);
}

export function usePluginAction(key) {
  return getSdkHook("usePluginAction")(key);
}

export function useHostContext() {
  return getSdkHook("useHostContext")();
}

export function useHostLocation() {
  return getSdkHook("useHostLocation")();
}

export function useHostNavigation() {
  return getSdkHook("useHostNavigation")();
}

export function usePluginStream(channel, options) {
  return getSdkHook("usePluginStream")(channel, options);
}

export function usePluginToast() {
  return getSdkHook("usePluginToast")();
}
