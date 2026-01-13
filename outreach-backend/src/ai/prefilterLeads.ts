import { deepseekChat } from "./deepseek.js";

export type PrefilterResult = {
  website: string;
  isCompany: boolean;
  hasOpenJobs: boolean;
  careersUrl?: string;
  reason?: string;
};

export async function prefilterLeads(
  websites: string[],
  position: string
): Promise<{
  ok: boolean;
  results: PrefilterResult[];
  stats: { total: number; valid: number; filtered: number };
}> {
  const BATCH_SIZE = 15;
  const allResults: PrefilterResult[] = [];

  console.log(`[Prefilter] Checking ${websites.length} websites in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < websites.length; i += BATCH_SIZE) {
    const batch = websites.slice(i, i + BATCH_SIZE);
    console.log(`[Prefilter] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(websites.length / BATCH_SIZE)}`);

    const prompt = `
Check these company websites. For each one, determine:
1. Is it a real company? (NOT a job board, university, government site, news site, or aggregator)
2. Does it have active job openings / careers page?
3. Direct URL to their careers/jobs page (if found)

Websites:
${batch.map((w, idx) => `${idx + 1}. ${w}`).join("\n")}

Position of interest: "${position}"

Return JSON only:
{
  "results": [
    {
      "website": "https://example.com",
      "isCompany": true,
      "hasOpenJobs": true,
      "careersUrl": "https://example.com/careers",
      "reason": "Active tech company with open positions"
    }
  ]
}

Rules:
- isCompany=false for: LinkedIn, Indeed, Glassdoor, StepStone, universities (.edu, .ac), government (.gov)
- hasOpenJobs=false if: company acquired/closed, no careers page, careers page empty/outdated
- Always try to find the direct careersUrl
`.trim();

    try {
      const res = await deepseekChat({
        prompt,
        webSearch: true,
        temperature: 0.1,
        maxTokens: 2000,
      });

      const parsed = res.json as { results?: PrefilterResult[] };
      if (Array.isArray(parsed?.results)) {
        allResults.push(...parsed.results);
      } else {
        // Fallback: mark all as valid (don't lose leads on parse error)
        batch.forEach(w => allResults.push({
          website: w,
          isCompany: true,
          hasOpenJobs: true,
          reason: "Parse error - defaulting to valid"
        }));
      }
    } catch (e: any) {
      console.error(`[Prefilter] Batch error:`, e.message);
      // On API error, mark batch as valid (be conservative)
      batch.forEach(w => allResults.push({
        website: w,
        isCompany: true,
        hasOpenJobs: true,
        reason: "API error - defaulting to valid"
      }));
    }
  }

  const valid = allResults.filter(r => r.isCompany && r.hasOpenJobs);

  console.log(`[Prefilter] Results: ${valid.length}/${allResults.length} valid`);

  return {
    ok: true,
    results: allResults,
    stats: {
      total: allResults.length,
      valid: valid.length,
      filtered: allResults.length - valid.length,
    },
  };
}