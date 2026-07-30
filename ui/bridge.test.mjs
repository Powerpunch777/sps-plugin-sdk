import assert from "node:assert/strict";
import test from "node:test";
import {
  SPS_UI_BRIDGE_GLOBAL,
  SPS_UI_BRIDGE_LEGACY_GLOBAL,
  SpsUiBridgeError,
  useHostContext,
  useHostLocation,
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginStream,
  usePluginToast,
} from "./bridge.mjs";

function clearBridge() {
  delete globalThis[SPS_UI_BRIDGE_GLOBAL];
  delete globalThis[SPS_UI_BRIDGE_LEGACY_GLOBAL];
}

test.afterEach(clearBridge);

test("delegates every public hook to the SPS registry", async () => {
  const calls = [];
  const action = async (params) => ({ params });
  const navigation = { navigate() {} };
  const toast = () => "toast-1";
  globalThis[SPS_UI_BRIDGE_GLOBAL] = {
    sdkUi: {
      usePluginData: (...args) => { calls.push(["data", args]); return { data: 1 }; },
      usePluginAction: (...args) => { calls.push(["action", args]); return action; },
      useHostContext: (...args) => { calls.push(["context", args]); return { companyId: "co" }; },
      useHostLocation: (...args) => { calls.push(["location", args]); return { pathname: "/plugin" }; },
      useHostNavigation: (...args) => { calls.push(["navigation", args]); return navigation; },
      usePluginStream: (...args) => { calls.push(["stream", args]); return { events: [] }; },
      usePluginToast: (...args) => { calls.push(["toast", args]); return toast; },
    },
  };

  assert.deepEqual(usePluginData("summary", { range: "week" }), { data: 1 });
  assert.equal(usePluginAction("refresh"), action);
  assert.deepEqual(await usePluginAction("refresh")({ force: true }), { params: { force: true } });
  assert.deepEqual(useHostContext(), { companyId: "co" });
  assert.deepEqual(useHostLocation(), { pathname: "/plugin" });
  assert.equal(useHostNavigation(), navigation);
  assert.deepEqual(usePluginStream("updates", { companyId: "co" }), { events: [] });
  assert.equal(usePluginToast(), toast);
  assert.deepEqual(calls, [
    ["data", ["summary", { range: "week" }]],
    ["action", ["refresh"]],
    ["action", ["refresh"]],
    ["context", []],
    ["location", []],
    ["navigation", []],
    ["stream", ["updates", { companyId: "co" }]],
    ["toast", []],
  ]);
});

test("throws clear SPS errors for an uninitialized or unsupported bridge hook", () => {
  assert.throws(
    () => useHostContext(),
    (error) => error instanceof SpsUiBridgeError && error.code === "SPS_UI_BRIDGE_UNINITIALIZED",
  );

  globalThis[SPS_UI_BRIDGE_GLOBAL] = { sdkUi: {} };
  assert.throws(
    () => usePluginToast(),
    (error) => error instanceof SpsUiBridgeError
      && error.code === "SPS_UI_BRIDGE_UNSUPPORTED_HOOK"
      && error.message.includes("usePluginToast"),
  );
});

test("uses the legacy Core registry when a host has not published the SPS global yet", () => {
  const context = { companyId: "legacy-company" };
  globalThis[SPS_UI_BRIDGE_LEGACY_GLOBAL] = {
    sdkUi: { useHostContext: () => context },
  };

  assert.equal(useHostContext(), context);
});
