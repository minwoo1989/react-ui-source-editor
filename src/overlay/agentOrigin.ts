// src/overlay/agentOrigin.ts

/** Parse the origin from a script src; null when empty or unparseable. */
export function originFromSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    return new URL(src).origin;
  } catch {
    return null;
  }
}

/**
 * Agent origin, derived from the <script> that loaded this overlay bundle.
 * The bookmarklet injects a classic <script src="http://host:PORT/overlay.js">,
 * so document.currentScript is valid during this bundle's synchronous run.
 * null when it cannot be determined (no currentScript, or a non-browser env).
 */
export const AGENT_ORIGIN: string | null =
  typeof document !== "undefined"
    ? originFromSrc((document.currentScript as HTMLScriptElement | null)?.src)
    : null;
