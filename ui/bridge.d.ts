export const SPS_UI_BRIDGE_GLOBAL: "__spsPluginBridge__";
export const SPS_UI_BRIDGE_LEGACY_GLOBAL: "__paperclipPluginBridge__";

export type SpsUiBridgeErrorCode =
  | "SPS_UI_BRIDGE_UNINITIALIZED"
  | "SPS_UI_BRIDGE_UNSUPPORTED_HOOK";

export class SpsUiBridgeError extends Error {
  readonly code: SpsUiBridgeErrorCode;
}

export interface PluginBridgeError {
  code: string;
  message: string;
  details?: unknown;
}

export interface PluginDataResult<TData = unknown> {
  data: TData | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh(): void;
}

export type PluginAction<TParams extends Record<string, unknown> = Record<string, unknown>, TResult = unknown> =
  (params?: TParams) => Promise<TResult>;

export interface HostContext {
  companyId: string | null;
  companyPrefix: string | null;
  projectId: string | null;
  entityId: string | null;
  entityType: string | null;
  parentEntityId?: string | null;
  userId: string | null;
}

export interface HostLocation {
  pathname: string;
  search: string;
  hash: string;
  state?: unknown;
}

export interface HostNavigationOptions {
  replace?: boolean;
  state?: unknown;
}

export interface HostNavigationLinkOptions extends HostNavigationOptions {
  target?: string;
  rel?: string;
}

export interface HostNavigationLinkProps {
  href: string;
  target?: string;
  rel?: string;
  onClick(event: { preventDefault(): void }): void;
}

export interface HostNavigation {
  resolveHref(to: string): string;
  navigate(to: string, options?: HostNavigationOptions): void;
  linkProps(to: string, options?: HostNavigationLinkOptions): HostNavigationLinkProps;
}

export interface PluginStreamResult<TEvent = unknown> {
  events: TEvent[];
  lastEvent: TEvent | null;
  connecting: boolean;
  connected: boolean;
  error: Error | null;
  close(): void;
}

export interface PluginToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface PluginToastInput {
  id?: string;
  dedupeKey?: string;
  title: string;
  body?: string;
  tone?: "info" | "success" | "warn" | "error";
  ttlMs?: number;
  action?: PluginToastAction;
}

export type PluginToast = (input: PluginToastInput) => string | null;

export function usePluginData<TData = unknown>(key: string, params?: Record<string, unknown>): PluginDataResult<TData>;
export function usePluginAction<TParams extends Record<string, unknown> = Record<string, unknown>, TResult = unknown>(key: string): PluginAction<TParams, TResult>;
export function useHostContext(): HostContext;
export function useHostLocation(): HostLocation;
export function useHostNavigation(): HostNavigation;
export function usePluginStream<TEvent = unknown>(channel: string, options?: { companyId?: string }): PluginStreamResult<TEvent>;
export function usePluginToast(): PluginToast;
