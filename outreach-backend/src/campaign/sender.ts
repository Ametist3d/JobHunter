import { getCampaign, updateCampaign } from "./store.js";
import { sendEmail } from "../email/mailer.js";
import { personalizeEmail } from "../ai/personalizeEmail.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendCampaignEmails(
  campaignId: string,
  opts?: {
    dryRun?: boolean;
    maxToSend?: number;
    delayBetweenEmailsMs?: number;
    requirePersonalization?: boolean; // safety: only send if personalized exists
  }
) {
  const dryRun = opts?.dryRun ?? true;
  const maxToSend = opts?.maxToSend ?? 20;
  const delayBetweenEmailsMs = opts?.delayBetweenEmailsMs ?? 1200;
  const requirePersonalization = opts?.requirePersonalization ?? false;

  const c0 = getCampaign(campaignId);
  if (!c0) throw new Error("Campaign not found");

  let sentCount = 0;

  // stable snapshot of prospect IDs (so updates won't mess iteration)
  const prospectIds = c0.prospects.map((p) => p.id);

  for (const pid of prospectIds) {
    if (sentCount >= maxToSend) break;

    const c = getCampaign(campaignId);
    if (!c) throw new Error("Campaign not found");

    const p = c.prospects.find((x) => x.id === pid);
    if (!p) continue;

    if (!p.foundEmails || p.foundEmails.length === 0) continue;
    if (p.status === "sent") continue;

    const to = p.foundEmails[0];

    // Generate/cached personalization (if possible)
    if (!p.personalized && p.siteContext) {
      const result = await personalizeEmail({
        yourStudioName: process.env.STUDIO_NAME || "Threedex Studio",
        yourName: process.env.SENDER_NAME || "Your Name",
        region: c.input.region,
        baseOffer:
          process.env.BASE_OFFER ||
          "Architectural visualization: still renders, animations, and marketing visuals.",
        site: { url: p.website, context: p.siteContext },
      });

      updateCampaign(campaignId, (cc) => {
        const pr = cc.prospects.find((x) => x.id === pid);
        if (!pr) return;
        pr.personalized = { subject: result.subject, body: result.body };
        pr.ai = result.audit; // ✅ hard proof of Gemini call
      });
    }

    // Reload after potential updates
    const latest = getCampaign(campaignId);
    const lp = latest?.prospects.find((x) => x.id === pid);

    if (requirePersonalization && !lp?.personalized) {
      continue;
    }

    const subject = (lp?.personalized?.subject || c.email.subject).trim();
    const bodyText = (lp?.personalized?.body || c.email.body).trim();

    try {
      if (!dryRun) {
        await sendEmail({
          to,
          subject,
          html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(
            bodyText
          )}</pre>`,
          text: bodyText,
        });
      }

      updateCampaign(campaignId, (cc) => {
        const pr = cc.prospects.find((x) => x.id === pid);
        if (!pr) return;
        pr.status = "sent";
        cc.stats.sent += 1;
      });

      sentCount += 1;
      await sleep(delayBetweenEmailsMs);
    } catch (e: any) {
      updateCampaign(campaignId, (cc) => {
        const pr = cc.prospects.find((x) => x.id === pid);
        if (!pr) return;
        pr.status = "failed";
        pr.error = e?.message || String(e);
        cc.stats.failed += 1;
      });
    }
  }

  return { dryRun, sent: sentCount };
}
