import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
// import { sendEmail } from "./mailer.js";
import { sendEmail } from "./mailer";

export type SendApplicationItem = {
  website?: string;
  to: string;
  subject: string;
  body: string;
};

export type SendApplicationsOptions = {
  dryRun?: boolean;
  delayMs?: number;
  cvFilename?: string;
  dedupe?: boolean;
};

export type SendApplicationResult = {
  website?: string;
  to: string;
  subject: string;
  ok: boolean;
  dryRun: boolean;
  dedupeSkipped?: boolean;
  messageId?: string;
  error?: string;
};

const DAILY_LIMIT = 50;  
const HOURLY_LIMIT = 10;

const DATA_DIR = path.resolve(process.cwd(), "data");
const SENT_FILE = path.join(DATA_DIR, "sent_applications.json");
const CV_DIR = path.join(DATA_DIR, "cv");

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizeEmail(s: string) {
  return s.trim().toLowerCase();
}

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadSentKeys(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(SENT_FILE, "utf8");
    const arr = JSON.parse(raw);
    return new Set(arr.map((x: any) => String(x?.key || "")).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function appendSentRecord(rec: any) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let arr: any[] = [];
  try {
    arr = JSON.parse(await fs.readFile(SENT_FILE, "utf8"));
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  arr.push(rec);
  await fs.writeFile(SENT_FILE, JSON.stringify(arr, null, 2), "utf8");
}

function filterHighRiskEmails(
  emails: string[],
  validation: Record<string, { risk?: string }>
): string[] {
  return emails.filter(e => validation[e]?.risk !== "high");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getCvAttachment(filename: string) {
  if (!filename) return undefined;

  const cvPath = path.join(CV_DIR, filename);
  try {
    await fs.access(cvPath);
    return {
      filename,
      path: cvPath,
    };
  } catch {
    throw new Error(`CV file not found: ${cvPath}`);
  }
}

export async function sendApplications(items: SendApplicationItem[], opts: SendApplicationsOptions = {}) {
  const dryRun = opts.dryRun ?? true;
  const delayMs = Math.max(0, Math.min(Number(opts.delayMs ?? 1500), 30000));
  const dedupe = opts.dedupe ?? true;
  const cvFilename = opts.cvFilename;

  const sentKeys = dedupe ? await loadSentKeys() : new Set<string>();
  const results: SendApplicationResult[] = [];



  // Validate CV exists before starting
  let cvAttachment: { filename: string; path: string } | undefined;
  if (cvFilename && !dryRun) {
    cvAttachment = await getCvAttachment(cvFilename);
  }
  if (cvFilename && !dryRun) {
    cvAttachment = await getCvAttachment(cvFilename);
    console.log("[sendApplications] CV attachment path:", cvAttachment?.path);
    console.log("[sendApplications] File exists:", cvAttachment?.path ? require('fs').existsSync(cvAttachment.path) : false);
  }
  for (const item of items) {
    const website = item.website?.trim() || undefined;
    const to = normalizeEmail(item.to || "");
    const subject = (item.subject || "").trim();
    const body = (item.body || "").trim();

    if (!to || !subject || !body) {
      results.push({
        website,
        to: item.to,
        subject: subject || "(missing)",
        ok: false,
        dryRun,
        error: "Missing to/subject/body",
      });
      continue;
    }

    if (!isValidEmail(to)) {
      results.push({
        website,
        to,
        subject,
        ok: false,
        dryRun,
        error: "Invalid email format",
      });
      continue;
    }

    const key = sha256(`${to}::${subject}`);

    if (dedupe && sentKeys.has(key)) {
      results.push({
        website,
        to,
        subject,
        ok: true,
        dryRun,
        dedupeSkipped: true,
      });
      continue;
    }

    if (dryRun) {
      results.push({
        website,
        to,
        subject,
        ok: true,
        dryRun: true,
      });
    } else {
      try {
        const html = `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(body)}</pre>`;

        const info = await sendEmail({
          to,
          subject,
          text: body,
          html,
          attachmentPath: cvAttachment?.path,  // ← Fixed: use validated path
        });


        results.push({
          website,
          to,
          subject,
          ok: true,
          dryRun: false,
          messageId: (info as any)?.messageId,
        });

        if (dedupe) {
          sentKeys.add(key);
          await appendSentRecord({
            key,
            website,
            to,
            subject,
            sentAt: new Date().toISOString(),
            messageId: (info as any)?.messageId,
          });
        }
      } catch (e: any) {
        results.push({
          website,
          to,
          subject,
          ok: false,
          dryRun: false,
          error: e?.message || String(e),
        });
      }
    }

    const randomDelay = delayMs + Math.random() * 2000; // 1200-3200ms
    if (delayMs > 0) await sleep(randomDelay);
  }

  const stats = {
    total: results.length,
    sent: results.filter((r) => r.ok && !r.dryRun && !r.dedupeSkipped).length,
    skippedDuplicates: results.filter((r) => r.dedupeSkipped).length,
    dryRunOk: results.filter((r) => r.ok && r.dryRun).length,
    failed: results.filter((r) => !r.ok).length,
  };

  if (stats.sent >= DAILY_LIMIT) {
    return { ok: false, error: "Daily limit reached", dryRun, stats, results };
  }

  return {
    ok: true,
    dryRun,
    stats: {
      total: results.length,
      sent: results.filter((r) => r.ok && !r.dryRun && !r.dedupeSkipped).length,
      skippedDuplicates: results.filter((r) => r.dedupeSkipped).length,
      dryRunOk: results.filter((r) => r.ok && r.dryRun).length,
      failed: results.filter((r) => !r.ok).length,
    },
    results,
  };
  
}