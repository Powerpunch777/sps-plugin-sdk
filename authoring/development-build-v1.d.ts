export type DevelopmentBuildCommand = "build" | "validate" | "test";

export interface DevelopmentBuildDiagnostic {
  readonly code: string;
  readonly phase: string;
  /** A path- and secret-safe diagnostic suitable for machine consumers. */
  readonly message: string;
}

export interface DevelopmentBuildResult {
  readonly schemaVersion: "development-build/v1";
  readonly command: DevelopmentBuildCommand;
  readonly success: boolean;
  readonly sourceFingerprint: string | null;
  readonly manifestSha256: string | null;
  readonly workerSha256: string | null;
  readonly uiSha256: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly diagnostics: readonly DevelopmentBuildDiagnostic[];
}

export interface DevelopmentBuildLimits {
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxFileBytes: number;
}

export interface CreateDevelopmentBuildResultInput {
  readonly command: DevelopmentBuildCommand;
  readonly success: boolean;
  readonly sourceFingerprint?: string | null;
  readonly manifestSha256?: string | null;
  readonly workerSha256?: string | null;
  readonly uiSha256?: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly diagnostics?: readonly DevelopmentBuildDiagnostic[];
}

export const DEVELOPMENT_BUILD_SCHEMA_VERSION: "development-build/v1";
export const DEFAULT_DEVELOPMENT_BUILD_LIMITS: Readonly<DevelopmentBuildLimits>;

export function fingerprintDevelopmentSource(options: { sourceDirectory: string; limits?: Partial<DevelopmentBuildLimits> }): Promise<Readonly<{ fingerprint: string; fileCount: number; totalBytes: number }>>;
export function fingerprintDevelopmentBuildOutputs(options: { sourceDirectory: string }): Promise<Readonly<{ manifestSha256: string; workerSha256: string; uiSha256: string | null }>>;
export function developmentBuildDiagnostic(error: unknown, fallback?: Partial<DevelopmentBuildDiagnostic>): DevelopmentBuildDiagnostic;
export function createDevelopmentBuildResult(input: CreateDevelopmentBuildResultInput): DevelopmentBuildResult;
