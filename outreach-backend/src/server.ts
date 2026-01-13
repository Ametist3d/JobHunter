import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fs from "node:fs/promises";
import path from "node:path";
import "@fastify/multipart";
import multipart, { type MultipartFile } from "@fastify/multipart";
import { validateEmail, validateEmails } from "./email/validateEmail.js";


import { discoverJobs, 
  discoverWithGemini,
  discoverWithDeepSeek, 
  discoverWithPerplexity,
 } from "./ai/discoverJobs.js";

import { prefilterLeads } from "./ai/prefilterLeads.js";
import { draftApplicationEmail } from "./ai/personalizeApplication.js";
import { crawlForEmails } from "./crawl/crawlSite.js";
import { sendApplications } from "./email/sendApplications.js";
import { getSentDomainsByRegion, recordSentWebsite, dbStats } from "./db/db.js";

import { 
  loadSchedules as loadJobSchedules, 
  upsertSchedule as upsertJobSchedule, 
  deleteSchedule as deleteJobSchedule,
  getSchedulesDue as getJobSchedulesDue,
} from "./db/jobSchedules.js";
import { runScheduledJob } from "./scheduler/jobRunner.js";


type CompanySize = "small" | "medium" | "large";

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

type JobLead = {
  website: string;
  companyName?: string;
  jobTitle?: string;
  snippet?: string;
  source?: string;
  vacancyConfirmed?: boolean;
};

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function str(v: any) {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

async function main() {
  const app = Fastify({ logger: true });
  const PORT = clampInt(process.env.PORT, 1, 65535, 8787);

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 60,
    timeWindow: 60000,
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/api/db/stats", async () => dbStats());

  // Upload CV endpoint
  app.post("/api/upload-cv", async (req, reply) => {
    try {
      const data = await (req as any).file();
      if (!data) {
        return reply.code(400).send({ ok: false, error: "No file uploaded" });
      }

      const filename = data.filename;
      if (!filename.endsWith(".pdf")) {
        return reply.code(400).send({ ok: false, error: "Only PDF files allowed" });
      }

      const cvDir = path.resolve(process.cwd(), "data", "cv");
      await fs.mkdir(cvDir, { recursive: true });

      const buffer = await data.toBuffer();
      const filepath = path.join(cvDir, filename);
      await fs.writeFile(filepath, buffer);

      return reply.send({ ok: true, filename, path: filepath });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });
  
  // STEP 1: Discover job opportunities
  app.post("/api/discover-jobs", async (req, reply) => {
    const body = req.body as any;
    const region = str(body.region).trim();
    const position = str(body.position).trim();
    const industry = str(body.industry).trim() || undefined;
    const companySize = str(body.companySize || "small") as CompanySize;
    const limit = clampInt(body.limit, 10, 100, 30);
    const providers: string[] = Array.isArray(body.providers) ? body.providers : ["gemini"];

    if (!region || !position) {
      return reply.code(400).send({ ok: false, error: "region and position required" });
    }

    // Get exclude list
    const known = await getSentDomainsByRegion({ region, limit: 800 });
    const excludeDomains = known.domains;

    // Create excludeSet
    const excludeSet = new Set(excludeDomains.map(d => d.toLowerCase()));

    const input = { region, position, industry, companySize, limit, excludeDomains };

    // Run selected providers in parallel
    const providerFns: Record<string, () => Promise<any>> = {
      gemini: () => discoverWithGemini(input, excludeSet),
      deepseek: () => discoverWithDeepSeek(input, excludeSet),
      perplexity: () => discoverWithPerplexity(input, excludeSet),
    };


    const selectedProviders = providers.filter(p => providerFns[p]);
    
    req.log.info(`[Discover] Running ${selectedProviders.length} providers: ${selectedProviders.join(", ")}`);

    const results = await Promise.allSettled(
      selectedProviders.map(p => providerFns[p]())
    );

    // Merge results
    const allLeads: JobLead[] = [];
    const byProvider: Record<string, { count: number; model: string }> = {};

    results.forEach((result, idx) => {
      const provider = selectedProviders[idx];
      if (result.status === "fulfilled" && result.value?.leads) {
        const leads = result.value.leads;
        allLeads.push(...leads);
        byProvider[provider] = { 
          count: leads.length, 
          model: result.value.model || provider 
        };
        req.log.info(`[${provider}] Found ${leads.length} leads`);
      } else {
        req.log.error(`[${provider}] Failed:`, result.status === "rejected" ? result.reason : "No leads");
        byProvider[provider] = { count: 0, model: "error" };
      }
    });

    // Dedupe by domain
    const seen = new Set<string>();
    const uniqueLeads = allLeads.filter(l => {
      const domain = safeHostname(l.website);
      if (!domain || seen.has(domain)) return false;
      seen.add(domain);
      return true;
    }).slice(0, limit);

    return reply.send({
      ok: true,
      leads: uniqueLeads,
      byProvider,
      stats: {
        total: allLeads.length,
        unique: uniqueLeads.length,
        duplicatesRemoved: allLeads.length - uniqueLeads.length,
      },
    });
  });

  // STEP 1.5: Prefilter leads to valid companies with open jobs
  app.post("/api/prefilter", async (req, reply) => {
    const body = req.body as any;
    const websites: string[] = Array.isArray(body.websites) ? body.websites : [];
    const position = str(body.position).trim();

    if (!websites.length) {
      return reply.code(400).send({ ok: false, error: "websites[] required" });
    }

    try {
      const result = await prefilterLeads(websites, position);
      return reply.send(result);
    } catch (e: any) {
      req.log.error("[Prefilter] Error:", e.message);
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // STEP 2: Analyze sites for HR emails
  app.post("/api/analyze", async (req, reply) => {
  try {
    const body = (req.body ?? {}) as any;
    const leads = Array.isArray(body?.leads) ? body.leads : [];
    const targetPosition = str(body?.position).trim() || "";
    
    if (!leads.length) return reply.code(400).send({ ok: false, error: "leads[] required" });

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Analyze] START - ${leads.length} leads`);
    console.log(`[Analyze] Target position: "${targetPosition}"`);
    console.log(`${"=".repeat(60)}\n`);

    const maxSites = clampInt(body.maxSites ?? leads.length, 1, 200, leads.length);
    const timeoutMs = clampInt(body.timeoutMs, 3000, 60000, 15000);
    const maxPages = clampInt(body.maxPages, 1, 25, 10);

    const sliced = leads.slice(0, maxSites);
    const results: any[] = [];

    for (let i = 0; i < sliced.length; i++) {
      const l = sliced[i];
      const website = str(l?.website).trim();
      if (!website) continue;

      console.log(`\n[Analyze] ${i + 1}/${sliced.length}: ${website}`);

      try {
        const r = await crawlForEmails(website, {
          timeoutMs,
          delayBetweenPagesMs: 250,
          maxPages,
        });

        console.log(`[Analyze]   Emails found: ${r.emails.length}`);
        if (r.emails.length > 0) {
          console.log(`[Analyze]   -> ${r.emails.slice(0, 3).join(", ")}`);
        }
        
        // Detect job postings if we have HTML context
        let jobInfo = { hasJobPage: false, hasMatchingJob: false, jobTitles: [] as string[], evidence: [] as string[] };
        if (r.siteContext?.textSnippet && targetPosition) {
          // Simple check on the text snippet we already have
          const text = r.siteContext.textSnippet.toLowerCase();
          const targetWords = targetPosition.toLowerCase().split(/\s+/);
          jobInfo.hasMatchingJob = targetWords.some(w => w.length > 3 && text.includes(w));
          jobInfo.hasJobPage = JOB_KEYWORDS.some(kw => text.includes(kw));
          
          if (jobInfo.hasMatchingJob) {
            console.log(`[Analyze]   ✓ Position "${targetPosition}" likely mentioned`);
          }
          if (jobInfo.hasJobPage) {
            console.log(`[Analyze]   ✓ Appears to be careers/jobs page`);
          }
        }

        results.push({
          ok: true,
          website: r.website,
          companyName: l.companyName,
          jobTitle: l.jobTitle,
          emails: r.emails,
          evidenceUrls: r.evidenceUrls,
          siteContext: r.siteContext,
          jobDetection: jobInfo,
        });
      } catch (err: any) {
        console.log(`[Analyze]   ERROR: ${err.message}`);
        results.push({
          website,
          ok: false,
          error: err?.message || String(err),
        });
      }
    }

    const withEmail = results.filter((r) => r.emails?.length > 0).length;
    const withJob = results.filter((r) => r.jobDetection?.hasMatchingJob).length;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Analyze] COMPLETE`);
    console.log(`[Analyze] Total: ${results.length}`);
    console.log(`[Analyze] With email: ${withEmail}`);
    console.log(`[Analyze] With matching job: ${withJob}`);
    console.log(`${"=".repeat(60)}\n`);

    return reply.send({
      ok: true,
      results,
      stats: {
        total: results.length,
        withEmail,
        withoutEmail: results.length - withEmail,
        withMatchingJob: withJob,
        failures: results.filter((r) => !r.ok).length,
      },
    });
  } catch (e: any) {
    req.log.error(e);
    return reply.code(500).send({ ok: false, error: e?.message || String(e) });
  }
});

const JOB_KEYWORDS = [
  "career", "careers", "jobs", "hiring", "vacancy", "vacancies",
  "open position", "job opening", "work with us", "join us",
  "karriere", "stellenangebot", "offene stellen", "bewerbung",
];

  // STEP 3: Generate application emails
  app.post("/api/generate-applications", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const applicant = body?.applicant ?? {};
      const targets = Array.isArray(body?.targets) ? body.targets : [];
      const position = str(body?.position).trim();

      if (!applicant.fullName?.trim()) {
        return reply.code(400).send({ ok: false, error: "applicant.fullName required" });
      }
      if (!applicant.coverLetterBase?.trim()) {
        return reply.code(400).send({ ok: false, error: "applicant.coverLetterBase required" });
      }
      if (!position) {
        return reply.code(400).send({ ok: false, error: "position required" });
      }
      if (!targets.length) {
        return reply.code(400).send({ ok: false, error: "targets[] required" });
      }

      const results: any[] = [];

      for (const t of targets) {
        const website = str(t?.website).trim();
        const to = str(t?.to).trim();
        if (!website || !to) continue;

        try {
          const draft = await draftApplicationEmail({
            applicant: {
              fullName: applicant.fullName.trim(),
              phone: applicant.phone?.trim(),
              portfolioUrl: applicant.portfolioUrl?.trim(),
              coverLetterBase: applicant.coverLetterBase.trim(),
              position,
            },
            target: {
              website,
              to,
              companyName: t.companyName,
              jobTitle: t.jobTitle,
              siteContext: t.siteContext,
            },
          });

          results.push({
            website,
            to,
            ok: true,
            ...draft,
          });
        } catch (e: any) {
          results.push({
            website,
            to,
            ok: false,
            error: e?.message || String(e),
          });
        }
      }

      return reply.send({
        ok: true,
        results,
        stats: {
          total: results.length,
          ok: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
      });
    } catch (e: any) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: e?.message || String(e) });
    }
  });

  // STEP 4: Send applications with CV
  app.post("/api/send-applications", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const items = Array.isArray(body?.items) ? body.items : [];
      if (!items.length) return reply.code(400).send({ ok: false, error: "items[] required" });

      const dryRun = body?.dryRun !== false;
      const delayMs = clampInt(body?.delayMs, 0, 30000, 1500);
      const cvFilename = str(body?.cvFilename).trim();
      const region = str(body?.region).trim();

      const result = await sendApplications(
        items.map((x: any) => ({
          website: str(x?.website),
          to: str(x?.to),
          subject: str(x?.subject),
          body: str(x?.body),
        })),
        { dryRun, delayMs, cvFilename: cvFilename || undefined }
      );

      // Record successful sends
      if (!dryRun && region) {
        for (const r of result.results) {
          if (r.ok && !r.dedupeSkipped && r.website) {
            await recordSentWebsite({
              region: `jobs-${region}`,
              website: r.website,
              to: r.to,
              messageId: r.messageId,
            });
          }
        }
      }

      return reply.send(result);
    } catch (e: any) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: e?.message || String(e) });
    }
  });

  // Job Schedules endpoints
  app.get("/api/job-schedules", async () => {
    return { ok: true, schedules: await loadJobSchedules() };
  });

  app.post("/api/job-schedules", async (req) => {
    const s = await upsertJobSchedule(req.body as any);
    return { ok: true, schedule: s };
  });

  app.delete<{ Params: { id: string } }>("/api/job-schedules/:id", async (req) => {
    await deleteJobSchedule(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/job-schedules/:id/run-now", async (req, reply) => {
    const { id } = req.params;
    
    try {
      // Load only this specific schedule
      const schedules = await loadJobSchedules();
      const schedule = schedules.find(s => s.id === id);
      
      if (!schedule) {
        return reply.status(404).send({ ok: false, error: "Schedule not found" });
      }
      
      if (!schedule.enabled) {
        return reply.status(400).send({ ok: false, error: "Schedule is disabled - enable it first" });
      }
      
      // Run ONLY this one schedule in background
      console.log(`[RunNow] Manually starting schedule: ${schedule.region} / ${schedule.position}`);
      runScheduledJob(schedule).catch(err => {
        console.error(`[RunNow] Error for schedule ${id}:`, err);
      });
      
      return reply.send({ ok: true, message: "Job started in background" });
    } catch (e: any) {
      console.error("[RunNow] Error:", e);
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Scheduler loop (add to existing or create new)
  let jobSchedulerRunning = false;

  async function checkJobSchedules() {
    if (jobSchedulerRunning) return;
    jobSchedulerRunning = true;

    try {
      const due = await getJobSchedulesDue();
      console.log(`[JobScheduler] Check: ${due.length} schedules due`);

      for (const schedule of due) {
        await runScheduledJob(schedule);
      }
    } catch (e) {
      console.error("[JobScheduler] Error:", e);
    } finally {
      jobSchedulerRunning = false;
    }
  }

  app.post("/api/validate-email", async (req, reply) => {
    const { email, skipSmtp } = req.body as any;
    
    if (!email) {
      return reply.code(400).send({ ok: false, error: "email required" });
    }
    
    const result = await validateEmail(email, { skipSmtp: skipSmtp ?? false });
    return reply.send({ ok: true, result });
  });

  // Batch validation
  app.post("/api/validate-emails", async (req, reply) => {
    const { emails, skipSmtp } = req.body as any;
    
    if (!Array.isArray(emails) || emails.length === 0) {
      return reply.code(400).send({ ok: false, error: "emails[] required" });
    }
    
    // Limit batch size
    const limited = emails.slice(0, 50);
    const results = await validateEmails(limited, { skipSmtp: skipSmtp ?? true });
    
    const stats = {
      total: results.length,
      valid: results.filter(r => r.valid).length,
      invalid: results.filter(r => !r.valid).length,
      lowRisk: results.filter(r => r.risk === "low").length,
      mediumRisk: results.filter(r => r.risk === "medium").length,
      highRisk: results.filter(r => r.risk === "high").length,
    };
    
    return reply.send({ ok: true, results, stats });
  });

  // Check every 5 minutes
  setInterval(checkJobSchedules, 5 * 60 * 1000);

  const address = await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info({ address }, "Job Search Server running");
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});