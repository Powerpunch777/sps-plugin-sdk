# Platform UI Actions and Agent Sessions (Development)

This additive source API is under development; it is not a published SDK tag.
It does not add Room, Lead, Worker, or any other workflow role to the Host.

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
  `agent.sessions.send`. Its `onEvent` callback receives asynchronous chunk,
  status, done, and error events; terminal events release the callback.

Declare these capabilities both in the manifest and the Platform contract.
The SDK rejects undeclared access, and Core remains the authoritative policy
enforcer. Session create should omit `taskKey` to use Core's default namespace,
or use `plugin:<plugin-id>:session:<plugin-owned-key>` when a stable key is
needed. A custom key outside this namespace cannot be sent to or listed.

This facade does not offer per-message model overrides or run cancellation.
Closing or forgetting a session must not be presented as cancelling its run.
Agent configuration and execution routing continue to belong to the Host.
No arbitrary Host RPC operation or private Core module import is exposed.
