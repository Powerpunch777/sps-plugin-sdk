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

Profile primitives are checked against Core capabilities during validation.
For example, `runtimes.list` requires `sps.runtimes.read`,
`runtimes.dispatch` requires `sps.runs.dispatch`, and `artifacts.write`
requires `sps.artifacts.write`. Routed Source access remains indirect: a
plugin receives Source metadata only, while SPS Desktop resolves the encrypted
route only for an active grant-backed run.

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

## Safety and contribution

Do not publish logs with personal data, invitation codes, project files, API
keys, Registry signing keys, or screenshots of private workspaces. Use
[SECURITY.md](SECURITY.md) for security reports and [CONTRIBUTING.md](CONTRIBUTING.md)
for contribution guidance.

The SDK is licensed under [Apache-2.0](LICENSE). SPS and SonParkServer product
names are not granted for unrelated products by this license.
