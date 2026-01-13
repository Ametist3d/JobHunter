import fs from "node:fs/promises";
import path from "node:path";

type SentDbEntry = {
  domain?: string;
  website?: string;
  firstSentAt: string;
  lastSentAt: string;
  sentCount?: number;
  count?: number; // legacy field
};

type SentDb = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  sentByRegion: Record<string, Record<string, SentDbEntry>>;
};

type SentLogRow = {
  ts: string;
  region: string;
  website: string;
  domain: string;
  to?: string;
  messageId?: string;
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const SENT_DB_PATH = path.join(DATA_DIR, "sent_db.json");
const SENT_LOG_PATH = path.join(DATA_DIR, "sent.json");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

export function normalizeRegionKey(region: string) {
  return String(region || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeDomain(host: string) {
  let h = String(host || "").trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  h = h.replace(/\.$/, "");
  return h;
}

export function originFromWebsite(website: string) {
  try {
    const u = new URL(String(website).trim());
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function domainFromWebsite(website: string) {
  try {
    const u = new URL(String(website).trim());
    return normalizeDomain(u.hostname);
  } catch {
    return "";
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const s = await fs.readFile(filePath, "utf8");
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath: string, obj: any) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

async function loadSentDb(): Promise<SentDb> {
  await ensureDataDir();
  const existing = await readJsonSafe<SentDb>(SENT_DB_PATH);
  if (existing && existing.version === 1 && existing.sentByRegion) return existing;

  const fresh: SentDb = {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sentByRegion: {},
  };
  await writeJsonAtomic(SENT_DB_PATH, fresh);
  return fresh;
}

async function appendSentLog(row: SentLogRow) {
  await ensureDataDir();

  const existing = await readJsonSafe<SentLogRow[]>(SENT_LOG_PATH);
  const arr = Array.isArray(existing) ? existing : [];
  arr.push(row);

  // keep it reasonably bounded (optional)
  if (arr.length > 20000) arr.splice(0, arr.length - 20000);

  await writeJsonAtomic(SENT_LOG_PATH, arr);
}


/**
 * Record a successfully sent website for a region.
 * This is the ONLY persistent DB state needed for exclusion later.
 */
export async function recordSentWebsite(params: {
  region: string;
  website: string;
  to?: string;
  messageId?: string;
}) {
  const regionKey = normalizeRegionKey(params.region);
  const origin = originFromWebsite(params.website);
  if (!regionKey) return { ok: false as const, error: "region is empty" };
  if (!origin) return { ok: false as const, error: "invalid website origin" };

  const domain = domainFromWebsite(origin);
  if (!domain) return { ok: false as const, error: "invalid domain" };

  const db = await loadSentDb();
  const ts = nowIso();

  db.sentByRegion[regionKey] ||= {};
  const slot = db.sentByRegion[regionKey][domain];

  if (!slot) {
    // New entry - use consistent structure
    db.sentByRegion[regionKey][domain] = {
      domain,
      website: origin,
      firstSentAt: ts,
      lastSentAt: ts,
      sentCount: 1,
    };
  } else {
    // Update existing
    slot.lastSentAt = ts;
    slot.sentCount = (slot.sentCount ?? slot.count ?? 0) + 1;
    
    // Ensure fields exist (fix legacy entries)
    if (!slot.domain) slot.domain = domain;
    if (!slot.website) slot.website = origin;
    
    // Remove legacy field
    delete slot.count;
  }

  db.updatedAt = ts;
  await writeJsonAtomic(SENT_DB_PATH, db);

  await appendSentLog({
    ts,
    region: regionKey,
    website: origin,
    domain,
    to: params.to,
    messageId: params.messageId,
  });

  return { ok: true as const, region: regionKey, website: origin, domain };
}

export async function getSentDomainsByRegion(params: { region: string; limit?: number }) {
  const regionKey = normalizeRegionKey(params.region);
  const limit = Math.max(0, Math.min(params.limit ?? 1000, 10000));

  const db = await loadSentDb();
  const map = db.sentByRegion[regionKey] || {};
  const domains = Object.keys(map);

  // sort by lastSentAt desc
  domains.sort((a, b) => {
    const aa = map[a]?.lastSentAt || "";
    const bb = map[b]?.lastSentAt || "";
    return aa < bb ? 1 : aa > bb ? -1 : 0;
  });

  return {
    ok: true as const,
    region: regionKey,
    total: domains.length,
    domains: domains.slice(0, limit),
  };
}

export async function getSentWebsitesByRegion(params: { region: string; limit?: number }) {
  const r = await getSentDomainsByRegion(params);
  // map domains to origins (best-effort)
  return {
    ok: true as const,
    region: r.region,
    total: r.total,
    websites: r.domains.map((d) => `https://${d}`),
  };
}

export async function dbStats() {
  const db = await loadSentDb();
  const regions = Object.keys(db.sentByRegion);
  let domainsCount = 0;
  for (const r of regions) domainsCount += Object.keys(db.sentByRegion[r] || {}).length;

  const log = await readJsonSafe<SentLogRow[]>(SENT_LOG_PATH);
  const sendsCount = Array.isArray(log) ? log.length : 0;

  return {
    ok: true as const,
    sentDb: {
      path: SENT_DB_PATH,
      version: db.version,
      createdAt: db.createdAt,
      updatedAt: db.updatedAt,
      regionsCount: regions.length,
      domainsCount,
    },
    sentLog: {
      path: SENT_LOG_PATH,
      sends: sendsCount,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Backward-compat exports (so older server.ts does not crash)         */
/* These do NOT create leads_db.json. We keep minimal DB only.         */
/* ------------------------------------------------------------------ */

export async function getKnownDomains(filter?: { region?: string; marketDomain?: string; limit?: number }) {
  const region = filter?.region || "";
  const limit = filter?.limit ?? 1000;
  const r = await getSentDomainsByRegion({ region, limit });
  return { ok: true as const, total: r.total, domains: r.domains };
}

export async function markSend(params: { region: string; website: string; to?: string; messageId?: string }) {
  return recordSentWebsite(params);
}

// no-op stubs (old wide DB methods). Keep them so imports don’t break.
export async function upsertLead(_: any) {
  return { ok: true as const };
}
export async function addContacts(_: any) {
  return { ok: true as const };
}
export async function saveContext(_: any) {
  return { ok: true as const };
}
