# SPS Plugin SDK

The SPS Plugin SDK is the public toolkit for building SPS extensions. It is
independent from SPS Desktop, Host data, Node credentials, private projects,
and product repositories.

## What it provides

- Extension Profile v1 compatibility checks for existing SPS/Paperclip-era packages.
- Extension Profile v2 checks for the workflow-neutral SPS Core boundary.
- `.spsplugin` packaging, static manifest inspection, and capability digests.
- Ed25519 release and Registry index signing.
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

## Quick start

Node.js 22 or later is required.

```powershell
git clone https://github.com/Powerpunch777/sps-plugin-sdk.git
cd sps-plugin-sdk
npm ci
npm test

node .\cli\sps-plugin.mjs init .\my-plugin --id com.example.my-plugin --package @example/my-plugin
node .\cli\sps-plugin.mjs validate .\my-plugin
node .\cli\sps-plugin.mjs pack .\my-plugin --out .\release\my-plugin.spsplugin
```

## Authoring loop

1. Create a plugin in its own folder or Git repository. Do not edit SPS
   Desktop application files.
2. Declare the minimum capabilities and Core primitives required by the
   plugin.
3. Run `validate` before packaging, then use `inspect` to review the package.
4. Test the package through a Local Development Registry before proposing an
   Official Registry release.
5. Let the Host explicitly stage and activate the package for a Workspace.

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
