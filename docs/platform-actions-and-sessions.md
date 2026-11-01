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
- `agents.sessions.ensure(agentId, companyId, { taskKey, expectedSessionId? })`
  requires the same `agent.sessions.create` capability and sends the explicit
  `agents.sessions.ensure` RPC. On a compatible Host it ensures the stable
  session identified by the exact Workspace, Plugin, Agent, and task key under
  the current invocation. The Host remains authoritative for task-key validity,
  ownership, adapter compatibility, and conflicting context. A retained closed session,
  changed adapter, or conflicting context must fail without returning or
  creating a replacement. If `expectedSessionId` is supplied, only that exact
  ID may be recovered; a missing row or a different ID for the key is a review
  error and must not create a replacement. Without it, the existing ensure
  behavior may create a session when no row exists. This method has no public
  invocation-context override. Existing `create` remains a
  create-new operation and is not changed by `ensure`.
- The Worker never emulates `ensure` with `create` or `list`. If an older Host
  does not implement `agents.sessions.ensure`, the RPC fails closed; absence of
  that Host method is not evidence of safe idempotent behavior.
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
`ensure` is a separate explicit Host operation that must atomically resolve or
create the exact owned session for that key; it does not provide send-message
deduplication. Legacy close/reset paths may physically delete the session row.
Without a durable tombstone, callers that know the prior ID can pass it as
`expectedSessionId` so compare-and-set recovery cannot silently recreate the
row. If that deleted key is ensured without `expectedSessionId`, a new row may
be created; if the expected ID is supplied, the missing row must instead fail.
This identity check is not a lease: a concurrent close/reset can retire a row
after lookup, and send must validate the exact session again. An in-memory test
harness does not prove physical row deletion, database concurrency or
cross-process recovery.

On compatible development Hosts, the dedicated Workspace lane permits these
six session methods only inside a current Host-issued invocation, fixed to
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
