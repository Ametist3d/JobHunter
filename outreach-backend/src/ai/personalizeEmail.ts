import crypto from "node:crypto";
import type { SiteContext } from "../crawl/extractSiteContext.js";
import {
  EMAIL_JSON_SCHEMA,
  buildEmailInstructions,
  buildContextEmailInput,
  buildLightEmailInput,
  type SenderInfo,
  type TargetInfo,
} from "./prompts.js";
import { openaiJson } from "./openai.js";

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export type DraftMode = "context" | "light";

export type DraftEmailResult = {
  subject: string;
  body: string;
  mode: DraftMode;
  language: string;
  personalizationUsed: boolean;
  personalizationEvidence: string;
  audit: {
    model: string;
    createdAt: string;
    promptSha256: string;
    responseId?: string;
  };
};

function languageFromTld(website: string): string | undefined {
  try {
    const host = new URL(website).hostname.toLowerCase();
    if (host.endsWith(".de") || host.endsWith(".at") || host.endsWith(".ch")) return "de";
    if (host.endsWith(".cz")) return "cs";
    if (host.endsWith(".hr")) return "hr";
    if (host.endsWith(".it")) return "it";
    if (host.endsWith(".fr")) return "fr";
    if (host.endsWith(".es")) return "es";
  } catch {}
  return undefined;
}

function detectLanguageHint(target: TargetInfo): string {
  // 1) explicit target.language
  const hint = (target.language || "").trim();
  if (hint) return hint;

  // 2) extracted site context language
  const ctxLang = (target.siteContext as SiteContext | null | undefined)?.language;
  if (typeof ctxLang === "string" && ctxLang.trim()) return ctxLang.trim();

  // 3) TLD fallback
  const tld = languageFromTld(target.website);
  if (tld) return tld;

  return "en";
}

function looksLikeLegalOrCookieNoise(text: string) {
  const t = text.toLowerCase();
  const bad = ["cookie", "cookies", "datenschutz", "privacy", "gdpr", "impressum", "terms", "bedingungen"];
  return bad.some((k) => t.includes(k));
}

export function isSiteContextSuitable(siteContext: SiteContext | null | undefined): boolean {
  if (!siteContext) return false;
  const snippet = (siteContext.textSnippet || "").trim();
  if (snippet.length < 500) return false;
  if (looksLikeLegalOrCookieNoise(snippet)) return false;

  const t = snippet.toLowerCase();
  // Multi-vertical signals: architecture/interiors + product + fashion + general CGI/3D.
  // Keep broad and language-agnostic-ish to avoid overfitting to architecture only.
  const signals = [
    // General CGI / 3D / visualization
    "cgi",
    "3d",
    "render",
    "rendering",
    "visualization",
    "visualisation",
    "visual",
    "visuals",
    "content",
    "images",
    "animation",
    "still",
    "postproduktion",
    "post-production",
    "studio",
    "agency",
    "büro",
    "office",
    "portfolio",
    "projects",
    "projekt",
    "referenzen",

    // Architecture / interiors
    "architektur",
    "architecture",
    "innenarchitektur",
    "interior",
    "interiors",
    "planung",

    // Product / e-commerce
    "product",
    "products",
    "produkt",
    "produkte",
    "product visualization",
    "product visualisation",
    "packshot",
    "packshots",
    "e-commerce",
    "ecommerce",
    "shop",
    "store",
    "catalog",
    "catalogue",
    "launch",

    // Fashion / apparel
    "fashion",
    "apparel",
    "clothing",
    "garment",
    "mode",
    "lookbook",
    "collection",
    "campaign",
    "jewelry",
    "jewellery",
    "schmuck",
    "footwear",
    "accessories",
    "beauty",
    "cosmetics",
  ];
  const hits = signals.reduce((acc, s) => acc + (t.includes(s) ? 1 : 0), 0);
  return hits >= 2;
}

export async function draftPersonalizedEmail(params: {
  sender: SenderInfo;
  target: TargetInfo;
}): Promise<DraftEmailResult> {
  const createdAt = new Date().toISOString();
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  const siteContext = (params.target.siteContext as SiteContext | null | undefined) ?? null;

  // ✅ language comes from extracted context first
  const language = detectLanguageHint({ ...params.target, siteContext });

  const mode: DraftMode = isSiteContextSuitable(siteContext) ? "context" : "light";

  const instructions = buildEmailInstructions(language);

  const input =
    mode === "context" && siteContext
      ? buildContextEmailInput(params.sender, { ...params.target, language, siteContext }, siteContext)
      : buildLightEmailInput(params.sender, { ...params.target, language, siteContext });

  const promptSha256 = sha256(instructions + "\n\n" + input);

  const result = await openaiJson<{
    subject: string;
    body: string;
    mode: DraftMode;
    language: string;
    personalizationUsed: boolean;
    personalizationEvidence: string;
  }>({
    model,
    instructions,
    input,
    schemaName: "outreach_email",
    schema: EMAIL_JSON_SCHEMA,
    temperature: 0.5,
    maxOutputTokens: 700,
  });

  const subject = String(result.json?.subject || "").trim();
  const body = String(result.json?.body || "").trim();
  const outMode = (result.json?.mode as DraftMode) || mode;
  const outLang = String(result.json?.language || language).trim() || language;

  if (!subject || !body) throw new Error("OpenAI JSON missing subject/body");

  return {
    subject,
    body,
    mode: outMode,
    language: outLang,
    personalizationUsed: Boolean(result.json?.personalizationUsed),
    personalizationEvidence: String(result.json?.personalizationEvidence || "none").trim() || "none",
    audit: {
      model,
      createdAt,
      promptSha256,
      responseId: result.responseId,
    },
  };
}
