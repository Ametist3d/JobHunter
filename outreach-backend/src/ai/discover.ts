import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ai } from "./gemini.js";
import { extractJsonObject } from "./parseJson.js";
import { resolveCanonicalBaseUrl, extractHostnameCandidate } from "../crawl/urls.js";

export type DiscoverInput = {
  region: string;
  companySize: "small" | "medium" | "large";
  domain?: string;
  limit?: number;

  // ✅ DB-related addition only:
  excludeDomains?: string[]; // domains to skip (e.g. from DB)
};

export type Lead = {
  website: string; // normalized to origin: https://domain.tld
  title?: string;
  snippet?: string;
  source?: string; // "google_search_grounding" | "model_json_fallback"
};

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizeToOrigin(u: string): string | null {
  try {
    const url = new URL(u.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uniqByDomain(leads: Lead[]) {
  const seen = new Set<string>();
  const out: Lead[] = [];
  for (const l of leads) {
    try {
      const host = new URL(l.website).hostname.toLowerCase();
      if (seen.has(host)) continue;
      seen.add(host);
      out.push(l);
    } catch {
      // ignore
    }
  }
  return out;
}

const BLOCKED_HOST_SUBSTRINGS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "tiktok.com",
  "wikipedia.org",
  "archdaily",
  "dezeen",
  "designboom",
  "baunetz",
  "competitionline",
  "houzz",
  "pinterest",
  "behance",
  "issuu",
  "medium.com",
];

function isBlockedHost(host: string) {
  return BLOCKED_HOST_SUBSTRINGS.some((b) => host.includes(b));
}

async function canonicalizeLeadWebsites(
  leads: Lead[],
  opts: { timeoutMs?: number; concurrency?: number },
  excludeSet: Set<string>
) {
  const timeoutMs = Math.max(1500, Math.min(opts.timeoutMs ?? 5000, 15000));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 10, 25));

  const out: Lead[] = new Array(leads.length);

  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= leads.length) break;
      const l = leads[i];

      const resolved = await resolveCanonicalBaseUrl(l.website, { timeoutMs });
      const website = resolved ?? l.website;

      // Re-check against block/exclude after redirects.
      let host = "";
      try {
        host = new URL(website).hostname.toLowerCase();
      } catch {
        host = extractHostnameCandidate(website);
      }

      if (!host || isBlockedHost(host) || isExcludedHost(host, excludeSet)) {
        // Drop invalid/blocked results by returning a marker website that will be filtered out later.
        out[i] = { ...l, website: "" };
      } else {
        out[i] = { ...l, website };
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return out.filter((l) => !!l.website);
}

// ✅ DB-related addition only:
function normalizeDomain(host: string) {
  let h = (host || "").trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  h = h.replace(/\.$/, "");
  return h;
}

function isExcludedHost(host: string, excludeSet: Set<string>) {
  if (!excludeSet || excludeSet.size === 0) return false;
  const h = normalizeDomain(host);
  return excludeSet.has(h);
}

/**
 * IMPORTANT: In your actual Gemini grounding response:
 * - groundingChunks[].web.uri is a Google redirect token (NOT crawlable)
 * - groundingChunks[].web.title contains the real domain (often without protocol)
 *
 * This function converts web.title into https://domain and then normalizes to origin.
 */
function websiteFromGroundingTitle(
  title: unknown,
  excludeSet: Set<string>
): string | null {
  if (typeof title !== "string") return null;

  const t = title.trim();
  if (!t) return null;

  // In your dump, title is often just "example.com" (no protocol)
  // Sometimes it might include protocol - handle both.
  const candidate =
    t.startsWith("http://") || t.startsWith("https://") ? t : `https://${t}`;

  const origin = normalizeToOrigin(candidate);
  if (!origin) return null;

  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (isBlockedHost(host)) return null;

    // ✅ DB-related addition only:
    if (isExcludedHost(host, excludeSet)) return null;
  } catch {
    return null;
  }

  return origin;
}

function extractLeadsFromGrounding(
  res: any,
  limit: number,
  excludeSet: Set<string>
): Lead[] {
  const out: Lead[] = [];

  const candidates: any[] = Array.isArray(res?.candidates) ? res.candidates : [];
  const cand0 = candidates[0];
  const gm = cand0?.groundingMetadata ?? cand0?.grounding_metadata;

  const chunks: any[] = Array.isArray(gm?.groundingChunks) ? gm.groundingChunks : [];
  for (const ch of chunks) {
    const web = ch?.web;
    const website = websiteFromGroundingTitle(web?.title, excludeSet);
    if (!website) continue;

    out.push({
      website,
      title: typeof web?.title === "string" ? web.title : undefined,
      snippet: typeof web?.snippet === "string" ? web.snippet : undefined,
      source: "google_search_grounding",
    });

    if (out.length >= limit) break;
  }

  return uniqByDomain(out).slice(0, limit);
}

/**
 * Fallback: parse model JSON if grounding has no usable domains.
 * This is less safe, but prevents “empty results”.
 */
function extractLeadsFromModelJson(
  rawText: string,
  limit: number,
  excludeSet: Set<string>
): Lead[] {
  const cleaned: Lead[] = [];

  try {
    const jsonStr = extractJsonObject(rawText);
    const parsed = JSON.parse(jsonStr);

    const leadsRaw: any[] = Array.isArray(parsed.leads) ? parsed.leads : [];
    for (const item of leadsRaw) {
      const origin = normalizeToOrigin(String(item?.website ?? ""));
      if (!origin) continue;

      let host = "";
      try {
        host = new URL(origin).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (isBlockedHost(host)) continue;

      // ✅ DB-related addition only:
      if (isExcludedHost(host, excludeSet)) continue;

      cleaned.push({
        website: origin,
        title: typeof item?.title === "string" ? item.title.trim() : undefined,
        snippet:
          typeof item?.snippet === "string" ? item.snippet.trim() : undefined,
        source: "model_json_fallback",
      });
    }
  } catch {
    // ignore
  }

  return uniqByDomain(cleaned).slice(0, limit);
}

export async function discoverLeads(input: DiscoverInput) {
  console.log("[Discover] Starting with input:", JSON.stringify({
    region: input.region,
    companySize: input.companySize,
    domain: input.domain,
    limit: input.limit,
    excludeCount: input.excludeDomains?.length ?? 0,
  }));

  const model = process.env.GEMINI_SEARCH_MODEL || "gemini-2.5-flash";
  const limit = Math.max(10, Math.min(input.limit ?? 120, 500));
  const domain = (input.domain?.trim() || "architectural firms").trim();
  const region = input.region.trim();
  const companySize = input.companySize;

  const excludeSet = new Set<string>(
    (input.excludeDomains ?? [])
      .map((d) => normalizeDomain(d))
      .filter(Boolean)
      .slice(0, 250)
  );

  // Don't include huge exclude list in prompt - it can confuse the model
  // Just note that we have exclusions
  const excludeBlock =
    excludeSet.size > 0
      ? `\nALREADY CONTACTED (exclude these domains from results):\n${Array.from(excludeSet).slice(0, 100).join(", ")}\n`
      : "";

  const prompt = `
  You are a lead-generation assistant.
  Goal: return a list of company websites for outreach.

  Target:
  - Region: ${region}
  - Company size: ${companySize}
  - Market domain: ${domain}
  ${excludeBlock}
  RULES:
  - Use Google Search grounding (tool will be enabled).
  - Return up to ${limit} UNIQUE official company websites (prefer official company domains, not directories).
  - Exclude: job boards, Wikipedia, social profiles, marketplaces, news articles, and portfolio aggregators unless it's clearly a company site.
  - Output ONLY valid JSON (no markdown, no commentary):
  {"leads":[{"website":"https://...","title":"...","snippet":"..."}]}
  `.trim();

  const promptSha = sha256(prompt);

  console.log("[Discover] Calling Gemini API...");
  console.log("[Discover] Exclude domains:", Array.from(excludeSet).slice(0, 10), `... (${excludeSet.size} total)`);
  const startTime = Date.now();

  let res: any;
  try {
    res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      },
    });
    console.log(`[Discover] Gemini responded in ${Date.now() - startTime}ms`);
  } catch (e: any) {
    console.error("[Discover] Gemini API error:", e.message);
    throw e;
  }

  // Log what we got
  console.log("[Discover] Response text length:", (res.text ?? "").length);
  console.log("[Discover] Has groundingChunks:", 
    !!(res as any)?.candidates?.[0]?.groundingMetadata?.groundingChunks?.length
  );

  // Debug dump (optional)
  if (process.env.DEBUG_GEMINI === "1") {
    const outDir = path.resolve(process.cwd(), "debug");
    fs.mkdirSync(outDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(outDir, `gemini_discover_${ts}`);

    fs.writeFileSync(`${base}.text.txt`, res.text ?? "", "utf8");

    const seen = new WeakSet();
    const safe = JSON.parse(
      JSON.stringify(res, (_k, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      })
    );

    fs.writeFileSync(`${base}.json`, JSON.stringify(safe, null, 2), "utf8");
    console.log(`[DEBUG_GEMINI] wrote ${base}.json and ${base}.text.txt`);
  }

  // ✅ Prefer grounding-derived domains (web.title) first
  let leads = extractLeadsFromGrounding(res, limit, excludeSet);

  // Fallback to model JSON if grounding is missing/empty
  if (leads.length === 0) {
    leads = extractLeadsFromModelJson(res.text ?? "", limit, excludeSet);
  }

  // Canonicalize websites (protocol/www/redirect resolution) to reduce wrong-domain noise.
  // This is deterministic and more reliable than making the Gemini prompt more complex.
  leads = await canonicalizeLeadWebsites(
    leads,
    { timeoutMs: 5000, concurrency: 10 },
    excludeSet
  );

  // Re-dedupe after canonicalization (redirects often collapse www/non-www variants)
  leads = uniqByDomain(leads).slice(0, limit);

  return {
    ok: true,
    model,
    promptSha256: promptSha,
    leads,
    stats: {
      total: leads.length,
      uniqueDomains: leads.length,
      withTitles: leads.filter((l) => (l.title || "").length > 0).length,

      // ✅ DB-related addition only:
      excludedInPrompt: excludeSet.size,
    },
  };
}
