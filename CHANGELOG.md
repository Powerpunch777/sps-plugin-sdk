# Changelog

## 0.8.0 - 2026-07-31

- Add the provider-neutral Plugin Discovery & Builder typed authoring contract
  for catalog search, project creation, authoring steps, build inspection,
  preview handles, and lifecycle proposals.
- Separate catalog, project, build, preview, and lifecycle namespaces.
- Add append-only `authoringSessionId` evidence ledgers and path/secret-safe
  request and result validation.
- Make lifecycle proposals explicitly non-mutating and Host-confirmed.

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
