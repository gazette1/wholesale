const FALLBACK = "/dashboard";

/**
 * Where to go after sign in. Only a path on this site is allowed.
 * "//example.com" and "/\example.com" are read by browsers as another host, so both are refused,
 * along with backslashes, control characters, and anything that carries a scheme.
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2000) return FALLBACK;
  if (!next.startsWith("/") || next.startsWith("//")) return FALLBACK;
  if (next.includes("\\")) return FALLBACK;
  for (let i = 0; i < next.length; i += 1) {
    const code = next.charCodeAt(i);
    // Tabs and newlines are stripped by browsers, which can turn "/<tab>/host" into "//host".
    if (code < 32 || code === 127) return FALLBACK;
  }
  if (next.includes("://") || /^\/*[a-z][a-z0-9+.-]*:/i.test(next)) return FALLBACK;
  try {
    // Last check: resolved against a placeholder origin, the value must stay on that origin.
    const base = "http://internal.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return FALLBACK;
    // "/..//example.com" normalizes to "//example.com", which a browser reads as another host.
    if (url.pathname.startsWith("//")) return FALLBACK;
    return next;
  } catch {
    return FALLBACK;
  }
}
