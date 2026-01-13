// src/scheduler/runner.ts

import { discoverLeads } from "../ai/discover.js";
import { crawlForEmails } from "../crawl/crawlSite.js";
import { draftPersonalizedEmail } from "../ai/personalizeEmail.js";
import { sendEmail } from "../email/mailer.js";
import { getSentDomainsByRegion, recordSentWebsite } from "../db/db.js";
import { markScheduleRun, areAllSchedulesDisabled, type CampaignSchedule } from "../db/schedules.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Track if we've already sent the "all disabled" notification this session
let allDisabledNotificationSent = false;

export async function runScheduledCampaign(schedule: CampaignSchedule) {
  console.log(`[Scheduler] ========================================`);
  console.log(`[Scheduler] Starting campaign: ${schedule.region} / ${schedule.marketDomain}`);
  console.log(`[Scheduler] Schedule ID: ${schedule.id}`);
  console.log(`[Scheduler] Consecutive empty runs: ${schedule.consecutiveEmptyRuns || 0}`);

  const stats = { found: 0, sent: 0, failed: 0 };

  if (!process.env.GEMINI_API_KEY) {
    console.error("[Scheduler] ERROR: GEMINI_API_KEY is missing!");
    await markScheduleRun(schedule.id, stats);
    return stats;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("[Scheduler] ERROR: OPENAI_API_KEY is missing!");
    await markScheduleRun(schedule.id, stats);
    return stats;
  }

  try {
    // 1. Get already-sent domains
    console.log(`[Scheduler] Step 1: Getting sent domains...`);
    const sent = await getSentDomainsByRegion({ region: schedule.region, limit: 5000 });
    console.log(`[Scheduler] Found ${sent.domains.length} already-sent domains`);

    // 2. Discover new leads
    console.log(`[Scheduler] Step 2: Discovering new leads...`);
    const discoverStart = Date.now();
    
    const discovered = await discoverLeads({
      region: schedule.region,
      companySize: schedule.companySize,
      domain: schedule.marketDomain,
      limit: schedule.limit,
      excludeDomains: sent.domains,
    });

    console.log(`[Scheduler] Discover completed in ${Date.now() - discoverStart}ms`);
    stats.found = discovered.leads?.length ?? 0;
    console.log(`[Scheduler] Found ${stats.found} new leads`);

    if (stats.found === 0) {
      console.log(`[Scheduler] No new leads found`);
    } else {
      // 3. Process each lead
      for (let i = 0; i < discovered.leads.length; i++) {
        const lead = discovered.leads[i];
        console.log(`[Scheduler] Processing ${i + 1}/${stats.found}: ${lead.website}`);

        try {
          const crawl = await crawlForEmails(lead.website, {
            maxPages: 8,
            timeoutMs: 12000,
            delayBetweenPagesMs: 300,
          });

          if (!crawl.emails.length) {
            console.log(`[Scheduler] No email found, skipping`);
            continue;
          }

          const to = crawl.emails[0];

          const draft = await draftPersonalizedEmail({
            sender: {
              studioName: schedule.sender.studioName,
              yourName: schedule.sender.yourName,
              region: schedule.region,
              baseOffer: schedule.sender.baseOffer,
            },
            target: {
              website: lead.website,
              siteContext: crawl.siteContext,
            },
          });

          const info = await sendEmail({
            to,
            subject: draft.subject,
            html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(draft.body)}</pre>`,
            text: draft.body,
          });

          await recordSentWebsite({
            region: schedule.region,
            website: lead.website,
            to,
            messageId: (info as any)?.messageId,
          });

          stats.sent++;
          console.log(`[Scheduler] Sent to ${to}`);

          await sleep(1500);
        } catch (e: any) {
          stats.failed++;
          console.error(`[Scheduler] Failed ${lead.website}:`, e.message);
        }
      }
    }
  } catch (e: any) {
    console.error(`[Scheduler] Campaign error:`, e.message);
  }

  // Update schedule and check for auto-disable
  const { autoDisabled, reason } = await markScheduleRun(schedule.id, stats);
  
  if (autoDisabled) {
    console.log(`[Scheduler] ⚠️  AUTO-DISABLED: ${reason}`);
  }

  // Check if ALL schedules are now disabled
  const allDisabled = await areAllSchedulesDisabled();
  if (allDisabled && !allDisabledNotificationSent) {
    await sendAllDisabledNotification();
    allDisabledNotificationSent = true;
  }

  console.log(`[Scheduler] Results: found=${stats.found} sent=${stats.sent} failed=${stats.failed}`);
  console.log(`[Scheduler] ========================================`);

  return stats;
}

// Send notification when all schedules are disabled
async function sendAllDisabledNotification() {
  console.log(`[Scheduler] ========================================`);
  console.log(`[Scheduler] 🛑 ALL SCHEDULES DISABLED`);
  console.log(`[Scheduler] No more automatic campaigns will run.`);
  console.log(`[Scheduler] Re-enable schedules in the UI to continue.`);
  console.log(`[Scheduler] ========================================`);

  // Optional: Send email notification
  if (process.env.ADMIN_EMAIL) {
    try {
      await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: "[VizOutreach] All scheduled campaigns disabled",
        text: `All scheduled campaigns have been auto-disabled due to consecutive empty results.\n\nPlease check the dashboard and re-enable or adjust the campaigns.`,
        html: `<p>All scheduled campaigns have been auto-disabled due to consecutive empty results.</p><p>Please check the dashboard and re-enable or adjust the campaigns.</p>`,
      });
      console.log(`[Scheduler] Notification email sent to ${process.env.ADMIN_EMAIL}`);
    } catch (e: any) {
      console.error(`[Scheduler] Failed to send notification email:`, e.message);
    }
  }
}

// Reset notification flag (call when a schedule is re-enabled)
export function resetAllDisabledNotification() {
  allDisabledNotificationSent = false;
}