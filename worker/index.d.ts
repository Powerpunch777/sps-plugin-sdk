import type { JsonValue, SpsRuntimeOperation, SpsRuntimeTransport } from "@sonparkserver/plugin-sdk/runtime";

export interface SpsPlatformInvocationContext {
  readonly events: { emit(name: string, companyId: string, payload: JsonValue): Promise<void>; };
  readonly state: {
    get(key: Record<string, unknown>): Promise<JsonValue | null>;
    set(key: Record<string, unknown>, value: JsonValue): Promise<void>;
    delete(key: Record<string, unknown>): Promise<void>;
  };
}

export type SpsInboxSeverity = "info" | "success" | "warning" | "error";

/** A compact, workflow-neutral entry shown by the SPS Inbox. */
export interface SpsInboxItemInput {
  companyId: string;
  externalId: string;
  targetUserId?: string | null;
  category: string;
  severity?: SpsInboxSeverity;
  title: string;
  summary: string;
  navigationTarget?: string | null;
  actionIds?: readonly string[];
  opaqueReference?: Record<string, JsonValue>;
}

export interface SpsInboxItemReceipt {
  id: string;
  externalId: string;
}

/**
 * Publishes compact summaries to the Host Inbox. The plugin keeps ownership of
 * the underlying record and supplies a stable externalId for updates.
 */
export interface SpsInboxClient {
  publish(input: SpsInboxItemInput): Promise<SpsInboxItemReceipt>;
  update(input: SpsInboxItemInput): Promise<SpsInboxItemReceipt>;
  withdraw(input: { companyId: string; externalId: string }): Promise<void>;
}

/** Structural shape returned by defineSpsPlatformContract. */
export interface SpsWorkerPlatformContract {
  readonly contractVersion: "1.0";
  readonly tools: readonly unknown[];
  readonly events: readonly unknown[];
  readonly jobs: readonly unknown[];
}

export interface SpsWorkerLifecycleContext {
  readonly params: unknown;
  readonly spsTransport: SpsRuntimeTransport;
  readonly platform: SpsPlatformInvocationContext;
  readonly inbox: SpsInboxClient;
  readonly signal: AbortSignal;
}

export type SpsWorkerHandler = (context: SpsWorkerLifecycleContext) => JsonValue | undefined | Promise<JsonValue | undefined>;

export interface SpsWorkerHandlers {
  initialize?: SpsWorkerHandler;
  health?: SpsWorkerHandler;
  shutdown?: SpsWorkerHandler;
  /** A declaration made by defineSpsPlatformContract; it enables Core platform dispatch. */
  platform?: SpsWorkerPlatformContract;
}

export interface SpsWorkerDefinition {
  readonly handlers: Readonly<SpsWorkerHandlers>;
}

export interface SpsWorkerTransport extends SpsRuntimeTransport {
  request(operation: SpsRuntimeOperation, input: Record<string, unknown>): Promise<unknown>;
}

export interface SpsWorkerRunOptions {
  input?: { on(event: string, listener: (...args: unknown[]) => void): unknown; once?(event: string, listener: (...args: unknown[]) => void): unknown };
  output?: { write(chunk: string): unknown; once?(event: string, listener: (...args: unknown[]) => void): unknown };
  logger?: (message: string) => void;
}

export interface RunningSpsWorker {
  readonly spsTransport: SpsWorkerTransport;
  readonly signal: AbortSignal;
  readonly closed: Promise<void>;
  shutdown(reason?: unknown): void;
}

export function defineSpsPlugin(handlers: SpsWorkerHandlers): SpsWorkerDefinition;
export function runSpsWorker(plugin: SpsWorkerDefinition | SpsWorkerHandlers, options?: SpsWorkerRunOptions): RunningSpsWorker;
