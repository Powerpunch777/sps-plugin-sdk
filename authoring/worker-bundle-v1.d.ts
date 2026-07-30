export interface PluginWorkerBuildResult {
  readonly sourceDirectory: string;
  readonly entryPoint: string;
  readonly outputPath: string;
  readonly bytes: number;
}

/** Bundles src/worker.mjs into a self-contained Node 22 ESM dist/worker.js. */
export function buildPluginWorker(options: { sourceDirectory: string }): Promise<PluginWorkerBuildResult>;
