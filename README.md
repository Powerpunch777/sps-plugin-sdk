# SPS Plugin SDK

SPS is Redon's local-first Desktop workspace for teams building projects with AI and other tools. The SPS Plugin SDK is the public developer toolkit for extending those workspaces with project-specific interfaces, tools, data, and workflows.

The current published SDK release is `0.11.0`; Node.js `22` or later is required. Product compatibility is determined by the Core and SDK revisions pinned together in a Desktop candidate, not by the SDK package version alone.

## What authors can build

The SDK includes:

- Extension Profile 1.0 compatibility checks and Profile 2.0 contracts for new plugins.
- Plugin manifests, safe UI declarations, capability digests, and `.spsplugin` packaging.
- A portable Worker lifecycle and Runtime, platform, and UI bridge entrypoints.
- Developer Mode build contracts, preview fixtures, in-memory testing, diagnostics, and conformance reports.
- The `sps-plugin` CLI for project setup, validation, testing, package inspection, signing, release records, and local or static Registry publishing.
- Dependency planning that reports version, conflict, cycle, and lifecycle-impact evidence without changing plugin state.

Profile 2.0 describes technical primitives such as project Source routing, runtime discovery and dispatch, run observation, artifact writing, and secret references. It does not prescribe tasks, Rooms, roles, approvals, or memory policy; each plugin defines those meanings.

## Start developing

Until an npm package is published, use the public GitHub release tag. Generated Workers are bundled before packaging, so an installed plugin does not need the SDK or `node_modules` at runtime.

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

See the [release tags](https://github.com/Powerpunch777/sps-plugin-sdk/releases) and the documentation in [`profile/`](profile/), [`registry/`](registry/), and [`templates/`](templates/).

## Security and product boundary

A manifest says what a plugin requests; it does not grant Host paths, credentials, runtimes, or permissions. The SDK does not implement the Host transport, launch raw commands, or make plugin lifecycle decisions. SPS Desktop checks its own current policy before routing execution or applying a package change.

Registry and package-signing tools prepare evidence and verify integrity. A signature or recommendation does not make a plugin safe for every project or install it automatically. Use an explicit Host action to trust a local Registry, stage a package, or activate it for a Workspace.

The SDK is licensed under [Apache-2.0](LICENSE). That license does not grant use of SPS or SonParkServer product names and brand assets. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
