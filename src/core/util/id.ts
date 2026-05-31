/**
 * Generate a short prefixed id. Uses the platform's crypto.randomUUID when
 * available (Node 19+ and all modern browsers) with a deterministic-enough
 * fallback so the core never hard-depends on a specific runtime.
 */
export function newId(prefix: string): string {
  const cryptoObj: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  const uuid =
    cryptoObj && typeof cryptoObj.randomUUID === "function"
      ? cryptoObj.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
}
