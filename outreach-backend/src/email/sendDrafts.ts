import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { sendEmail } from "./mailer.js";

export type SendDraftItem = {
  website?: string;
  to: string;
  subject: string;
  body: string; // plain text
};

export type SendDraftsOptions = {
  dryRun?: boolean;      // default true (safe)
  delayMs?: number;      // default 1200
  addFooter?: boolean;   // default true
  dedupe?: boolean;      // default true
};

export type SendDraftResultItem = {
  website?: string;
  to: string;
  subject: string;
  ok: boolean;
  dryRun: boolean;
  dedupeSkipped?: boolean;
  messageId?: string;
  error?: string;
};

const SENT_FILE = path.join(process.cwd(), "data", "sent.json");

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
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [];
    return new Set(arr.map((x: any) => String(x?.key || "")).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function appendSentRecord(rec: any) {
  await fs.mkdir(path.dirname(SENT_FILE), { recursive: true });
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

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function footer() {
  // simple + safe. You can customize later.
  return (
    "\n\n—\n" +
    "If you’d prefer not to receive further emails, just reply with “unsubscribe” and I won’t contact you again."
  );
}

export async function sendDrafts(items: SendDraftItem[], opts: SendDraftsOptions = {}) {
  const dryRun = opts.dryRun ?? true;
  const delayMs = Math.max(0, Math.min(Number(opts.delayMs ?? 1200), 30000));
  const addFooter = opts.addFooter ?? true;
  const dedupe = opts.dedupe ?? true;

  const sentKeys = dedupe ? await loadSentKeys() : new Set<string>();
  const results: SendDraftResultItem[] = [];

  for (const item of items) {
    const website = item.website?.trim() || undefined;
    const to = normalizeEmail(item.to || "");
    const subject = (item.subject || "").trim();
    const body = (item.body || "").trim();

    if (!to || !subject || !body) {
      results.push({ website, to: item.to, subject: subject || "(missing subject)", ok: false, dryRun, error: "Missing to/subject/body" });
      continue;
    }

    if (!isValidEmail(to)) {
      results.push({ website, to, subject, ok: false, dryRun, error: "Invalid email format" });
      continue;
    }

    const key = sha256(`${to}::${subject}`);

    if (dedupe && sentKeys.has(key)) {
      results.push({ website, to, subject, ok: true, dryRun, dedupeSkipped: true });
      continue;
    }

    const finalText = addFooter ? body + footer() : body;
    const html = `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(finalText)}</pre>`;

    if (dryRun) {
      results.push({ website, to, subject, ok: true, dryRun: true, messageId: "dry-run" });
    } else {
      try {
        const info = await sendEmail({
          to,
          subject,
          html,
          text: finalText,
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
