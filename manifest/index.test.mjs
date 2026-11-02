import assert from "node:assert/strict";
import test from "node:test";
import { defineSpsPluginManifest, defineSpsWorkspaceSurfaceManifest } from "./index.mjs";

test("declares a neutral Workspace Shell, Dashboard widget, and Inbox action surface", () => {
  const manifest = defineSpsPluginManifest({
    id: "com.example.workspace",
    apiVersion: 1,
    version: "1.0.0",
    displayName: "Example Workspace",
    capabilities: ["ui.workspaceShell.provide", "ui.dashboard.contribute", "inbox.actions.register", "inbox.items.publish"],
    entrypoints: { ui: "./dist/ui.js" },
    ui: {
      workspaceShell: {
        id: "example-shell",
        displayName: "Example",
        defaultRoute: "/example",
        navigation: [{ id: "home", displayName: "Home", target: "/example", order: 0 }],
        dashboardPreset: [{ pluginKey: "com.example.metrics", widgetId: "status", size: "medium", order: 0 }],
      },
      dashboardWidgets: [{
        id: "status",
        displayName: "Status",
        exportName: "StatusWidget",
        sizes: ["small", "medium"],
        defaultSize: "medium",
        defaultOrder: 0,
        dataAction: "status.read",
      }],
    },
    inbox: { actions: [{ id: "open", displayName: "Open", action: "status.open" }] },
  });
  assert.equal(manifest.ui.workspaceShell.id, "example-shell");
  assert(Object.isFrozen(manifest));
});

test("rejects unsafe routes and inconsistent Dashboard declarations", () => {
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { workspaceShell: { id: "shell", displayName: "Shell", defaultRoute: "relative" } } }), /absolute SPS route/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { workspaceShell: { id: "shell", displayName: "Shell", defaultRoute: "//outside.example" } } }), /safe absolute SPS route/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { workspaceShell: { id: "shell", displayName: "Shell", defaultRoute: "/projects/../settings" } } }), /safe absolute SPS route/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { dashboardWidgets: [{ id: "widget", displayName: "Widget", exportName: "Widget", sizes: ["small"], defaultSize: "full", defaultOrder: 0, dataAction: "read" }] } }), /defaultSize/);
});

test("matches Core limits and identifiers for Workspace surfaces", () => {
  const long = "x".repeat(101);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { workspaceShell: { id: "Uppercase", displayName: "Shell" } } }), /lowercase letters/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { workspaceShell: { id: "shell", displayName: long } } }), /at most 100/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { workspaceShell: { id: "shell", displayName: "Shell", navigation: Array.from({ length: 51 }, (_, index) => ({ id: `item-${index}`, displayName: "Item", target: "/workspace" })) } } }), /at most 50/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { dashboardWidgets: [{ id: "widget", displayName: "Widget", exportName: "Widget", sizes: ["small", "small"], defaultSize: "small", defaultOrder: 0, dataAction: "read" }] } }), /must be unique/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ inbox: { actions: [{ id: "OPEN", displayName: "Open", action: "open" }] } }), /lowercase letters/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { dashboardWidgets: [{ id: "widget", displayName: "Widget", exportName: "Widget", sizes: ["small"], defaultSize: "small", defaultOrder: 0, dataAction: "x".repeat(151) }] } }), /at most 150/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ ui: { dashboardWidgets: Array.from({ length: 101 }, (_, index) => ({ id: `widget-${index}`, displayName: "Widget", exportName: "Widget", sizes: ["small"], defaultSize: "small", defaultOrder: index, dataAction: "read" })) } }), /at most 100/);
  assert.throws(() => defineSpsWorkspaceSurfaceManifest({ inbox: { actions: Array.from({ length: 101 }, (_, index) => ({ id: `action-${index}`, displayName: "Action", action: "run" })) } }), /at most 100/);
});

test("requires the matching capability and UI bundle for declared SPS surfaces", () => {
  assert.throws(() => defineSpsPluginManifest({
    id: "com.example.missing-capability", apiVersion: 1, version: "1.0.0", displayName: "Missing",
    entrypoints: { ui: "./dist/ui.js" },
    ui: { workspaceShell: { id: "shell", displayName: "Shell" } },
  }), /ui\.workspaceShell\.provide/);
  assert.throws(() => defineSpsPluginManifest({
    id: "com.example.missing-ui", apiVersion: 1, version: "1.0.0", displayName: "Missing",
    capabilities: ["ui.dashboard.contribute"],
    ui: { dashboardWidgets: [{ id: "widget", displayName: "Widget", exportName: "Widget", sizes: ["small"], defaultSize: "small", defaultOrder: 0, dataAction: "widget.read" }] },
  }), /entrypoints\.ui/);
  assert.throws(() => defineSpsPluginManifest({
    id: "com.example.missing-action", apiVersion: 1, version: "1.0.0", displayName: "Missing",
    inbox: { actions: [{ id: "open", displayName: "Open", action: "open" }] },
  }), /inbox\.actions\.register/);
});

test("preserves a safe Workspace Worker and inline config schema", () => {
  const workspaceConfigSchema = { type: "object", properties: {
    enabled: { type: "boolean" }, connectionId: { type: "string", format: "uuid" },
  } };
  const manifest = defineSpsPluginManifest({
    id: "com.example.workspace-worker",
    apiVersion: 1,
    version: "1.0.0",
    displayName: "Workspace Worker",
    entrypoints: {
      worker: "./dist/worker.js",
      workspaceWorker: "./dist/workspace-worker.js",
    },
    workspaceConfigSchema,
  });
  assert.deepEqual(manifest.entrypoints, {
    worker: "./dist/worker.js",
    workspaceWorker: "./dist/workspace-worker.js",
  });
  assert.equal(manifest.workspaceConfigSchema, workspaceConfigSchema);
});

test("requires a Workspace Worker when its inline config schema is declared", () => {
  assert.throws(() => defineSpsPluginManifest({
    id: "com.example.orphan-schema",
    apiVersion: 1,
    version: "1.0.0",
    displayName: "Orphan schema",
    workspaceConfigSchema: { type: "object" },
  }), /workspaceConfigSchema requires manifest\.entrypoints\.workspaceWorker/);
});

test("rejects unsafe Workspace Worker paths and non-JSON config schemas", () => {
  const base = { id: "com.example.unsafe-worker", apiVersion: 1, version: "1.0.0", displayName: "Unsafe" };
  for (const path of ["../outside.js", "/absolute.js", "C:/absolute.js", "./nested/../outside.js", "nested\\worker.js",
    "https://example.test/worker.js", "././worker.js", "nested//worker.js", "worker.js/", "worker.js?x", "worker.js#x",
    "worker*.js", "mailto:worker.js"]) {
    assert.throws(() => defineSpsPluginManifest({ ...base, entrypoints: { workspaceWorker: path } }), /safe relative package path/);
  }
  const cyclic = { type: "object" };
  cyclic.self = cyclic;
  for (const schema of ["./dist/schema.json", new Date(), cyclic, { type: "object", properties: { value: undefined } }]) {
    assert.throws(() => defineSpsPluginManifest({ ...base, entrypoints: { workspaceWorker: "./worker.mjs" }, workspaceConfigSchema: schema }), /plain JSON object/);
  }
});

test("rejects Workspace config secret references and async schemas", () => {
  const base = { id: "com.example.workspace-config", apiVersion: 1, version: "1.0.0", displayName: "Workspace config",
    entrypoints: { workspaceWorker: "./worker.mjs" } };
  assert.throws(() => defineSpsPluginManifest({ ...base,
    workspaceConfigSchema: { type: "object", properties: { token: { type: "string", format: "secret-ref" } } },
  }), /cannot declare secret-ref/);
  assert.throws(() => defineSpsPluginManifest({ ...base,
    workspaceConfigSchema: { type: "object", properties: { nested: { $async: true } } },
  }), /cannot declare async schemas/);
});

test("keeps legacy Worker entrypoint strings unchanged", () => {
  const manifest = defineSpsPluginManifest({
    id: "com.example.legacy-worker-path",
    apiVersion: 1,
    version: "1.0.0",
    displayName: "Legacy worker path",
    entrypoints: { worker: "worker.mjs" },
  });
  assert.equal(manifest.entrypoints.worker, "worker.mjs");
});
