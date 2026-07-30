import assert from "node:assert/strict";
import test from "node:test";
import {
  SPS_UI_FUTURE_CAPABILITIES,
  assertSpsUiLabel,
  assertSpsUiEntrypoint,
  assertSpsUiRoutePath,
  defineSpsUiContributions,
  requiredSpsUiCapability,
  validateSpsUiContribution,
} from "./index.mjs";

test("builds deterministic Core-compatible slots and capabilities", () => {
  const declaration = defineSpsUiContributions({
    spsUiContractVersion: "1.0",
    entrypoint: "./dist/ui-v0.3.2",
    contributions: [
      { surface: "page", id: "run-console", label: "Run Console", exportName: "RunConsolePage", routePath: "run-console" },
      { surface: "sidebar", id: "run-console-link", label: "Run Console", exportName: "RunConsoleLink", order: 20 },
      { surface: "sidebar", id: "run-console-sidebar", label: "Run Console", exportName: "RunConsoleSidebar", scope: "route", routePath: "run-console" },
      { surface: "settings", id: "run-settings", label: "Run Settings", exportName: "RunSettings" },
      { surface: "settings", id: "company-run-settings", label: "Run Settings", exportName: "CompanyRunSettings", scope: "company", routePath: "run-console" },
      { surface: "detail-tab", id: "run-output", label: "Output", exportName: "RunOutputTab", entityTypes: ["run", "issue"] },
    ],
  });

  assert.deepEqual(declaration.entrypoints, { ui: "./dist/ui-v0.3.2" });
  assert.deepEqual(declaration.capabilities, ["ui.page.register", "ui.sidebar.register", "instance.settings.register", "ui.detailTab.register"]);
  assert.deepEqual(declaration.ui.slots.map((slot) => slot.type), ["page", "sidebar", "routeSidebar", "settingsPage", "companySettingsPage", "detailTab"]);
  assert.deepEqual(declaration.ui.slots[5].entityTypes, ["run", "issue"]);
  assert.equal(Object.isFrozen(declaration.ui.slots), true);
  assert.deepEqual(
    { entrypoints: { worker: "./dist/worker.js", ...declaration.entrypoints }, capabilities: declaration.capabilities, ui: declaration.ui },
    { entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui-v0.3.2" }, capabilities: declaration.capabilities, ui: declaration.ui },
  );
});

test("maps current SPS names to Host capabilities without future surfaces", () => {
  assert.equal(requiredSpsUiCapability("page"), "ui.page.register");
  assert.equal(requiredSpsUiCapability("sidebar"), "ui.sidebar.register");
  assert.equal(requiredSpsUiCapability("settings", { scope: "company" }), "instance.settings.register");
  assert.equal(requiredSpsUiCapability("detail-tab"), "ui.detailTab.register");
  assert.deepEqual(SPS_UI_FUTURE_CAPABILITIES, ["shell", "dashboard", "inbox"]);
  assert.throws(() => validateSpsUiContribution({ surface: "dashboard", id: "x", label: "X", exportName: "X" }), /Unsupported SPS UI surface/);
});

test("rejects unsafe paths, reserved routes, raw content, and recovery navigation controls", () => {
  assert.equal(assertSpsUiLabel("Run Console"), "Run Console");
  assert.throws(() => assertSpsUiLabel("  "), /label/);
  assert.equal(assertSpsUiEntrypoint("./dist/ui"), "./dist/ui");
  assert.equal(assertSpsUiEntrypoint("./dist/ui-v0.3.2"), "./dist/ui-v0.3.2");
  assert.throws(() => assertSpsUiEntrypoint("./dist/ui/index.js"), /entrypoint/);
  assert.throws(() => assertSpsUiEntrypoint("./dist/ui bundle"), /entrypoint/);
  assert.throws(() => assertSpsUiEntrypoint("./dist/ui#preview"), /entrypoint/);
  assert.throws(() => assertSpsUiEntrypoint("../dist/ui"), /entrypoint/);
  assert.throws(() => assertSpsUiRoutePath("dashboard"), /reserved/);
  assert.throws(() => assertSpsUiRoutePath("access", { scope: "company" }), /reserved/);
  assert.throws(() => validateSpsUiContribution({ surface: "page", id: "x", label: "X", exportName: "X", routePath: "x", html: "<script>alert(1)</script>" }), /unsupported property/);
  assert.throws(() => validateSpsUiContribution({ surface: "sidebar", id: "x", label: "X", exportName: "X", hideRecoveryNavigation: true }), /unsupported property/);
});

test("rejects malformed slot-specific declarations", () => {
  assert.throws(() => validateSpsUiContribution({ surface: "detail-tab", id: "output", label: "Output", exportName: "OutputTab", entityTypes: [] }), /require at least one/);
  assert.throws(() => validateSpsUiContribution({ surface: "detail-tab", id: "output", label: "Output", exportName: "OutputTab", entityTypes: ["run", "run"] }), /duplicates/);
  assert.throws(() => validateSpsUiContribution({ surface: "settings", id: "settings", label: "Settings", exportName: "Settings", routePath: "oops" }), /cannot declare routePath/);
  assert.throws(() => defineSpsUiContributions({ entrypoint: "./dist/ui", contributions: [
    { surface: "sidebar", id: "duplicate", label: "One", exportName: "One" },
    { surface: "settings", id: "duplicate", label: "Two", exportName: "Two" },
  ] }), /unique/);
});

test("rejects accessor and symbol properties before reading declarations", () => {
  const accessor = {};
  Object.defineProperty(accessor, "surface", { enumerable: true, get() { throw new Error("must not run"); } });
  assert.throws(() => validateSpsUiContribution(accessor), /plain object/);
  assert.throws(() => defineSpsUiContributions({
    entrypoint: "./dist/ui",
    contributions: [],
    [Symbol("hidden")]: true,
  }), /plain object/);
});
