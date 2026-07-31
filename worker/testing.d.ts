import type { JsonValue } from "@sonparkserver/plugin-sdk/runtime";
import type { SpsInboxItemInput, SpsWorkerDefinition, SpsWorkerHandlers } from "@sonparkserver/plugin-sdk/worker";

export interface SpsInboxTestEvidence {
  id: string;
  companyId: string;
  externalId: string;
  title: string;
  withdrawn: boolean;
}

export interface SpsWorkerTestHarness {
  readonly inboxItems: SpsInboxTestEvidence[];
  initialize(params?: JsonValue): Promise<unknown>;
  health(params?: JsonValue): Promise<unknown>;
  shutdown(params?: JsonValue): Promise<unknown>;
}

/** Runs a public Worker in memory and records its workflow-neutral Inbox calls. */
export function createSpsWorkerTestHarness(
  plugin: SpsWorkerDefinition | SpsWorkerHandlers,
  options?: { onHostRequest?(method: string, params: unknown): unknown | Promise<unknown> },
): SpsWorkerTestHarness;

export type { SpsInboxItemInput };
