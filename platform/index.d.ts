import type { SpsExecution } from "@sonparkserver/plugin-sdk/runtime";

export const SPS_PLATFORM_CONTRACT_VERSION: "1.0";
export const SPS_PLATFORM_CAPABILITIES: readonly [
  "agent.tools.register", "events.subscribe", "events.emit", "jobs.schedule", "plugin.state.read", "plugin.state.write",
  "agents.read", "agent.sessions.create", "agent.sessions.list", "agent.sessions.send", "agent.sessions.read", "agent.sessions.cancel"
];

export type SpsPlatformCapability = (typeof SPS_PLATFORM_CAPABILITIES)[number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export interface SpsStateKey {
  scopeKind: "instance" | "company" | "project" | "project_workspace" | "agent" | "issue" | "thread" | "goal" | "run";
  scopeId?: string;
  namespace?: string;
  stateKey: string;
}
export interface SpsPlatformStateClient {
  get(input: SpsStateKey): Promise<JsonValue | null>;
  set(input: SpsStateKey, value: JsonValue): Promise<void>;
  delete(input: SpsStateKey): Promise<void>;
}
export interface SpsAgentSessionRunResult {
  runId: string;
  status: string;
  cancellationRequested: boolean;
  termination: "not_applicable" | "pending" | "confirmed";
  errorCode: string | null;
  error: string | null;
  execution?: SpsExecution;
}
/** Cached agent adapter configuration and optional Node observation only; this is not permission, login, live/backend readiness, or cancellation support. */
export interface SpsAgentExecutionDescriptor {
  agentId: string;
  adapterType: string;
  state: "configured" | "disabled" | "unknown";
  adapterRegistration: "registered" | "unavailable";
  executionOwner: "adapter" | "node";
  authorization: "recheck_on_dispatch";
  readiness: "unknown";
  node: null | {
    id: string | null;
    state: "inactive" | "unverified" | "recently_seen" | "offline" | "unknown";
    observedAt: string | null;
  };
}
/** The narrow Worker-to-Host API available while a declared handler runs. */
export interface SpsPlatformInvocationContext {
  readonly events: {
    emit(name: string, companyId: string, payload: JsonValue): Promise<void>;
  };
  readonly state: SpsPlatformStateClient;
  readonly agents: SpsAgentSessionClient;
}
export interface SpsAgentSessionClient {
  list(input: { companyId: string; limit?: number }): Promise<Array<Record<string, JsonValue>>>;
  describeExecution(agentId: string, companyId: string): Promise<SpsAgentExecutionDescriptor>;
  sessions: {
    create(agentId: string, companyId: string, options?: { taskKey?: string; reason?: string }): Promise<{ sessionId: string }>;
    list(agentId: string, companyId: string): Promise<Array<Record<string, JsonValue>>>;
    sendMessage(sessionId: string, companyId: string, options: { prompt: string; reason?: string; onEvent?: (event: Record<string, JsonValue>) => void }): Promise<{ runId: string }>;
    getRun(sessionId: string, companyId: string, runId: string): Promise<SpsAgentSessionRunResult>;
    cancel(sessionId: string, companyId: string, runId: string): Promise<SpsAgentSessionRunResult>;
  };
}
export interface SpsActionContext extends SpsPlatformInvocationContext {
  readonly companyId: string;
  readonly actor: Readonly<{ type: "user" | "agent" | "system"; companyId: string; userId?: string | null; agentId?: string | null }>;
}
export interface DataRegistration { key: string; handler(params: JsonObject, platform: SpsPlatformInvocationContext): JsonValue | Promise<JsonValue>; }
export interface ActionRegistration { key: string; handler(params: JsonObject, context: SpsActionContext): JsonValue | Promise<JsonValue>; }
export interface ToolRunContext { agentId: string; runId: string; companyId: string; projectId: string; }
export interface ToolResult { content?: string; data?: JsonValue; error?: string; }
export interface PluginJobContext {
  jobKey: string;
  runId: string;
  trigger: "schedule" | "manual" | "retry";
  scheduledAt: string;
  /** Absent for Host-scoped jobs. */
  companyId?: string;
}
export interface SpsPlatformEvent { eventId: string; eventType: string; occurredAt: string; actorId?: string; actorType?: "user" | "agent" | "system" | "plugin"; entityId?: string; entityType?: string; companyId: string; payload: JsonValue; }
export interface EventFilter { projectId?: string; companyId?: string; agentId?: string; [key: string]: JsonValue | undefined; }
export type ToolHandler = (params: JsonValue, runContext: ToolRunContext, platform: SpsPlatformInvocationContext) => ToolResult | Promise<ToolResult>;
export type EventHandler = (event: SpsPlatformEvent, platform: SpsPlatformInvocationContext) => void | Promise<void>;
export type JobHandler = (job: PluginJobContext, platform: SpsPlatformInvocationContext) => void | Promise<void>;
export interface ToolDeclaration {
  displayName: string;
  description: string;
  parametersSchema: JsonObject;
}
export interface ToolRegistration { name: string; declaration: ToolDeclaration; handler: ToolHandler; }
export interface EventRegistration { name: string; filter?: EventFilter; handler: EventHandler; }
export interface JobRegistration { jobKey: string; handler: JobHandler; }
export interface SpsPlatformContractInput {
  contractVersion?: "1.0";
  capabilities?: readonly SpsPlatformCapability[];
  tools?: readonly ToolRegistration[];
  events?: readonly EventRegistration[];
  jobs?: readonly JobRegistration[];
  data?: readonly DataRegistration[];
  actions?: readonly ActionRegistration[];
}
export interface SpsPlatformContract {
  readonly contractVersion: "1.0";
  readonly capabilities: readonly SpsPlatformCapability[];
  readonly tools: readonly Readonly<ToolRegistration>[];
  readonly events: readonly Readonly<EventRegistration>[];
  readonly jobs: readonly Readonly<JobRegistration>[];
  readonly data: readonly Readonly<DataRegistration>[];
  readonly actions: readonly Readonly<ActionRegistration>[];
}

export function isJsonValue(value: unknown): value is JsonValue;
export function assertJsonValue<T>(value: T, label?: string): T & JsonValue;
export function defineSpsStateKey(key: SpsStateKey): Readonly<SpsStateKey>;
export function defineTool(name: string, declaration: ToolDeclaration, handler: ToolHandler): Readonly<ToolRegistration>;
export function defineEvent(name: string, handler: EventHandler): Readonly<EventRegistration>;
export function defineEvent(name: string, filter: EventFilter, handler: EventHandler): Readonly<EventRegistration>;
export function defineJob(jobKey: string, handler: JobHandler): Readonly<JobRegistration>;
export function defineSpsPlatformContract(contract?: SpsPlatformContractInput): SpsPlatformContract;
