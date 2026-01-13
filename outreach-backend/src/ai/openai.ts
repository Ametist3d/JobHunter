import fs from "node:fs";
import path from "node:path";

type JsonSchema = Record<string, any>;

export type OpenAIJsonResult<T> = {
  rawText: string;
  json: T;
  responseId?: string;
  model: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

function nowTag() {
  // 2025-12-25T08-22-05-796Z like your gemini logs
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeStringify(obj: any) {
  // Avoid circular refs
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    },
    2
  );
}

function writeOpenAiDebugFiles(params: {
  model: string;
  requestBody: any;
  responseText: string;
  responseJson?: any;
}) {
  if (process.env.DEBUG_OPENAI !== "1") return;

  const outDir = path.resolve(process.cwd(), "debug");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = nowTag();
  const base = path.join(outDir, `openai_${params.model}_${ts}`);

  // Sanitize request (never log Authorization)
  const sanitizedReq = {
    url: "https://api.openai.com/v1/responses",
    body: params.requestBody,
  };

  fs.writeFileSync(`${base}.request.json`, safeStringify(sanitizedReq), "utf8");
  fs.writeFileSync(`${base}.response.txt`, params.responseText ?? "", "utf8");

  if (params.responseJson) {
    fs.writeFileSync(`${base}.response.json`, safeStringify(params.responseJson), "utf8");
  }

  // If there is a clean output_text, store it separately for quick inspection
  const outputText =
    typeof params.responseJson?.output_text === "string"
      ? params.responseJson.output_text
      : "";

  if (outputText) {
    fs.writeFileSync(`${base}.output.txt`, outputText, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log(`[DEBUG_OPENAI] wrote ${base}.request.json / .response.*`);
}

function extractFirstJsonObject(text: string): any {
  // Best-effort: find first {...} block.
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON object in model output");

  // naive brace matching
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        return JSON.parse(slice);
      }
    }
  }
  throw new Error("Unclosed JSON object in model output");
}

/**
 * Calls OpenAI Responses API and returns structured JSON.
 * Uses Structured Outputs (json_schema) when supported; otherwise falls back to parsing JSON.
 *
 * Enable debug files:
 *   DEBUG_OPENAI=1
 * (writes ./debug/openai_<model>_<timestamp>.*)
 */
export async function openaiJson<T>(params: {
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: JsonSchema;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<OpenAIJsonResult<T>> {
  const apiKey = requireEnv("OPENAI_API_KEY");

  const body: any = {
    model: params.model,
    instructions: params.instructions,
    input: params.input,
    temperature: params.temperature ?? 0.4,
    max_output_tokens: params.maxOutputTokens ?? 500,
    text: {
      format: {
        type: "json_schema",
        name: params.schemaName,
        strict: true,
        schema: params.schema,
      },
    },
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await r.text();

  let data: any | undefined;
  try {
    data = JSON.parse(raw);
  } catch {
    // still write debug files even if parse fails
    writeOpenAiDebugFiles({
      model: params.model,
      requestBody: body,
      responseText: raw,
      responseJson: undefined,
    });
    throw new Error("OpenAI returned non-JSON response");
  }

  // Write debug after parsing (still sanitized)
  writeOpenAiDebugFiles({
    model: params.model,
    requestBody: body,
    responseText: raw,
    responseJson: data,
  });

  if (!r.ok) {
    throw new Error(`OpenAI HTTP ${r.status}: ${raw.slice(0, 4000)}`);
  }

  // Responses API: prefer output_text if present
  const outputText: string =
    typeof data?.output_text === "string"
      ? data.output_text
      : Array.isArray(data?.output)
      ? // fallback: concatenate message text segments
        data.output
          .flatMap((item: any) => item?.content ?? [])
          .map((c: any) => c?.text)
          .filter((t: any) => typeof t === "string")
          .join("")
      : "";

  if (!outputText) {
    // Some paths may return JSON directly in output; try to locate.
    const maybe = data?.output?.[0]?.content?.[0]?.json;
    if (maybe) {
      return {
        rawText: JSON.stringify(maybe),
        json: maybe as T,
        responseId: data?.id,
        model: params.model,
      };
    }
    throw new Error("OpenAI response missing output_text");
  }

  // With strict json_schema, outputText should already be JSON.
  let json: any;
  try {
    json = JSON.parse(outputText);
  } catch {
    // fallback extraction if the model wrapped JSON with text
    json = extractFirstJsonObject(outputText);
  }

  return {
    rawText: outputText,
    json: json as T,
    responseId: data?.id,
    model: params.model,
  };
}
