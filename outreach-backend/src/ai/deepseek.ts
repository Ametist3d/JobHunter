import crypto from "node:crypto";

export type DeepSeekJsonResult<T> = {
  rawText: string;
  json: T;
  model: string;
  promptSha256: string;
  hasWebSearch: boolean;
};

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export async function deepseekChat(params: {
  prompt: string;
  webSearch?: boolean;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ rawText: string; json: any }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY missing");

  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  const body: any = {
    model,
    messages: [{ role: "user", content: params.prompt }],
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? 2000,
    response_format: { type: "json_object" },
  };

  // Try web search parameter (if supported)
  if (params.webSearch) {
    body.web_search = true;
  }

  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await r.json();
  
  if (!r.ok) {
    throw new Error(`DeepSeek error: ${data?.error?.message || r.status}`);
  }

  const rawText = data.choices?.[0]?.message?.content || "";
  let json = {};
  try {
    json = JSON.parse(rawText);
  } catch {}

  return { rawText, json };
}

export async function deepseekJson<T>(params: {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  enableWebSearch?: boolean;
}): Promise<DeepSeekJsonResult<T>> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY missing");

  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const promptSha256 = sha256(params.prompt);
  const enableWebSearch = params.enableWebSearch ?? true;

  console.log(`[DeepSeek] Calling ${model}, search: ${enableWebSearch}...`);
  const startTime = Date.now();

  // DeepSeek web search is enabled via the "search" feature in tools
  // Docs: https://api-docs.deepseek.com/guides/tool_calls
  const body: any = {
    model,
    messages: [
      {
        role: "system",
        content: "You are a job search assistant. Search the web to find current job openings. Return ONLY valid JSON.",
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
    temperature: params.temperature ?? 0.3,
    max_tokens: params.maxTokens ?? 4000,
    response_format: { type: "json_object" },
  };

  // Try enabling web search if supported
  // DeepSeek might use different parameter names - try common ones
  if (enableWebSearch) {
    // Option 1: Some APIs use this format
    body.web_search = true;
    
    // Option 2: Or as a feature flag
    body.features = { web_search: true };
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log(`[DeepSeek] Responded in ${Date.now() - startTime}ms`);

  if (!res.ok) {
    console.error(`[DeepSeek] Error:`, JSON.stringify(data, null, 2));
    throw new Error(`DeepSeek error: ${data?.error?.message || JSON.stringify(data)}`);
  }

  const choice = data.choices?.[0];
  const rawText = choice?.message?.content || "";
  
  // Check if web search was used (look for indicators in response)
  const usedSearch = data.usage?.search_tokens > 0 || 
                     choice?.message?.context?.search_results?.length > 0 ||
                     data.search_results?.length > 0;
  
  console.log(`[DeepSeek] Response length: ${rawText.length}`);
  console.log(`[DeepSeek] Web search used: ${usedSearch ? "YES" : "UNKNOWN"}`);

  if (process.env.DEBUG_DEEPSEEK === "1") {
    console.log(`[DeepSeek] Full response:`, JSON.stringify(data, null, 2));
  }

  let json: T;
  try {
    json = JSON.parse(rawText);
  } catch {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      json = JSON.parse(rawText.slice(start, end + 1));
    } else {
      throw new Error("Failed to parse DeepSeek response as JSON");
    }
  }

  return { 
    rawText, 
    json, 
    model, 
    promptSha256, 
    hasWebSearch: usedSearch || enableWebSearch,
  };
}