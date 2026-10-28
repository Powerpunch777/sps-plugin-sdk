# Changelog

## Unreleased

- Permit the existing `sps.executions.read` capability in portable platform
  declarations, including model-request Workers that also read common history.

- Add the mock-first public `models.*` Runtime facade and finite Worker RPC
  names with exact per-operation model capabilities, UUID/text/key validation,
  and authenticated invocation-company enforcement. This is an unreleased Core
  dependency; it does not claim provider, backend, cancellation, or pricing support.
- Add the `model_request` execution-history lane without changing the Profile
  v2 primitive matrix.
- Add `agents.describeExecution` through the public Worker bridge with a
  company-scoped cached configuration/Node-observation descriptor; it does not
  report permission, login, live readiness, backend availability, or cancel support.
- Add a bounded public Host support reader for explicitly reported RPC handlers;
  missing or unsupported reports stay unknown and do not imply permissions or readiness.
- Add optional read-only cached Node heartbeat/approval metadata to `PluginSpsRuntime`;
  absence stays unknown and does not prove authentication, socket activity, readiness, or an execution grant.
- Align `PluginJobContext.companyId?: string` with Workspace-scoped Core Jobs.
  Legacy Host Jobs still omit this field; no runtime or package version change.
- Add read-only, company-scoped execution history across Node and Agent Session
  lanes through the finite Runtime and Worker transports.
- Add Profile v2 `executions.observe` and its `sps.executions.read` capability
  mapping, bounded cursor validation, and shared execution/usage DTO types.
- Preserve usage provenance: adapter-reported values are not verified bills,
  unavailable evidence is not zero, and subscription-reference costs may not be
  actual charges.
- Add read-only execution summaries over bounded UTC createdAt windows, with
  explicit usage coverage and separate cost bases under the existing
  `executions.observe` capability.

## 0.11.0 - 2026-08-01

- Add a public, read-only UI data-provider declaration to the platform contract.
- Dispatch Core `getData` requests through the portable Worker protocol while
  preserving company and render-environment scope.
- Keep UI data providers on the same invocation-isolated state bridge used by
  public tools, events, and jobs.

## 0.10.0 - 2026-07-31

- Keep the typed authoring contract read-only for Marketplace Assistant use.
- Remove the obsolete authoring mutation namespace and its target types and
  validators from the public authoring contract.
- Keep plugin Worker technical lifecycle conformance (`initialize`, `health`,
  and `shutdown`) unchanged.
- Add a bounded `getCatalogPlugin` detail operation beside catalog search.

## 0.9.0 - 2026-07-31

- Correct the lifecycle authoring contract to use Core's exact nested `target`
  object instead of the legacy `targetPluginId` field.
- Add typed `pluginKey`, optional plugin/package/version/Registry stage fields,
  and required company/Host scope with the Core action matrix.
- Require lifecycle results to return the exact target, `execution: "proposed"`,
  and `requiresHostConfirmation: true`.
- Reject target/evidence URLs, paths, credential-like text, and unknown keys.

## 0.8.0 - 2026-07-31

- Add the provider-neutral Plugin Discovery & Builder typed authoring contract
  for catalog search, project creation, authoring steps, build inspection, and
  preview handles.
- Separate catalog, project, build, and preview namespaces.
- Add append-only `authoringSessionId` evidence ledgers and path/secret-safe
  request and result validation.

## 0.5.0 - 2026-07-31

- Add the public Developer Mode build contract with deterministic source and
  output fingerprints.
- Add path-safe `--json` output for the Plugin Kit `build`, `validate`, and
  `test` commands.
- Reject source-tree symbolic links and bound source file count and bytes
  before a development candidate can be reported.
- Fingerprint both single-file and directory-based UI builds with bounded,
  link-safe deterministic traversal.

## 0.4.0 - 2026-07-31

- Add Workspace Shell, Dashboard widget, and Inbox manifest contracts.
- Add workflow-neutral Worker Inbox publishing and in-memory test evidence.

## 0.3.0 - 2026-07-31

- Add public Runtime, portable Worker, platform, and UI bridge entrypoints.
- Add a self-contained Node 22 Worker build and CLI lifecycle conformance test.
- Use native `spsPlugin` package metadata while retaining the legacy alias only
  for compatibility.
- Keep generated plugin installs reproducible through the public `v0.3.0`
  GitHub tag until an npm package is published.

## 0.2.1 - 2026-07-30

- Recognize `instance.settings.register` as a valid UI surface capability for
  Settings-only plugins.

## 0.2.0 - 2026-07-30

- Add Extension Profile 2.0 validation for workflow-neutral SPS Core
  primitives.
- Keep Extension Profile 1.0 validation for existing SPS/Paperclip-era
  packages.
- Document the Core/Plugin boundary, Local Development Registry workflow, and
  explicit Host-controlled lifecycle.

## 0.1.0

- Initial public SDK, package tooling, release-record signing, Registry index
  signing, archive inspection, and Local Registry publishing.
