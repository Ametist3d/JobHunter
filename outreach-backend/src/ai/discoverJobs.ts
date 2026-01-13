import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ai } from "./gemini.js";
import { deepseekJson } from "./deepseek.js";
import { perplexitySearch } from "./perplexity.js";
import { extractJsonObject } from "./parseJson.js";
import { resolveCanonicalBaseUrl, extractHostnameCandidate } from "../crawl/urls.js";

export type SearchProvider = "gemini" | "deepseek" | "perplexity";

export type JobLead = {
  website: string;
  companyName?: string;
  jobTitle?: string;
  snippet?: string;
  source?: string;
  vacancyConfirmed?: boolean;
};

export type DiscoverJobsInput = {
  region: string;
  position: string;
  industry?: string;
  companySize: "small" | "medium" | "large";
  limit?: number;
  excludeDomains?: string[];
  provider?: SearchProvider;  // NEW
};

type DiscoverResult = {
  leads: JobLead[];
  model: string;
  promptSha256?: string;
  hasLiveSearch?: boolean;
  citations?: string[];
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

function uniqByDomain(leads: JobLead[]) {
  const seen = new Set<string>();
  const out: JobLead[] = [];
  for (const l of leads) {
    try {
      const host = new URL(l.website).hostname.toLowerCase();
      if (seen.has(host)) continue;
      seen.add(host);
      out.push(l);
    } catch {}
  }
  return out;
}

// Social media & generic blocked
const BLOCKED_HOST_SUBSTRINGS = [
  "facebook.com", "instagram.com", "twitter.com", "x.com",
  "youtube.com", "tiktok.com", "wikipedia.org", "pinterest.com",
  "reddit.com", "quora.com",
];

// Job aggregators - we want DIRECT company sites, not these
const JOB_AGGREGATORS = [
  // International
  "indeed.com", "indeed.de", "indeed.co.uk",
  "glassdoor.com", "glassdoor.de",
  "linkedin.com", "linkedin.de",
  "monster.com", "monster.de",
  "ziprecruiter.com",
  "simplyhired.com",
  "careerbuilder.com",
  "jooble.org",
  
  // German
  "stepstone.de", "stepstone.at", "stepstone.ch",
  "xing.com",
  "arbeitsagentur.de",
  "jobware.de",
  "stellenanzeigen.de",
  "jobs.de",
  "meinestadt.de",
  "kimeta.de",
  "jobvector.de",
  "absolventa.de",
  "karriere.de",
  "metajob.de",
  "gigajob.de",
  
  // Creative/Design specific aggregators
  "dasauge.de",
  "creativejobs.de",
  "designjobs.de",
  "medienjobs.de",
  "jobverde.de",
  
  // Freelance platforms (not job search)
  "upwork.com",
  "fiverr.com",
  "freelancer.com",
  "99designs.com",
  "toptal.com",
  
  // Other aggregators
  "gehalt.de",
  "kununu.com",
  "companize.com",
  "jobted.com",
  "talent.com",
  "adzuna.de",
  "neuvoo.de",
  "jobrapido.com",
  "jobleads.de",
  "englishjobs.de",
  "ingamejob.com", 
  "himalayas.app",
];

function isBlockedHost(host: string) {
  return BLOCKED_HOST_SUBSTRINGS.some((b) => host.includes(b));
}

function isJobAggregator(host: string) {
  const h = host.toLowerCase();
  return JOB_AGGREGATORS.some((agg) => h.includes(agg) || h === agg);
}

function normalizeDomain(host: string) {
  let h = (host || "").trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  return h.replace(/\.$/, "");
}

function isExcludedHost(host: string, excludeSet: Set<string>) {
  if (!excludeSet || excludeSet.size === 0) return false;
  return excludeSet.has(normalizeDomain(host));
}

async function canonicalizeLeadWebsites(
  leads: JobLead[],
  opts: { timeoutMs?: number; concurrency?: number },
  excludeSet: Set<string>
) {
  console.log(`[Canonicalize] Processing ${leads.length} leads...`);
  
  const timeoutMs = Math.max(1500, Math.min(opts.timeoutMs ?? 5000, 15000));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 10, 25));
  const out: JobLead[] = new Array(leads.length);
  let idx = 0;
  let resolved = 0;
  let blocked = 0;
  let aggregators = 0;
  let failed = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= leads.length) break;
      const l = leads[i];

      const result = await resolveCanonicalBaseUrl(l.website, { timeoutMs });
      const website = result ?? l.website;

      let host = "";
      try {
        host = new URL(website).hostname.toLowerCase();
      } catch {
        host = extractHostnameCandidate(website);
      }

      if (!host) {
        failed++;
        console.log(`[Canonicalize] ✗ Failed to resolve: ${l.website}`);
        out[i] = { ...l, website: "" };
      } else if (isBlockedHost(host)) {
        blocked++;
        console.log(`[Canonicalize] ✗ Blocked (social): ${host}`);
        out[i] = { ...l, website: "" };
      } else if (isJobAggregator(host)) {
        aggregators++;
        console.log(`[Canonicalize] ✗ Job aggregator: ${host}`);
        out[i] = { ...l, website: "" };
      } else if (isExcludedHost(host, excludeSet)) {
        blocked++;
        console.log(`[Canonicalize] ✗ Already applied: ${host}`);
        out[i] = { ...l, website: "" };
      } else {
        resolved++;
        console.log(`[Canonicalize] ✓ Accepted: ${host}`);
        out[i] = { ...l, website };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  
  console.log(`[Canonicalize] Results: accepted=${resolved}, aggregators=${aggregators}, blocked=${blocked}, failed=${failed}`);
  return out.filter((l) => !!l.website);
}

function websiteFromGroundingTitle(title: unknown, excludeSet: Set<string>): string | null {
  if (typeof title !== "string") return null;
  const t = title.trim();
  if (!t) return null;

  const candidate = t.startsWith("http://") || t.startsWith("https://") ? t : `https://${t}`;
  const origin = normalizeToOrigin(candidate);
  if (!origin) return null;

  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (isBlockedHost(host) || isExcludedHost(host, excludeSet) || isJobAggregator(host)) return null;
  } catch {
    return null;
  }

  return origin;
}

function extractLeadsFromGrounding(res: any, limit: number, excludeSet: Set<string>): JobLead[] {
  const out: JobLead[] = [];
  const candidates: any[] = Array.isArray(res?.candidates) ? res.candidates : [];
  const cand0 = candidates[0];
  const gm = cand0?.groundingMetadata ?? cand0?.grounding_metadata;
  const chunks: any[] = Array.isArray(gm?.groundingChunks) ? gm.groundingChunks : [];

  console.log(`[Grounding] Found ${chunks.length} chunks from Google Search`);

  for (const ch of chunks) {
    const web = ch?.web;
    const rawTitle = web?.title;
    const snippet = web?.snippet || "";
    
    console.log(`[Grounding] Checking: "${rawTitle}"`);
    
    const website = websiteFromGroundingTitle(rawTitle, excludeSet);
    if (!website) {
      console.log(`[Grounding]   -> Skipped`);
      continue;
    }

    console.log(`[Grounding]   -> Accepted: ${website}`);
    
    out.push({
      website,
      companyName: typeof rawTitle === "string" ? rawTitle : undefined,
      snippet: typeof snippet === "string" ? snippet : undefined,
      source: "google_search_grounding",
    });

    if (out.length >= limit) break;
  }

  return uniqByDomain(out).slice(0, limit);
}

function extractLeadsFromModelJson(rawText: string, limit: number, excludeSet: Set<string>): JobLead[] {
  console.log(`[Fallback] Parsing model JSON...`);
  const cleaned: JobLead[] = [];

  try {
    const jsonStr = extractJsonObject(rawText);
    const parsed = JSON.parse(jsonStr);
    const leadsRaw: any[] = Array.isArray(parsed.leads) ? parsed.leads : [];
    
    console.log(`[Fallback] Found ${leadsRaw.length} leads in JSON`);

    for (const item of leadsRaw) {
      const origin = normalizeToOrigin(String(item?.website ?? ""));
      if (!origin) continue;

      let host = "";
      try {
        host = new URL(origin).hostname.toLowerCase();
      } catch {
        continue;
      }

      if (isBlockedHost(host) || isExcludedHost(host, excludeSet) || isJobAggregator(host)) {
        console.log(`[Fallback] Skipped: ${host}`);
        continue;
      }

      // Check if vacancy was confirmed
      const vacancyConfirmed = Boolean(item?.vacancyConfirmed || item?.hasOpenPosition);

      console.log(`[Fallback] Accepted: ${origin} (vacancy: ${vacancyConfirmed ? "YES" : "unconfirmed"})`);
      cleaned.push({
        website: origin,
        companyName: typeof item?.companyName === "string" ? item.companyName.trim() : undefined,
        jobTitle: typeof item?.jobTitle === "string" ? item.jobTitle.trim() : undefined,
        snippet: typeof item?.snippet === "string" ? item.snippet.trim() : undefined,
        vacancyConfirmed,
        source: "model_json_fallback",
      });
    }
  } catch (e: any) {
    console.log(`[Fallback] JSON parse failed: ${e.message}`);
  }

  return uniqByDomain(cleaned).slice(0, limit);
}


function buildJobSearchPrompt(input: DiscoverJobsInput, excludeSet: Set<string>): string {
  const { position, region, industry, limit } = input;
  
  const excludeBlock = excludeSet.size > 0
    ? `\nALREADY APPLIED (exclude): ${Array.from(excludeSet).slice(0, 30).join(", ")}\n`
    : "";

  return `
You are a job search assistant. Find companies with OPEN POSITIONS for: "${position}" in ${region}.
${industry ? `Industry focus: ${industry}` : ""}

REQUIREMENTS:
1. Return DIRECT COMPANY WEBSITES only (not job boards)
2. Focus on companies likely to have "${position}" or similar roles
3. Return up to ${limit || 50} results

DO NOT INCLUDE:
- Job aggregators: Indeed, Glassdoor, LinkedIn Jobs, StepStone, Monster, Xing, dasauge, metajob
- Freelance platforms: Upwork, Fiverr
- Social media profiles

${excludeBlock}

Return JSON:
{
  "leads": [
    {
      "website": "https://company.com",
      "companyName": "Company Name",
      "jobTitle": "Expected position title",
      "snippet": "Why this company might hire ${position}",
      "vacancyConfirmed": false
    }
  ]
}

For well-known companies in ${region} that typically hire ${position} roles:
- Game studios, agencies, architecture firms, product companies, etc.
- Include both large and ${input.companySize} companies

Return ONLY valid JSON.
`.trim();
}

export async function discoverWithGemini(
  input: DiscoverJobsInput, 
  excludeSet: Set<string>
): Promise<DiscoverResult> {
  const model = process.env.GEMINI_SEARCH_MODEL || "gemini-2.5-flash";
  const limit = input.limit || 50;
  
  const prompt = `
You are a job search assistant. Find companies with CONFIRMED OPEN POSITIONS for: "${input.position}" in ${input.region}.
${input.industry ? `Industry: ${input.industry}` : ""}

CRITICAL: Use Google Search to find ACTUAL job postings.

Search queries to use:
1. "${input.position} job opening ${input.region} careers"
2. "hiring ${input.position} ${input.region} apply"
3. "${input.position} stelle ${input.region} karriere"

REQUIREMENTS:
- ONLY direct company websites (not Indeed, StepStone, LinkedIn, etc.)
- MUST have evidence of actual vacancy from search results
- Return up to ${limit} results

${excludeSet.size > 0 ? `EXCLUDE: ${Array.from(excludeSet).slice(0, 30).join(", ")}` : ""}

Return JSON:
{
  "leads": [
    {
      "website": "https://company.com",
      "companyName": "Company Name", 
      "jobTitle": "Exact job title from search",
      "snippet": "Evidence of vacancy",
      "vacancyConfirmed": true
    }
  ]
}
`.trim();

  const promptSha = sha256(prompt);
  console.log(`[Gemini] Calling with Google Search grounding...`);
  const startTime = Date.now();

  const res = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
    },
  });

  console.log(`[Gemini] Responded in ${Date.now() - startTime}ms`);

  // Try JSON first, then grounding
  let leads = extractLeadsFromModelJson(res.text ?? "", limit, excludeSet);
  if (leads.length === 0) {
    leads = extractLeadsFromGrounding(res, limit, excludeSet);
  }

  return { leads, model, promptSha256: promptSha, hasLiveSearch: true };
}

// DeepSeek WITH web search
export async function discoverWithDeepSeek(
  input: DiscoverJobsInput, 
  excludeSet: Set<string>
): Promise<DiscoverResult> {
  const { position, region, industry, limit } = input;
  
  const excludeBlock = excludeSet.size > 0
    ? `\nALREADY APPLIED (exclude): ${Array.from(excludeSet).slice(0, 30).join(", ")}`
    : "";

  // Different prompt - ask for known companies, not live search
  const prompt = `
List companies that commonly hire "${position}" in ${region}.
${industry ? `Focus on: ${industry}` : ""}

Based on your knowledge, suggest companies that:
1. Are known to hire ${position} roles
2. Have offices or operations in ${region}
3. Are direct employers (not recruitment agencies or job boards)

DO NOT include:
- Job aggregators (Indeed, StepStone, LinkedIn, Glassdoor, Monster)
- Recruitment agencies
- Freelance platforms

${excludeBlock}

Return up to ${limit || 50} companies as JSON:
{
  "leads": [
    {
      "website": "https://company.com",
      "companyName": "Company Name",
      "jobTitle": "${position} or similar",
      "snippet": "Why this company might hire this role",
      "vacancyConfirmed": false
    }
  ]
}

Note: Set vacancyConfirmed to false since these are suggestions, not confirmed openings.
`.trim();

  console.log(`[DeepSeek] Getting company suggestions (training data only)...`);
  
  const result = await deepseekJson<{ leads: any[] }>({
    prompt,
    temperature: 0.3,
    maxTokens: 4000,
  });

  const leads: JobLead[] = (result.json.leads || [])
    .map((item: any) => ({
      website: String(item?.website || "").trim(),
      companyName: item?.companyName,
      jobTitle: item?.jobTitle,
      snippet: item?.snippet,
      vacancyConfirmed: false,  // Can't confirm without live search
      source: "deepseek",
    }))
    .filter((l: JobLead) => l.website);

  return { 
    leads, 
    model: result.model, 
    promptSha256: result.promptSha256, 
    hasLiveSearch: false,  // Important: no live search
  };
}

// Perplexity with built-in web search
export async function discoverWithPerplexity(
  input: DiscoverJobsInput, 
  excludeSet: Set<string>
): Promise<DiscoverResult> {
  const { position, region, industry, limit } = input;
  
  const excludeBlock = excludeSet.size > 0
    ? `\nALREADY APPLIED (exclude): ${Array.from(excludeSet).slice(0, 30).join(", ")}`
    : "";

  const prompt = `
Search for companies currently hiring "${position}" in ${region}.
${industry ? `Industry focus: ${industry}` : ""}

Find ACTUAL job postings. For each company you find, extract:
- The company's main website (not the job board URL)
- Company name
- Exact job title

DO NOT include job aggregators (Indeed, StepStone, LinkedIn, Glassdoor, Monster, Xing).

${excludeBlock}

Return as JSON:
{
  "leads": [
    {
      "website": "https://company.com",
      "companyName": "Company Name",
      "jobTitle": "Job title found",
      "snippet": "Brief description"
    }
  ]
}
`.trim();

  console.log(`[Perplexity] Searching for ${position} jobs in ${region}...`);
  
  const result = await perplexitySearch<{ leads: any[] }>({
    prompt,
    temperature: 0.2,
    maxTokens: 4000,
  });

  // 1. Get leads from JSON response
  const jsonLeads: JobLead[] = (result.json.leads || [])
    .map((item: any) => ({
      website: String(item?.website || "").trim(),
      companyName: item?.companyName,
      jobTitle: item?.jobTitle,
      snippet: item?.snippet,
      vacancyConfirmed: true,
      source: "perplexity_json",
    }))
    .filter((l: JobLead) => l.website);

  console.log(`[Perplexity] JSON leads: ${jsonLeads.length}`);

  // 2. Extract additional leads from citations
  const citationLeads = extractLeadsFromCitations(result.citations, excludeSet);
  console.log(`[Perplexity] Citation leads: ${citationLeads.length}`);

  // 3. Merge and dedupe
  const allLeads = [...jsonLeads, ...citationLeads];
  const seen = new Set<string>();
  const uniqueLeads: JobLead[] = [];
  
  for (const lead of allLeads) {
    const domain = normalizeDomain(extractHostnameCandidate(lead.website));
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    uniqueLeads.push(lead);
  }

  console.log(`[Perplexity] Total unique leads: ${uniqueLeads.length}`);

  return { 
    leads: uniqueLeads.slice(0, limit || 50), 
    model: result.model, 
    promptSha256: result.promptSha256, 
    hasLiveSearch: true,
    citations: result.citations,
  };
}

// Extract company websites from Perplexity citations
function extractLeadsFromCitations(citations: string[], excludeSet: Set<string>): JobLead[] {
  const leads: JobLead[] = [];
  
  for (const url of citations) {
    if (!url) continue;
    
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    
    // Skip aggregators
    if (isJobAggregator(host) || isBlockedHost(host)) {
      console.log(`[Citations] Skip aggregator: ${host}`);
      continue;
    }
    
    // Skip already applied
    const domain = normalizeDomain(host);
    if (excludeSet.has(domain)) {
      console.log(`[Citations] Skip already applied: ${domain}`);
      continue;
    }
    
    // Extract company name from domain
    const companyName = domain
      .replace(/\.(com|de|io|co|net|org|eu|app)$/i, "")
      .split(".").pop()
      ?.replace(/-/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase()) || domain;
    
    console.log(`[Citations] Found company: ${companyName} (${host})`);
    
    leads.push({
      website: `https://${host}`,
      companyName,
      snippet: `Found via citation: ${url}`,
      vacancyConfirmed: true,  // It was in job search results
      source: "perplexity_citation",
    });
  }
  
  return leads;
}

export async function discoverJobs(input: DiscoverJobsInput) {
  const provider = input.provider || "gemini";
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[DiscoverJobs] START`);
  console.log(`[DiscoverJobs] Provider: ${provider.toUpperCase()}`);
  console.log(`[DiscoverJobs] Position: "${input.position}"`);
  console.log(`[DiscoverJobs] Region: "${input.region}"`);
  console.log(`[DiscoverJobs] Industry: "${input.industry || "(any)"}"`);
  console.log(`[DiscoverJobs] Limit: ${input.limit}`);
  console.log(`${"=".repeat(60)}\n`);

  const limit = Math.max(10, Math.min(input.limit ?? 50, 200));

  const excludeSet = new Set<string>(
    (input.excludeDomains ?? []).map((d) => normalizeDomain(d)).filter(Boolean).slice(0, 200)
  );

  // Call appropriate provider
  let result: DiscoverResult;

  switch (provider) {
    case "deepseek":
      result = await discoverWithDeepSeek({ ...input, limit }, excludeSet);
      break;
    case "perplexity":
      result = await discoverWithPerplexity({ ...input, limit }, excludeSet);
      break;
    case "gemini":
    default:
      result = await discoverWithGemini({ ...input, limit }, excludeSet);
      break;
  }

  // Canonicalize and dedupe
  let leads = result.leads;
  if (leads.length > 0) {
    console.log(`\n[DiscoverJobs] Canonicalizing ${leads.length} leads...`);
    leads = await canonicalizeLeadWebsites(leads, { timeoutMs: 5000, concurrency: 10 }, excludeSet);
    leads = uniqByDomain(leads).slice(0, limit);
  }

  const confirmed = leads.filter(l => l.vacancyConfirmed).length;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[DiscoverJobs] COMPLETE`);
  console.log(`[DiscoverJobs] Provider: ${provider}`);
  console.log(`[DiscoverJobs] Live search: ${result.hasLiveSearch ? "YES" : "NO"}`);
  console.log(`[DiscoverJobs] Results: ${leads.length}, Confirmed: ${confirmed}`);
  leads.slice(0, 10).forEach((l, i) => {
    const status = l.vacancyConfirmed ? "✓" : "?";
    console.log(`  ${i + 1}. [${status}] ${l.companyName || l.website}`);
    if (l.jobTitle) console.log(`      Job: ${l.jobTitle}`);
  });
  console.log(`${"=".repeat(60)}\n`);

  return {
    ok: true,
    provider,
    model: result.model,
    promptSha256: result.promptSha256,
    hasLiveSearch: result.hasLiveSearch,
    leads,
    stats: {
      total: leads.length,
      vacancyConfirmed: confirmed,
      uniqueDomains: leads.length,
      excludedInPrompt: excludeSet.size,
    },
  };
}