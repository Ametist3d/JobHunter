import type { SiteContext } from "../crawl/extractSiteContext.js";

// Standard email signature appended to every outreach email.
// Keep formatting exactly as required.
export const EMAIL_SIGNATURE = `Best regards,
Iegor Gorai Founder & Creative Director
Threedex Studio
https://threedex.ai`;

export type SenderInfo = {
  studioName: string;
  yourName: string;
  region?: string;
  baseOffer: string;
};


export type TargetInfo = {
  website: string;
  companyName?: string;
  language?: string; // e.g., 'de', 'en', 'hr'
  siteContext?: SiteContext | any | null;
};

export const EMAIL_JSON_SCHEMA: Record<string, any> = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    mode: { type: "string", enum: ["context", "light"] },
    language: { type: "string" },
    personalizationUsed: { type: "boolean" },
    personalizationEvidence: { type: "string" },
  },
  required: ["subject", "body", "mode", "language", "personalizationUsed", "personalizationEvidence"],
};

export function buildEmailInstructions(languageHint?: string) {
  return (
    `You write short, human-sounding B2B outreach emails for a creative service studio.\n` +
    `Return ONLY valid JSON that matches the schema. No markdown. No extra keys.\n` +
    `Hard rules:\n` +
    `- Do not invent facts, projects, awards, clients, locations, team members, or services.\n` +
    `- If personalization is uncertain, be generic.\n` +
    `- No pricing. No attachments.\n` +
    `- Do not include any links EXCEPT the website link in the signature (provided below).\n` +
    `- 110–170 words in the body.\n` +
    `- End with ONE simple question CTA.\n` +
    `- After the CTA, append the signature EXACTLY as provided, on separate lines.\n` +
    `SIGNATURE (append exactly):\n${EMAIL_SIGNATURE}\n` +
    (languageHint ? `- The subject and body MUST be written in: ${languageHint}.\n` : "")
  );
}

function safeStr(x: any) {
  return typeof x === "string" ? x.trim() : "";
}

export function buildContextEmailInput(sender: SenderInfo, target: TargetInfo, siteContext: SiteContext) {
  const website = safeStr(target.website);
  const companyName = safeStr(target.companyName);
  const language = safeStr(target.language);

  return (
    `SENDER\n` +
    `- Studio: ${sender.studioName}\n` +
    `- Sender name: ${sender.yourName}\n` +
    // (sender.region ? `- Sender region: ${sender.region}\n` : "") +
    (sender.region ? `- Sender region: Germany and Croatia` : "") +
    `- Offer: ${sender.baseOffer}\n\n` +
    `TARGET\n` +
    `- Website: ${website}\n` +
    (companyName ? `- Company name: ${companyName}\n` : "") +
    (language ? `- Language hint: ${language}\n` : "") +
    `\n` +
    `EXTRACTED SITE CONTEXT (use ONLY what is present; do not guess):\n` +
    `- title: ${safeStr(siteContext.title)}\n` +
    `- metaDescription: ${safeStr(siteContext.metaDescription)}\n` +
    `- h1: ${safeStr(siteContext.h1)}\n` +
    `- h2: ${(siteContext.h2 || []).slice(0, 8).map((s) => safeStr(s)).filter(Boolean).join(" | ")}\n` +
    `- textSnippet: ${safeStr(siteContext.textSnippet).slice(0, 2400)}\n\n` +
    `TASK\n` +
    `Write ONE outreach email. It should feel personalized based on the context, but only with safe, verifiable details.\n` +
    `Include at most ONE specific observation (e.g., a service focus, project type, stated values).\n` +
    `If the context is generic/noisy, keep the observation generic ("your studio's work", "your portfolio").\n` +
    `Set mode="context". Set personalizationUsed=true if you used a concrete detail; otherwise false.\n` +
    `personalizationEvidence must briefly say what you used (or "none").\n`
  );
}

export function buildLightEmailInput(sender: SenderInfo, target: TargetInfo) {
  const website = safeStr(target.website);
  const companyName = safeStr(target.companyName);
  const language = safeStr(target.language);

  return (
    `SENDER\n` +
    `- Studio: ${sender.studioName}\n` +
    `- Sender name: ${sender.yourName}\n` +
    (sender.region ? `- Sender region: Germany and Croatia` : "") +
    // (sender.region ? `- Sender region: ${sender.region}\n` : "") +
    `- Offer: ${sender.baseOffer}\n\n` +
    `TARGET\n` +
    `- Website: ${website}\n` +
    (companyName ? `- Company name: ${companyName}\n` : "") +
    (language ? `- Language hint: ${language}\n` : "") +
    `\n` +
    `TASK\n` +
    `Write ONE outreach email WITHOUT using any extracted website text.\n` +
    `Only mention company name (if present) and their broad market category in a non-specific way (e.g., brand/studio/agency; architecture/interiors; product; fashion; e-commerce).\n` +
    `Do NOT claim you reviewed their work/projects/portfolio.\n` +
    `Set mode="light". Set personalizationUsed=false. personalizationEvidence must be "none".\n`
  );
}
