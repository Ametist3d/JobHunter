import crypto from "node:crypto";

export type PerplexityResult<T> = {
  rawText: string;
  json: T;
  model: string;
  promptSha256: string;
  citations: string[];
};

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export async function perplexitySearch<T>(params: {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<PerplexityResult<T>> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY missing");

  const model = process.env.PERPLEXITY_MODEL || "sonar";
  const promptSha256 = sha256(params.prompt);

  console.log(`[Perplexity] Calling ${model}...`);
  const startTime = Date.now();

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a job search assistant. Return valid JSON only.",
        },
        {
          role: "user",
          content: params.prompt,
        },
      ],
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 4000,
      return_citations: true,  // Ensure citations are returned
      return_related_questions: false,
    }),
  });

  const data = await res.json();
  console.log(`[Perplexity] Responded in ${Date.now() - startTime}ms`);

  if (!res.ok) {
    throw new Error(`Perplexity error: ${data?.error?.message || JSON.stringify(data)}`);
  }

  const choice = data.choices?.[0];
  const rawText = choice?.message?.content || "";
  const citations: string[] = data.citations || [];

  console.log(`[Perplexity] Response length: ${rawText.length}`);
  console.log(`[Perplexity] Citations: ${citations.length}`);
  
  if (process.env.DEBUG_PERPLEXITY === "1") {
    console.log(`[Perplexity] All citations:`);
    citations.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  }

  let json: T;
  try {
    let cleaned = rawText.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    json = JSON.parse(cleaned.trim());
  } catch {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      json = JSON.parse(rawText.slice(start, end + 1));
    } else {
      // Return empty leads if parsing fails - we'll use citations
      json = { leads: [] } as T;
    }
  }

  return { rawText, json, model, promptSha256, citations };
}