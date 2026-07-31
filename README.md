# SPS Plugin SDK

## Plugin Dependency v1

`@sonparkserver/plugin-sdk/dependency/v1` is a strict, workflow-neutral
dependency planning contract. It declares required plugin dependencies with
inclusive `minVersion` and `maxVersion` bounds, optional plugin dependencies,
optional service discovery, and declared conflicts. The analyzer returns a
fully immutable, deterministic report for missing dependencies, incompatible
versions, conflicts, required-dependency cycles, and disable/delete impact.

```js
import { analyzeSpsPluginDependenciesV1 } from "@sonparkserver/plugin-sdk/dependency/v1";

const plan = analyzeSpsPluginDependenciesV1({
  plugins: [
    { id: "com.example.app", version: "1.0.0", requiredDependencies: [{ id: "com.example.runtime", minVersion: "1.0.0" }] },
    { id: "com.example.runtime", version: "1.2.0", services: [{ id: "runtime.commands" }] },
  ],
  target: { action: "disable", pluginId: "com.example.runtime" },
});
```

This is analysis evidence only. It never installs, downloads, enables,
disables, deletes, executes, or otherwise changes a plugin. A host product
must present the report and make any lifecycle decision explicitly.

Looking for SPS Desktop? Start with the
[SPS product overview](https://github.com/Powerpunch777/SPS).

The SPS Plugin SDK is the public toolkit for building SPS extensions. It is
independent from SPS Desktop, Host data, Node credentials, private projects,
and product repositories.

## What it provides

- Extension Profile v1 compatibility checks for existing SPS/Paperclip-era packages.
- Extension Profile v2 checks for the workflow-neutral SPS Core boundary.
- `.spsplugin` packaging, static manifest inspection, and capability digests.
- Ed25519 release and Registry index signing.
- A workflow-neutral Runtime facade for Source metadata, approved Runtime
  dispatch, run observation, execution grants, and artifact records.
- `sps-plugin` CLI commands for initialization, validation, packaging, key
  generation, release records, and local or static Registry publishing.

## Extension Profile v2

Profile v2 declares only the generic Core primitives a plugin may need:

- Host-managed Workspace source metadata and routed access.
- Available runtimes and dispatch requests.
- Run observation, artifact writing, and secret references.

It does not define a task model, Room, role hierarchy, approval workflow, or
memory strategy. Those meanings belong to the plugin. A manifest declaration
never grants access, installs a plugin, enables a plugin, or exposes a Host
file path or credential.

## Compatibility

| Profile | Purpose | Authoring guidance |
| --- | --- | --- |
| `1.0` | Compatibility bridge for existing SPS/Paperclip-era packages | Keep only while migrating an existing package. |
| `2.0` | Workflow-neutral SPS Core contract | Use for new plugins. |

Profile v2 makes a finite set of technical primitives available: Workspace
Source metadata and routes, runtime discovery and dispatch, run observation,
artifact writing, and secret references. A plugin defines its own workflow
meaning on top of those primitives.

## Runtime facade

New Worker code can import the explicit public entrypoint:

```js
import { createSpsRuntimeClient, defineSpsRuntimeContract } from "@sonparkserver/plugin-sdk/runtime";

const runtime = createSpsRuntimeClient(ctx.spsTransport);
const declaration = defineSpsRuntimeContract({
  primitives: ["runtimes.list", "runtimes.dispatch", "runs.observe"],
});
```

An SPS Desktop Host adapter must inject `ctx.spsTransport` when it launches a
Worker. The facade sends the existing `sps.*` Worker RPC names and payloads
without translating them to a second wire contract. That adapter is
intentionally not part of this SDK slice. The SDK does not ship a Host
transport implementation, nor does it accept raw commands, working
directories, Host paths, or credentials. This keeps plugin packages independent
from private SPS Core checkouts while the Host remains the only authority that
can route execution.

## Portable Worker bootstrap

Plugins that need a Worker can use the public `worker` entrypoint without a
private SPS Core checkout or a Paperclip package. It owns only a small
newline-delimited JSON-RPC lifecycle: `initialize`, `health`, and `shutdown`.
It exposes the same finite ten-operation `spsTransport` used by the Runtime
facade. Logs must go to stderr; stdout is reserved for JSON-RPC messages.
The Host receives the Core `InitializeResult` `{ ok: true, supportedMethods }`;
an `initialize` handler's return value is private setup data, not a protocol
response.

```js
import { defineSpsPlugin, runSpsWorker } from "@sonparkserver/plugin-sdk/worker";

runSpsWorker(defineSpsPlugin({
  async initialize({ spsTransport }) {
    const runtimes = await spsTransport.request("sps.runtimes.list", { companyId: "company-1" });
    return { runtimeCount: runtimes.length };
  },
  health() { return { status: "ok" }; },
  shutdown() { return { stopped: true }; },
}));
```

The optional public `platform` entrypoint adds the current workflow-neutral
Core primitives for tools, events, scheduled jobs, and scoped plugin state.
The package manifest remains authoritative: its tool/job declarations and
capabilities must match the handlers declared by Worker code. SPS Core checks
those capabilities and owns every Host-side operation.

```js
import { defineEvent, defineSpsPlatformContract } from "@sonparkserver/plugin-sdk/platform";
import { defineSpsPlugin, runSpsWorker } from "@sonparkserver/plugin-sdk/worker";

const platform = defineSpsPlatformContract({
  events: [defineEvent("project.updated", async (event, api) => {
    await api.state.set(
      { scopeKind: "project", scopeId: event.payload.projectId, stateKey: "last-event" },
      event.eventId,
    );
  })],
});

runSpsWorker(defineSpsPlugin({ platform }));
```

## Workspace surfaces and Inbox

The public `manifest` entrypoint defines the optional SPS Workspace surface:
a selectable Workspace Shell, neutral Dashboard widgets, and Inbox action
declarations. It validates safe in-app routes and requires the matching
capabilities before a package is built. The Host still decides whether a
plugin is enabled and which Shell is selected.

```js
import { defineSpsPluginManifest } from "@sonparkserver/plugin-sdk/manifest";

export default defineSpsPluginManifest({
  id: "com.example.status",
  apiVersion: 1,
  version: "1.0.0",
  displayName: "Status",
  capabilities: ["ui.dashboard.contribute", "inbox.items.publish"],
  entrypoints: { ui: "./dist/ui.js", worker: "./dist/worker.js" },
  ui: {
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
});
```

Workers publish compact, workflow-neutral summaries through `ctx.inbox`; the
plugin retains its full underlying record. The `worker/testing` entrypoint can
run a public Worker in memory and exposes `inboxItems` as test evidence.

```js
async function initialize({ inbox }) {
  await inbox.publish({
    companyId: "company-1",
    externalId: "build-42",
    category: "build",
    title: "Build complete",
    summary: "Ready for review",
    severity: "success",
  });
}
```

The public `ui` entrypoint validates page, sidebar, settings, and detail-tab
contributions. Plugin UI bundles import hooks from
`@sonparkserver/plugin-sdk/ui/bridge`; the Host injects their implementation at
render time, so public bundles do not import private SPS Core or its React
instance. Shell, Dashboard, and Inbox contributions are deliberately not
claimed until their Core contracts are implemented.

None of these contracts defines task semantics, Rooms, roles, approvals, or a
memory strategy. Those meanings remain plugin-owned.

## Preview fixtures

Plugin Preview can inject a small, read-only fixture into a browser renderer so
UI can be checked as a Host or Member with Node, Runtime, and Source examples
enabled or disabled. The fixture also selects a `desktop` or `mobile` viewport
and a `live`, `empty`, `loading`, or `error` UI state. It is not an execution
context: the contract rejects unknown fields, raw credentials, secrets, and
absolute local paths.

```js
import { readSpsPluginPreviewFixtureV1 } from "@sonparkserver/plugin-sdk/preview/fixtures-v1.mjs";

const preview = readSpsPluginPreviewFixtureV1();
if (preview?.fixtures.runtime.enabled) {
  renderRuntimeExample(preview.fixtures.runtime.payload);
}
```

The SPS Host owns injection through
`globalThis.__SPS_PLUGIN_PREVIEW_FIXTURE_V1__`. Plugins may read it, but must
never write it or treat it as a source of paths, credentials, permissions, or
live Host data.

## Quick start

Node.js 22 or later is required.

Until this package is published to npm, generated projects pin the public
GitHub release tag (`v0.5.0`). The generated Worker is bundled before packaging,
so the installed plugin does not need the SDK or `node_modules` at runtime.

```powershell
git clone https://github.com/Powerpunch777/sps-plugin-sdk.git
cd sps-plugin-sdk
npm ci
npm test

node .\cli\sps-plugin.mjs init .\my-plugin --id com.example.my-plugin --package @example/my-plugin
cd .\my-plugin
npm install
npm run build
cd ..
node .\cli\sps-plugin.mjs validate .\my-plugin
node .\cli\sps-plugin.mjs test .\my-plugin
node .\cli\sps-plugin.mjs pack .\my-plugin --out .\release\my-plugin.spsplugin
```

## Diagnostics, Test Kit, and conformance

The public Phase 5 contracts run in a plugin repository without SPS Desktop.
They model only safe, bounded evidence. They do not expose raw CLI output,
credentials, local paths, or a live Host connection.

```js
import { createSpsPluginTestKitV1 } from "@sonparkserver/plugin-sdk/testing/v1";

const kit = createSpsPluginTestKitV1({
  pluginId: "com.example.plugin",
  pluginVersion: "1.0.0",
});

kit.invokeTool({ id: "build-preview", label: "Build preview" });
kit.useConnector({ id: "registry", label: "Registry" });
kit.setUiState("dashboard", "loading");
kit.disconnect();
// Connector, MCP, Run, and Stream calls now fail deterministically.
kit.reconnect();

const report = kit.createConformanceReport({
  checks: [{ id: "unit", status: "passed", summary: "Plugin contract tests passed." }],
  metadata: { runner: "node-22" },
});
```

`@sonparkserver/plugin-sdk/diagnostics/v1` normalizes immutable diagnostic
events. Each event has a stable ID, origin (`core`, `desktop`, or `plugin`),
category, level, code, UTC ISO timestamp, and structured safe details. A sink
returns a frozen snapshot through `events` or `read()`; it never exposes its
mutable backing list.

`@sonparkserver/plugin-sdk/testing/v1` is deterministic and in-memory. It
models Workspace, Host, Member, Node, Runtime, Source, capability policy,
network disconnect/reconnect, plugin lifecycle, migration, rollback, backup,
restart recovery, Shell/Dashboard/Inbox contribution collisions, and UI
live/empty/loading/error/permission states. It also includes representative
Tool, Event, Stream, Connector, MCP, and visibility operations.

`@sonparkserver/plugin-sdk/conformance/v1` turns test evidence into immutable
release-review metadata. The report is safe to attach to a release proposal:
metadata, summaries, diagnostics, timestamps, and versions are strictly
validated and bounded. Run only the Phase 5 suite with:

```powershell
npm run test:diagnostics
```

## Developer Mode build contract

SPS Developer Mode can observe a plugin source folder without running package
scripts. The public CLI supplies the same machine-readable contract for its
three authoring gates:

```powershell
node .\cli\sps-plugin.mjs build .\my-plugin --json
node .\cli\sps-plugin.mjs validate .\my-plugin --json
node .\cli\sps-plugin.mjs test .\my-plugin --json
```

Each command keeps its existing human output and exit behavior when `--json`
is omitted. With `--json`, standard output contains exactly one JSON object
with `schemaVersion: "development-build/v1"`, the command outcome, source and
build-output SHA-256 fingerprints, timestamps, and path-safe diagnostics. A
failed command still returns non-zero, but does not write stack traces, local
absolute paths, or credential values to the JSON result.

`sourceFingerprint` is deterministic: it hashes sorted relative POSIX paths
and raw bytes from regular source files. It excludes `.git`, `node_modules`,
`dist`, temporary files, logs, and likely secret files such as `.env` and key
material. Symbolic links and junctions in the included source tree are
rejected, as are trees exceeding the file-count or byte limits. This makes a
Developer Mode candidate reproducible without treating generated output or a
developer's private machine state as source.

`manifestSha256` and `workerSha256` are computed from the actual
`dist/manifest.js` and `dist/worker.js` bytes. If `package.json.spsPlugin.ui`
declares a safe file or directory below `dist/`, its sorted paths and bytes are
reported as one deterministic `uiSha256`; when no UI output exists,
`uiSha256` is `null`. Output trees are bounded and reject links just like source
trees. Missing required Worker or manifest outputs make the JSON result fail.
SPS can therefore stage only a candidate whose build, validation, test, source
revision, and output revision agree.

Plugin tools can import the same public contract directly:

```js
import {
  fingerprintDevelopmentSource,
  fingerprintDevelopmentBuildOutputs,
} from "@sonparkserver/plugin-sdk/authoring/development-build-v1.mjs";
```

## Plugin Discovery & Builder typed contract

`@sonparkserver/plugin-sdk/authoring/typed-contract-v1` defines the portable
conversation contract used by Plugin Discovery & Builder. It is intentionally
provider-neutral: an SPS Worker, a local CLI, or a hosted AI can implement an
operation, while SPS receives only strict request/result records.

The six operations are separated into five namespaces:

| Namespace | Operations | Purpose |
| --- | --- | --- |
| `catalog` | `searchCatalog` | Find catalog candidates without installing one. |
| `project` | `createPluginProject` | Create or identify an authoring project. |
| `build` | `runAuthoringStep`, `inspectBuild` | Plan/generate/refine/build/validate/test and inspect typed build evidence. |
| `preview` | `openPreview` | Request a safe preview handle for one built surface. |
| `lifecycle` | `createLifecycleProposal` | Prepare a Host-reviewable lifecycle proposal. |

Lifecycle is deliberately non-mutating. Its only accepted execution value is
`"proposed"`, and every proposal declares `requiresHostConfirmation: true`.
It cannot install, activate, update, disable, or remove a plugin.
Those actions remain Core lifecycle operations after explicit Host review.

Authoring state is referenced by a provider-neutral `authoringSessionId`
(`spsas_...`). Evidence is append-only: each safe request, result, review, or
diagnostic receives an `evidenceRef` (`spsae_...`) and callers get a new frozen
ledger when appending. The contract rejects local/external paths, command
lines, raw tool output, and credential-like text, so the transcript can be
attached to a proposal without exposing a developer machine.

```js
import {
  appendSpsPluginAuthoringEvidenceV1,
  createSpsPluginAuthoringSessionV1,
  defineSpsPluginAuthoringRequestV1,
  defineSpsPluginAuthoringResultV1,
} from "@sonparkserver/plugin-sdk/authoring/typed-contract-v1";

const request = defineSpsPluginAuthoringRequestV1({
  authoringSessionId: "spsas_0123456789abcdef",
  operation: "createLifecycleProposal",
  input: {
    projectId: "sps.project.demo",
    buildId: "sps.build.001",
    action: "install",
    target: {
      pluginKey: "com.example.workplane",
      packageName: "@sps/workplane",
      version: "1.2.3",
      registryStageId: "01234567-89ab-4cde-8fab-0123456789ab",
      scope: "host",
    },
    reason: "Ready for Host review",
  },
});

const result = defineSpsPluginAuthoringResultV1({
  authoringSessionId: request.authoringSessionId,
  operation: "createLifecycleProposal",
  status: "completed",
  output: {
    proposalId: "sps.proposal.001",
    action: request.input.action,
    target: request.input.target,
    execution: "proposed",
    requiresHostConfirmation: true,
  },
});
```

The lifecycle input and output use the same exact `target` shape as Core:
`pluginKey` is required; `pluginId`, `packageName`, `version`, and
`registryStageId` are optional; and `scope` is required. `install` requires
`packageName`, `version`, `registryStageId`, and `scope: "host"`. `update`
requires `version`, `registryStageId`, and `scope: "host"`. Company scope is
limited to `activate` and `disable`; all other operations are Host-scoped.
Unknown target keys, local paths, URLs, and credential-like target/evidence
values are rejected.

## Authoring loop

1. Create a plugin in its own folder or Git repository. Do not edit SPS
   Desktop application files.
2. Install its `@sonparkserver/plugin-sdk` development dependency and run
   `npm run build`. This bundles `src/worker.mjs` into Node 22 ESM
   `dist/worker.js`; the archive excludes `node_modules`, but includes that
   self-contained Worker.
3. Declare the minimum capabilities and Core primitives required by the
   plugin.
4. Run `validate` and `sps-plugin test` before packaging. The latter starts
   only `dist/worker.js` and verifies initialize, health, shutdown, and clean
   process exit. It never executes package scripts or arbitrary commands.
5. Use `inspect` to review the package and test it through a Local Development
   Registry before proposing an
   Official Registry release.
6. Let the Host explicitly stage and activate the package for a Workspace.

An intentionally small Profile v2 declaration looks like this:

```json
{
  "id": "com.example.workplane",
  "version": "1.0.0",
  "entrypoints": { "worker": "./dist/worker.js" },
  "capabilities": ["agent.tools.register"],
  "agentPlatform": {
    "contractVersion": "1.0",
    "kind": "workplane",
    "profileKey": "example-workplane"
  },
  "sps": {
    "contractVersion": "2.0",
    "primitives": ["runtimes.list", "runtimes.dispatch", "runs.observe"]
  }
}
```

The declaration says what the plugin needs. It does not grant a Host path,
credential, runtime, or lifecycle authority.

`sps-plugin init` starts with the smaller neutral declaration
`sps: { contractVersion: "2.0", primitives: [] }`. It intentionally does not
create an `agentPlatform` kind, a task model, a room model, or role semantics.
Generated `package.json` files use the native `spsPlugin` package discovery
key. SPS Desktop still reads `paperclipPlugin` only as a legacy alias for
packages created before native SPS discovery; new plugins must not add it.

## Local registry test

```powershell
node .\cli\sps-plugin.mjs inspect .\my-plugin
node .\cli\sps-plugin.mjs keygen --private .\keys\publisher-private.pem --public .\keys\publisher-public.pem
node .\cli\sps-plugin.mjs keygen --private .\keys\registry-root-private.pem --public .\keys\registry-root-public.pem
node .\cli\sps-plugin.mjs publish-local .\my-plugin --registry .\local-registry --registry-id com.example.local --display-name "Example Local Registry" --publisher-id example --publisher-key-id ed25519:example-publisher --publisher-private-key .\keys\publisher-private.pem --root-key-id ed25519:example-root --root-private-key .\keys\registry-root-private.pem
node .\cli\sps-plugin.mjs inspect .\local-registry
```

The SDK prepares and validates the package and Registry metadata. SPS Desktop
still requires an explicit Host action to trust a Local Development Registry,
stage a package, and activate it for a Workspace.

## Documentation

- [Extension Profile](profile/README-ko.md)
- [Registry contract](registry/README-ko.md)
- [GitHub static Registry template](templates/GITHUB_STATIC_REGISTRY-ko.md)
- [Contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Safety and contribution

Do not publish logs with personal data, invitation codes, project files, API
keys, Registry signing keys, or screenshots of private workspaces. Use
[SECURITY.md](SECURITY.md) for security reports and [CONTRIBUTING.md](CONTRIBUTING.md)
for contribution guidance.

The SDK is licensed under [Apache-2.0](LICENSE). SPS and SonParkServer product
names are not granted for unrelated products by this license.
