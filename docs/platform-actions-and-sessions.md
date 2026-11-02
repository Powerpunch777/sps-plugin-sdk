# Platform UI Actions and Agent Sessions (Development)

> **Design alignment, 2026-11-02:** [Core/Plugin baseline](core-plugin-design-baseline-2026-11-02.md).
> Agent sessions and UI actions are optional technical capabilities, not a required
> workflow, Builder, AI, common sidebar or Core Settings button. The implementation
> contract below is unchanged; it does not prove the full OS/Preview/product target.

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
- Optional `options.executionPolicy` selects the `plugin-tools-only-v1` mode
  and an explicit allowlist of 1-32 raw plugin tool names. Input order is
  accepted; the SDK detaches and sorts names into ASCII order before dispatch.
  A policy requires a durable `requestId`. This allowlist is authoritative only
  for plugin tool dispatch; it does not certify OS/filesystem/network isolation
  or promise readiness. `sessions.describePolicySupport` is an optional Host
  RPC requiring `agent.sessions.read`. A singleton `modes` list reports that
  the mode is supported; an empty list reports it unsupported. Neither value
  proves runtime readiness or OS isolation: compatible Hosts report
  `readiness: "unknown"` and `osIsolation: "not-certified"`. Older Hosts reject
  the RPC explicitly; the SDK does not infer support or fall back to an
  unrestricted send. Codex CLI runtime restrictions are a separate deployment
  concern and must be configured and verified by the Host. See the official
  [sandbox security guidance](https://developers.openai.com/api/docs/guides/agents-api/environments/security)
  and [self-hosted sandbox guidance](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted).
  The initial SPS implementation supports only local Codex CLI sessions using
  invocation-bound Workspace plugin tools. Legacy Host-worker tools and remote
  Node execution are not eligible for this mode. Support discovery describes
  configuration, not a successful CLI probe; a runtime can still reject unsafe
  command overrides or custom arguments without falling back.
- On a compatible development Host, an optional `options.requestId` UUID asks
  for a durable dispatch receipt. Keep this ID with the exact session, prompt
  and reason before sending. The SDK normalizes the UUID to lowercase. A keyed
  prompt is limited to 48 KiB UTF-8; its optional reason to 1,024 UTF-8 bytes.
  Reusing an ID with different input is rejected. Legacy unkeyed sends retain
  their previous semantics and do not gain this guarantee.
- `agents.sessions.getRequest(sessionId, companyId, requestId)` requires
  `agent.sessions.read` and returns `null` or `{ requestId, state, runId }`.
  `submitted` has a run UUID; `pending` and `uncertain` have `runId: null`.
  This is at-most-once dispatch admission, not exactly-once provider execution.
  A lost wakeup response can be reconciled from the scheduler's committed
  receipt. A crash before acceptance may remain unresolved; neither the SDK nor
  Host automatically replays it. A null lookup during an in-flight send is not
  proof of no execution. Never substitute a new ID to work around uncertainty.
  Missing support on an older Host is an explicit error, not a retry fallback.
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
eight session methods only inside a current Host-issued invocation, fixed to
the exact Workspace and plugin. Core rechecks authority around awaited service
work and before execution/cancellation mutations. `close`, global Agent
mutation and arbitrary invocation remain unavailable. Unkeyed messages still
have no durable request-key/replay guarantee. Even keyed dispatches must query
their receipt rather than automatically replaying an ambiguous send or treating
a timeout as evidence that execution never started. Caller-owned conversation
storage and the Host's dispatch receipt are separate contracts.
Authority revocation while an admitted wakeup is awaiting may reject its response
without undoing a queued/started run; the invocation check is not an ongoing
provider execution lease or an automatic cancellation request.

The agent-session facade does not offer per-message model overrides.
`runtime.runs.cancel` applies only to runs dispatched through the SPS Runtime
facade; it does not cancel agent-session work. Closing or forgetting a session
must not be presented as cancelling its run. Agent configuration and execution
routing continue to belong to the Host.
No arbitrary Host RPC operation or private Core module import is exposed.
