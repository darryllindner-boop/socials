/**
 * Minimal ambient declaration so the core can be type-checked WITHOUT
 * installing @types/node. Only the `process` members used by the verification
 * entrypoint are declared. In the real Next.js/worker build, @types/node
 * provides the full, accurate definitions and this file is irrelevant.
 */
declare const process: {
  exit(code?: number): never;
  env: Record<string, string | undefined>;
};
