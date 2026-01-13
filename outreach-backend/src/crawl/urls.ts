import { probeUrl } from "./fetch.js";
import { loadLexicon } from "../config/lexicon.js";

export function normalizeBaseUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  s = s.replace(/\/+$/, "");
  return s;
}

/** Extract a hostname from messy model outputs like:
 * - "example.com"
 * - "https://example.com/path"
 * - "example.com)," (punctuation)
 */
export function extractHostnameCandidate(input: string): string {
  let s = (input || "").trim();
  if (!s) return "";

  // Trim common trailing punctuation
  s = s.replace(/[\s\]\)\}\>,;.!?:]+$/g, "");

  // If it's a bare domain without scheme, make it parseable
  const parseable = /^https?:\/\//i.test(s) ? s : `https://${s}`;

  try {
    const u = new URL(parseable);
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    host = host.replace(/\.$/, "");
    return host;
  } catch {
    return "";
  }
}

export function buildOriginCandidates(host: string): string[] {
  const h = (host || "").trim().toLowerCase();
  if (!h) return [];

  const out: string[] = [];
  const base = h.startsWith("www.") ? h : h;
  const withWww = h.startsWith("www.") ? h : `www.${h}`;

  // Prefer https, then www, then http
  out.push(`https://${base}`);
  if (withWww !== base) out.push(`https://${withWww}`);
  out.push(`http://${base}`);
  if (withWww !== base) out.push(`http://${withWww}`);

  return out;
}

/**
 * Resolve the most canonical base origin by probing:
 *  - https://host
 *  - https://www.host
 *  - http://host
 *  - http://www.host
 * and locking the final origin after redirects.
 */
export async function resolveCanonicalBaseUrl(
  input: string,
  opts?: { timeoutMs?: number }
): Promise<string | null> {
  const host = extractHostnameCandidate(input);
  if (!host) return null;

  const candidates = buildOriginCandidates(host);
  const timeoutMs = Math.max(1500, Math.min(opts?.timeoutMs ?? 6000, 15000));

  for (const origin of candidates) {
    const r = await probeUrl(origin + "/", timeoutMs);
    if (!r.ok || !r.finalUrl) continue;

    try {
      const u = new URL(r.finalUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      return u.origin;
    } catch {
      // continue
    }
  }

  // If probe fails, fall back to simple normalization
  try {
    return new URL(`https://${host}`).origin;
  } catch {
    return null;
  }
}

export function buildCandidatePaths(base: string): string[] {
  const LEX = loadLexicon();
  
  // Use paths from lexicon if available, otherwise fallback
  const paths = (LEX.urls?.candidate_paths && LEX.urls.candidate_paths.length)
    ? LEX.urls.candidate_paths
    : [
        "",
        "/impressum",
        "/imprint",
        "/legal",
        "/privacy",
        "/datenschutz",
        "/contact",
        "/contact-us",
        "/contacts",
        "/kontakt",
        "/get-in-touch",
        "/info",
        "/about",
        "/about-us",
        "/team",
        "/studio",
        "/company",
        "/who-we-are",
        "/services",
        "/work",
        "/projects",
        "/portfolio",
      ];

  return paths.map((p) => base + p);
}
