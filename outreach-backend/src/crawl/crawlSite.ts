import { load } from "cheerio";
import { fetchHtml } from "./fetch.js";
import { extractEmailsFromText } from "./emailExtract.js";
import { buildCandidatePaths, normalizeBaseUrl, resolveCanonicalBaseUrl } from "./urls.js";
import { extractSiteContext, type SiteContext } from "./extractSiteContext.js";
import { loadLexicon } from "../config/lexicon.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Load lexicon once at module level
const LEX = loadLexicon();
const TOKENS_CONTACT = (LEX.crawl?.tokens_contact ?? []).map((s) => s.toLowerCase());
const TOKENS_LEGAL = (LEX.crawl?.tokens_legal ?? []).map((s) => s.toLowerCase());
const TOKENS_ABOUT = (LEX.crawl?.tokens_about ?? []).map((s) => s.toLowerCase());
const URL_HINTS = (LEX.crawl?.url_hints ?? []).map((s) => s.toLowerCase());
const JOB_KEYWORDS = (LEX.crawl?.job_keywords ?? []).map((s) => s.toLowerCase());

export function detectJobPosting(html: string, targetPosition: string): {
  hasJobPage: boolean;
  hasMatchingJob: boolean;
  jobTitles: string[];
  evidence: string[];
} {
  const $ = load(html);
  const text = $("body").text().toLowerCase();
  const evidence: string[] = [];
  const jobTitles: string[] = [];

  // Check for career page indicators
  const hasJobPage = JOB_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
  
  if (hasJobPage) {
    evidence.push("Page contains job-related keywords");
  }

  // Look for job titles in headings
  const targetLower = targetPosition.toLowerCase();
  const targetWords = targetLower.split(/\s+/);

  $("h1, h2, h3, h4, .job-title, [class*='job'], [class*='position'], [class*='vacancy']").each((_, el) => {
    const heading = $(el).text().trim();
    if (heading.length > 3 && heading.length < 100) {
      const headingLower = heading.toLowerCase();
      
      // Check if heading matches target position
      const matchesTarget = targetWords.some(word => 
        word.length > 3 && headingLower.includes(word)
      );
      
      if (matchesTarget) {
        jobTitles.push(heading);
        evidence.push(`Found matching heading: "${heading}"`);
      }
    }
  });

  // Check page title and meta
  const pageTitle = $("title").text().toLowerCase();
  const metaDesc = $('meta[name="description"]').attr("content")?.toLowerCase() || "";
  
  if (targetWords.some(w => w.length > 3 && (pageTitle.includes(w) || metaDesc.includes(w)))) {
    evidence.push("Position mentioned in page title/meta");
  }

  const hasMatchingJob = jobTitles.length > 0 || 
    targetWords.some(w => w.length > 3 && text.includes(w));

  return {
    hasJobPage,
    hasMatchingJob,
    jobTitles: [...new Set(jobTitles)].slice(0, 5),
    evidence,
  };
}

function normalizeTextForEmailHarvest(s: string): string {
  // Convert common obfuscations into something extractEmailsFromText can catch
  return (
    s
      // HTML entity variants for @
      .replace(/&#64;|&commat;|&#x40;/gi, "@")
      // common "at"
      .replace(/\s*\(at\)\s*|\s*\[at\]\s*|\s+at\s+/gi, "@")
      // common "dot"
      .replace(/\s*\(dot\)\s*|\s*\[dot\]\s*|\s+dot\s+/gi, ".")
      // sometimes " (ät) " in EU locales
      .replace(/\s*\(ät\)\s*|\s*\[ät\]\s*/gi, "@")
      // remove zero-width chars
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
  );
}

function safeHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function stripHashKeepQuery(u: URL) {
  u.hash = "";
  return u.toString();
}

function textIncludesAny(text: string, tokens: string[]) {
  const t = text.toLowerCase();
  return tokens.some((k) => t.includes(k.toLowerCase()));
}

function scoreLink(params: {
  absUrl: string;
  anchorText: string;
  inNavOrFooter: boolean;
}): number {
  const u = params.absUrl.toLowerCase();
  const a = (params.anchorText || "").toLowerCase();

  let score = 0;

  // Highest signal: mailto directly
  if (u.startsWith("mailto:")) score += 100;

  // URL hints
  for (const h of URL_HINTS) if (u.includes(h)) score += 10;

  // Anchor text (often localized even if slug isn't)
  if (textIncludesAny(a, TOKENS_CONTACT)) score += 25;
  if (textIncludesAny(a, TOKENS_LEGAL)) score += 18;
  if (textIncludesAny(a, TOKENS_ABOUT)) score += 10;

  // If link sits in nav/footer, it's frequently “Contact / Impressum”
  if (params.inNavOrFooter) score += 8;

  // Penalize obvious low-value links
  if (u.includes("/wp-content/")) score -= 50;
  if (u.includes(".pdf")) score -= 2; // still can contain emails, but don’t over-prioritize
  if (u.includes("#")) score -= 2;

  return score;
}

function collectScoredInternalLinks(
  html: string,
  currentUrl: string,
  baseHost: string
) {
  const $ = load(html);
  const scored = new Map<string, number>();

  $("a[href]").each((_, el) => {
    const hrefRaw = ($(el).attr("href") || "").trim();
    if (!hrefRaw) return;

    const low = hrefRaw.toLowerCase();
    if (low.startsWith("#")) return;
    if (low.startsWith("javascript:")) return;
    if (low.startsWith("tel:")) return;

    // keep mailto as evidence too (but we don't enqueue it)
    if (low.startsWith("mailto:")) return;

    let abs: URL;
    try {
      abs = new URL(hrefRaw, currentUrl);
    } catch {
      return;
    }

    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    if (abs.hostname.toLowerCase() !== baseHost) return;

    const normalized = stripHashKeepQuery(abs);

    // identify if within nav/footer-ish area
    const parents = $(el).parents();
    const inNavOrFooter =
      parents.is("nav") ||
      parents.is("footer") ||
      parents.is("header") ||
      parents
        .toArray()
        .some((p) => {
          const cls = String((p as any).attribs?.class || "").toLowerCase();
          const id = String((p as any).attribs?.id || "").toLowerCase();
          return (
            cls.includes("nav") ||
            cls.includes("menu") ||
            cls.includes("footer") ||
            cls.includes("header") ||
            id.includes("nav") ||
            id.includes("menu") ||
            id.includes("footer") ||
            id.includes("header")
          );
        });

    const anchorText = ($(el).text() || "").trim();

    const s = scoreLink({ absUrl: normalized, anchorText, inNavOrFooter });

    // Don’t enqueue everything: only keep links with any meaningful signal
    if (s <= 0) return;

    const prev = scored.get(normalized) ?? 0;
    if (s > prev) scored.set(normalized, s);
  });

  return scored;
}

function extractEmailsFromHtmlBetter(html: string): string[] {
  const found = new Set<string>();
  const $ = load(html);

  // 1) raw html (with de-obfuscation)
  for (const e of extractEmailsFromText(normalizeTextForEmailHarvest(html)))
    found.add(e);

  // 2) body text (more human-visible)
  const bodyText = $("body").text() || "";
  for (const e of extractEmailsFromText(normalizeTextForEmailHarvest(bodyText)))
    found.add(e);

  // 3) attributes (data-email, aria-label, etc.) - capped to stay fast
  let n = 0;
  const MAX_ATTR_SCAN = 900;
  $("*").each((_, el) => {
    if (n++ > MAX_ATTR_SCAN) return false as any;
    const attrs = (el as any).attribs as Record<string, string> | undefined;
    if (!attrs) return;

    for (const k of Object.keys(attrs)) {
      const v = String(attrs[k] || "");
      if (!v) continue;
      if (
        !v.includes("@") &&
        !v.includes("&#64") &&
        !v.toLowerCase().includes("(at)") &&
        !v.toLowerCase().includes("[at]")
      )
        continue;

      for (const e of extractEmailsFromText(normalizeTextForEmailHarvest(v)))
        found.add(e);
    }
  });

  // 4) mailto (most reliable)
  $("a[href^='mailto:']").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    const email = href
      .replace(/^mailto:/i, "")
      .split("?")[0]
      .trim()
      .toLowerCase();
    if (email && email.includes("@")) found.add(email);
  });

  return [...found];
}

function rankEmails(emails: string[], baseHost: string): string[] {
  const host = baseHost.toLowerCase();
  const uniq = [...new Set(emails.map((e) => e.toLowerCase()))];

  function scoreEmail(e: string) {
    let s = 0;
    const domain = e.split("@")[1] || "";
    const d = domain.toLowerCase();

    // Prefer same-domain emails (or subdomains)
    if (d === host) s += 50;
    if (d.endsWith("." + host)) s += 40;

    // Prefer common business inboxes
    if (e.startsWith("info@")) s += 8;
    if (e.startsWith("hello@")) s += 7;
    if (e.startsWith("contact@")) s += 7;
    if (e.startsWith("office@")) s += 6;
    if (e.startsWith("sales@")) s += 5;
    if (e.startsWith("support@")) s += 4;

    // De-prioritize common junk-ish sources (still keep if nothing else)
    if (d.includes("sentry")) s -= 20;
    if (d.includes("wix")) s -= 10;

    return s;
  }

  return uniq.sort((a, b) => scoreEmail(b) - scoreEmail(a));
}

export async function crawlForEmails(
  website: string,
  opts?: {
    timeoutMs?: number;
    delayBetweenPagesMs?: number;
    maxPages?: number; // total pages to fetch (cap)
    topLinksToVisit?: number; // how many scored internal pages to prioritize
  }
) {
  let siteContext: SiteContext | undefined;

  const timeoutMs = opts?.timeoutMs ?? 12000;
  const delayBetweenPagesMs = opts?.delayBetweenPagesMs ?? 350;
  const maxPages = opts?.maxPages ?? 8;
  const topLinksToVisit = Math.max(3, Math.min(opts?.topLinksToVisit ?? 8, 15));

  // Canonicalize domain first (protocol/www/redirects) to avoid crawling the wrong host.
  const canonical = await resolveCanonicalBaseUrl(website, {
    timeoutMs: Math.min(timeoutMs, 6000),
  });
  const base = canonical ?? normalizeBaseUrl(website);
  const baseHost = safeHostname(base);

  // Old behavior: seeded “candidate paths” (keep it)
  const seeded = buildCandidatePaths(base);

  // Queue with simple priority (we’ll inject scored pages near the front)
  const queue: string[] = [];
  const enqueued = new Set<string>();
  const visited = new Set<string>();

  function enqueue(u: string, priority = false) {
    if (!u) return;
    if (enqueued.has(u)) return;
    enqueued.add(u);
    if (priority) queue.unshift(u);
    else queue.push(u);
  }

  // Always start from homepage
  enqueue(base, true);

  // Keep candidate paths, but don't let them dominate
  for (const u of seeded) enqueue(u, false);

  const foundEmails = new Set<string>();
  const evidenceUrls: string[] = [];

  // Track & merge link scores across pages (homepage + any visited page)
  const scoredLinks = new Map<string, number>();

  function mergeScores(next: Map<string, number>) {
    for (const [u, s] of next.entries()) {
      const prev = scoredLinks.get(u) ?? 0;
      if (s > prev) scoredLinks.set(u, s);
    }
  }

  function injectTopScoredLinks() {
    // take top scored internal links that we haven't visited/enqueued, and add with priority
    const candidates = [...scoredLinks.entries()]
      .filter(([u, s]) => s > 0 && !visited.has(u) && !enqueued.has(u))
      .sort((a, b) => b[1] - a[1])
      .slice(0, topLinksToVisit);

    for (const [u] of candidates) enqueue(u, true);
  }

  while (queue.length > 0 && visited.size < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const res = await fetchHtml(url, timeoutMs);
    if (!res.ok || !res.html) {
      await sleep(delayBetweenPagesMs);
      continue;
    }

    const html = res.html;

    // Extract site context once (keep your current behavior)
    if (!siteContext) siteContext = extractSiteContext(html);

    // 1) email extraction (improved)
    const emailsHere = extractEmailsFromHtmlBetter(html);
    for (const e of emailsHere) foundEmails.add(e);

    if (emailsHere.length > 0) {
      evidenceUrls.push(res.finalUrl || url);
      // Keep going (maybe we find better / more relevant emails), but bounded by maxPages
    }

    // 2) link scoring (multilingual-ish without exploding)
    if (baseHost) {
      const links = collectScoredInternalLinks(html, res.finalUrl || url, baseHost);
      mergeScores(links);

      // If we still don't have emails, aggressively inject top “contact-ish” links next
      // If we already have emails, still inject a couple (to find a better email like info@ vs random)
      injectTopScoredLinks();
    }

    await sleep(delayBetweenPagesMs);
  }

  const ranked = baseHost ? rankEmails([...foundEmails], baseHost) : [...foundEmails];

  return {
    website: base,
    emails: ranked,
    evidenceUrls,
    siteContext,
  };
}
