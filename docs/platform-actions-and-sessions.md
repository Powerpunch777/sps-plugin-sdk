# Platform UI Actions and Agent Sessions (Development)

This additive source API is under development; it is not part of published SDK
0.11.0 or any published SDK tag. The `sessions.getRun` and `sessions.cancel`
additions are available only to consumers pinned to a source revision that
includes them. The package version remains 0.11.0 until an explicit release.
This API does not add Room, Lead, Worker, or any other workflow role to the Host.

`defineSpsPlatformContract` accepts an `actions` array of `{ key, handler }`.
The UI calls it through `usePluginAction(key)`. The handler receives its input
and a context containing `companyId` and immutable `actor` metadata supplied by
the Host. Never authorize an action using roles or company IDs in UI input.
The existing Host may omit the top-level company ID on `performAction`; the
authoritative scope is `actorContext.companyId`. Missing or inconsistent
authenticated scope is rejected. Plugins decide which actor types can act.

The invocation context also exposes the existing Core Agent session ABI:

- `agents.list({ companyId, limit })` requires `agents.read`.
- `agents.sessions.create(agentId, companyId, options)` requires
  `agent.sessions.create`.
- `agents.sessions.list(agentId, companyId)` requires `agent.sessions.list`.
- `agents.sessions.sendMessage(sessionId, companyId, options)` requires
  `agent.sessions.send`. Legacy Host workers may receive asynchronous chunk,
  status, done, and error events through `onEvent`; terminal events release the
  callback. The dedicated Workspace worker lane does not provide that legacy
  raw event feed. Use explicit bounded `getRun` polling in that lane.
- `agents.sessions.getRun(sessionId, companyId, runId)` requires
  `agent.sessions.read` and returns the bounded run status and error fields.
  Its optional `execution` field carries the safe shared execution-history DTO
  when the Host has explicit evidence; it may be absent on older Hosts.
  Its optional `output` field reports `not_ready`, `available` with `text`, or
  `withheld` with a reason. Only a successful run's persisted `summary` may be
  returned, up to 65,536 UTF-8 bytes before and after common-pattern redaction.
  Invalid Unicode/control characters, missing or oversized summaries are
  withheld, never truncated into a claimed complete answer. Raw adapter result,
  stdout/stderr, configuration and credential fields are not this output DTO.
  Common-pattern redaction is not a DLP or unknown-secret guarantee. Older
  Hosts may omit `output`; absence is not an empty answer.
- `agents.sessions.cancel(sessionId, companyId, runId)` requires
  `agent.sessions.cancel` and returns Core's cancellation/termination state.
  This RPC response does not end the `sendMessage` event stream or release its
  callback; only the normal `done` or `error` event does that.

Declare these capabilities both in the manifest and the Platform contract.
The SDK rejects undeclared access, and Core remains the authoritative policy
enforcer. Session create should omit `taskKey` to use Core's default namespace,
or use `plugin:<plugin-id>:session:<plugin-owned-key>` when a stable key is
needed. A new custom key must have a non-empty suffix, fit 1,024 UTF-8 bytes,
and contain no invalid Unicode or control characters. Core rejects creation
outside this namespace; it is not an idempotent session-ensure operation.

On compatible development Hosts, the dedicated Workspace lane permits these
five session methods only inside a current Host-issued invocation, fixed to
the exact Workspace and plugin. Core rechecks authority around awaited service
work and before execution/cancellation mutations. `close`, global Agent
mutation and arbitrary invocation remain unavailable. A message send still
has no durable request-key/replay guarantee: do not automatically retry an
ambiguous send or treat a timeout as evidence that execution never started.
Authority revocation while an admitted wakeup is awaiting may reject its response
without undoing a queued/started run; the invocation check is not an ongoing
provider execution lease or an automatic cancellation request.

The agent-session facade does not offer per-message model overrides.
`runtime.runs.cancel` applies only to runs dispatched through the SPS Runtime
facade; it does not cancel agent-session work. Closing or forgetting a session
must not be presented as cancelling its run. Agent configuration and execution
routing continue to belong to the Host.
No arbitrary Host RPC operation or private Core module import is exposed.
