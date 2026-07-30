export const SPS_PLATFORM_CONTRACT_VERSION: "1.0";
export const SPS_PLATFORM_CAPABILITIES: readonly [
  "agent.tools.register", "events.subscribe", "events.emit", "jobs.schedule", "plugin.state.read", "plugin.state.write"
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
/** The narrow Worker-to-Host API available while a declared handler runs. */
export interface SpsPlatformInvocationContext {
  readonly events: {
    emit(name: string, companyId: string, payload: JsonValue): Promise<void>;
  };
  readonly state: SpsPlatformStateClient;
}
export interface ToolRunContext { agentId: string; runId: string; companyId: string; projectId: string; }
export interface ToolResult { content?: string; data?: JsonValue; error?: string; }
export interface PluginJobContext { jobKey: string; runId: string; trigger: "schedule" | "manual" | "retry"; scheduledAt: string; }
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
}
export interface SpsPlatformContract {
  readonly contractVersion: "1.0";
  readonly capabilities: readonly SpsPlatformCapability[];
  readonly tools: readonly Readonly<ToolRegistration>[];
  readonly events: readonly Readonly<EventRegistration>[];
  readonly jobs: readonly Readonly<JobRegistration>[];
}

export function isJsonValue(value: unknown): value is JsonValue;
export function assertJsonValue<T>(value: T, label?: string): T & JsonValue;
export function defineSpsStateKey(key: SpsStateKey): Readonly<SpsStateKey>;
export function defineTool(name: string, declaration: ToolDeclaration, handler: ToolHandler): Readonly<ToolRegistration>;
export function defineEvent(name: string, handler: EventHandler): Readonly<EventRegistration>;
export function defineEvent(name: string, filter: EventFilter, handler: EventHandler): Readonly<EventRegistration>;
export function defineJob(jobKey: string, handler: JobHandler): Readonly<JobRegistration>;
export function defineSpsPlatformContract(contract?: SpsPlatformContractInput): SpsPlatformContract;
