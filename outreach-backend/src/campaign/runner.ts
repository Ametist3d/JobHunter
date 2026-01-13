import { crawlForEmails } from "../crawl/crawlSite.js";
import { getCampaign, updateCampaign } from "./store.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runCampaignCrawl(campaignId: string) {
  const c0 = getCampaign(campaignId);
  if (!c0) throw new Error("Campaign not found");

  updateCampaign(campaignId, (cc) => {
    cc.status = "running";
  });

  // stable snapshot of prospect IDs
  const prospectIds = c0.prospects.map((p) => p.id);

  for (const pid of prospectIds) {
    const current = getCampaign(campaignId);
    if (!current) break;

    const p = current.prospects.find((x) => x.id === pid);
    if (!p) continue;

    updateCampaign(campaignId, (cc) => {
      const pr = cc.prospects.find((x) => x.id === pid);
      if (pr && pr.status === "pending") pr.status = "crawling";
    });

    try {
      const result = await crawlForEmails(p.website, {
        timeoutMs: 12000,
        delayBetweenPagesMs: 350,
        maxPages: 8,
      });

      updateCampaign(campaignId, (cc) => {
        const pr = cc.prospects.find((x) => x.id === pid);
        if (!pr) return;

        pr.foundEmails = result.emails;
        pr.evidenceUrls = result.evidenceUrls;
        pr.siteContext = result.siteContext;
        pr.status = "crawled";

        cc.stats.crawled += 1;
        cc.stats.emailsFound += result.emails.length;
      });
    } catch (e: any) {
      updateCampaign(campaignId, (cc) => {
        const pr = cc.prospects.find((x) => x.id === pid);
        if (!pr) return;

        pr.status = "failed";
        pr.error = e?.message || String(e);
        cc.stats.failed += 1;
      });
    }

    await sleep(600);
  }

  updateCampaign(campaignId, (cc) => {
    cc.status = cc.status === "failed" ? "failed" : "done";
  });
}
