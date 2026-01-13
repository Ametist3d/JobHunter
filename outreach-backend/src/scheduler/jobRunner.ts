import { discoverWithGemini, discoverWithDeepSeek, discoverWithPerplexity, type JobLead } from "../ai/discoverJobs.js";
import { prefilterLeads } from "../ai/prefilterLeads.js";
import { crawlForEmails } from "../crawl/crawlSite.js";
import { draftApplicationEmail } from "../ai/personalizeApplication.js";
import { sendEmail } from "../email/mailer.js";
import { getSentDomainsByRegion, recordSentWebsite } from "../db/db.js";
import { markScheduleRun, type JobSchedule } from "../db/jobSchedules.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export async function runScheduledJob(schedule: JobSchedule) {
  console.log(`[JobScheduler] ========================================`);
  console.log(`[JobScheduler] Starting: ${schedule.region} / ${schedule.position}`);
  console.log(`[JobScheduler] Providers: ${schedule.providers.join(", ")}`);

  const stats = { found: 0, prefiltered: 0, withEmail: 0, sent: 0, failed: 0 };

  try {
    // 1. Get already-sent domains
    const sent = await getSentDomainsByRegion({ region: schedule.region, limit: 5000 });
    const excludeSet = new Set(sent.domains.map(d => d.toLowerCase()));

    const input = {
      region: schedule.region,
      position: schedule.position,
      industry: schedule.industry,
      companySize: schedule.companySize,
      limit: schedule.limit,
      excludeDomains: sent.domains,
    };

    // 2. Run all selected providers in parallel
    console.log(`[JobScheduler] Searching with ${schedule.providers.length} providers...`);
    
    const providerFns: Record<string, () => Promise<any>> = {
      gemini: () => discoverWithGemini(input, excludeSet),
      deepseek: () => discoverWithDeepSeek(input, excludeSet),
      perplexity: () => discoverWithPerplexity(input, excludeSet),
    };

    const results = await Promise.allSettled(
      schedule.providers.map(p => providerFns[p]?.() || Promise.resolve({ leads: [] }))
    );

    // Merge and dedupe
    const allLeads: JobLead[] = [];
    results.forEach((result, idx) => {
      if (result.status === "fulfilled" && result.value?.leads) {
        console.log(`[JobScheduler] ${schedule.providers[idx]}: ${result.value.leads.length} leads`);
        allLeads.push(...result.value.leads);
      }
    });

    const seen = new Set<string>();
    const uniqueLeads = allLeads.filter(l => {
      const domain = safeHostname(l.website);
      if (!domain || seen.has(domain)) return false;
      seen.add(domain);
      return true;
    });

    stats.found = uniqueLeads.length;
    console.log(`[JobScheduler] Total unique leads: ${stats.found}`);

    if (stats.found === 0) {
      console.log(`[JobScheduler] No leads found`);
      await markScheduleRun(schedule.id, stats);
      return stats;
    }

    // 3. Prefilter with DeepSeek
    console.log(`[JobScheduler] Prefiltering ${uniqueLeads.length} companies...`);
    const prefilterRes = await prefilterLeads(
      uniqueLeads.map(l => l.website),
      schedule.position
    );

    const validLeads = prefilterRes.results
      .filter(r => r.isCompany && r.hasOpenJobs)
      .map(r => {
        const original = uniqueLeads.find(l => l.website === r.website);
        return { ...original!, careersUrl: r.careersUrl };
      });

    stats.prefiltered = validLeads.length;
    console.log(`[JobScheduler] After prefilter: ${stats.prefiltered}`);

    if (stats.prefiltered === 0) {
      await markScheduleRun(schedule.id, stats);
      return stats;
    }

    // 4. Crawl for emails
    for (const lead of validLeads) {
      try {
        const crawl = await crawlForEmails(lead.careersUrl || lead.website, {
          maxPages: 8,
          timeoutMs: 12000,
        });

        if (!crawl.emails.length) continue;

        stats.withEmail++;

        // 5. Generate and send to all emails
        const draft = await draftApplicationEmail({
          applicant: {
            ...schedule.applicant,
            position: schedule.position,
          },
          target: {
            website: lead.website,
            to: crawl.emails[0],
            companyName: lead.companyName,
            jobTitle: lead.jobTitle,
            siteContext: crawl.siteContext,
          },
        });

        for (const email of crawl.emails.slice(0, 3)) {
          try {
            const info = await sendEmail({
              to: email,
              subject: draft.subject,
              html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(draft.body)}</pre>`,
              text: draft.body,
              attachmentPath: schedule.applicant.cvFilename 
                ? `./data/cv/${schedule.applicant.cvFilename}` 
                : undefined,  // ✅ matches mailer signature
            });

            await recordSentWebsite({
              region: schedule.region,
              website: lead.website,
              to: email,
              messageId: (info as any)?.messageId,
            });

            stats.sent++;
            console.log(`[JobScheduler] ✓ Sent to ${email}`);
          } catch (e: any) {
            stats.failed++;
            console.error(`[JobScheduler] ✗ Failed ${email}:`, e.message);
          }

          await sleep(2000);
        }
      } catch (e: any) {
        console.error(`[JobScheduler] Error processing ${lead.website}:`, e.message);
      }
    }
  } catch (e: any) {
    console.error(`[JobScheduler] Campaign error:`, e.message);
  }

  await markScheduleRun(schedule.id, stats);

  console.log(`[JobScheduler] Results: found=${stats.found} prefiltered=${stats.prefiltered} withEmail=${stats.withEmail} sent=${stats.sent} failed=${stats.failed}`);
  console.log(`[JobScheduler] ========================================`);

  return stats;
}
