import crypto from "node:crypto";
import { openaiJson } from "./openai.js";
import type { SiteContext } from "../crawl/extractSiteContext.js";

export type ApplicantInfo = {
  fullName: string;
  phone?: string;
  portfolioUrl?: string;
  coverLetterBase: string;
  position: string;
};

export type ApplicationTarget = {
  website: string;
  to: string;
  companyName?: string;
  jobTitle?: string;
  language?: string;
  siteContext?: SiteContext | null;
};

const APPLICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    language: { type: "string" },
    personalizationUsed: { type: "boolean" },
    personalizationEvidence: { type: "string" },
  },
  required: ["subject", "body", "language", "personalizationUsed", "personalizationEvidence"],
};

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function detectLanguageHint(target: ApplicationTarget): string {
  if (target.language?.trim()) return target.language.trim();

  const ctxLang = target.siteContext?.language;
  if (typeof ctxLang === "string" && ctxLang.trim()) return ctxLang.trim();

  try {
    const host = new URL(target.website).hostname.toLowerCase();
    if (host.endsWith(".de") || host.endsWith(".at") || host.endsWith(".ch")) return "de";
    if (host.endsWith(".fr")) return "fr";
    if (host.endsWith(".es")) return "es";
    if (host.endsWith(".it")) return "it";
    if (host.endsWith(".nl")) return "nl";
    if (host.endsWith(".pl")) return "pl";
    if (host.endsWith(".cz")) return "cs";
  } catch {}

  return "en";
}

export async function draftApplicationEmail(params: {
  applicant: ApplicantInfo;
  target: ApplicationTarget;
}) {
  const { applicant, target } = params;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const language = detectLanguageHint(target);

  const instructions = `
You write professional job application emails.
Return ONLY valid JSON matching the schema. No markdown.

RULES:
- Subject: Clear, professional, mention the position
- Body: 130-200 words, professional but personable tone
- If company context available, reference ONE specific thing about them (their work, values, projects)
- Briefly highlight relevant qualifications from the cover letter base
- Express genuine interest in the role and company
- End with clear call-to-action (request for interview/call)
- Mention that CV is attached
- Sign with applicant's full name
- Write in language: ${language}
- After the CTA, append the signature EXACTLY as provided, on separate lines.

DO NOT:
- Invent company facts not in the context
- Be overly formal or stiff
- Use generic phrases like "I am writing to apply for..."
- Include salary expectations
`;

  const siteSnippet = target.siteContext?.textSnippet?.slice(0, 1800) || "";
  const hasContext = siteSnippet.length > 300;

  const input = `
APPLICANT INFO:
- Full Name: ${applicant.fullName}
- Position seeking: ${applicant.position}
- Phone: ${applicant.phone || "N/A"}
- Portfolio: ${applicant.portfolioUrl || "N/A"}

COVER LETTER BASE (key qualifications & experience):
${applicant.coverLetterBase}

TARGET COMPANY:
- Website: ${target.website}
- Company name: ${target.companyName || "Unknown"}
- Job title (if found): ${target.jobTitle || applicant.position}
- HR/Contact email: ${target.to}

${hasContext ? `
COMPANY CONTEXT (from their website - use sparingly):
- Title: ${target.siteContext?.title || ""}
- Description: ${target.siteContext?.metaDescription || ""}
- H1: ${target.siteContext?.h1 || ""}
- Content excerpt: ${siteSnippet}
` : "No detailed company context available - write a professional but generic application."}

SIGNATURE (append exactly):

---
📧 This application was sent using Intelligent job search &
outreach automated system I developed to find right clients

Generate the application email now.
`;

  const promptSha = sha256(instructions + "\n" + input);

  const result = await openaiJson<{
    subject: string;
    body: string;
    language: string;
    personalizationUsed: boolean;
    personalizationEvidence: string;
  }>({
    model,
    instructions,
    input,
    schemaName: "job_application",
    schema: APPLICATION_SCHEMA,
    temperature: 0.5,
    maxOutputTokens: 700,
  });

  const subject = String(result.json?.subject || "").trim();
  const body = String(result.json?.body || "").trim();

  if (!subject || !body) {
    throw new Error("OpenAI returned empty subject or body");
  }

  return {
    subject,
    body,
    language: result.json.language || language,
    personalizationUsed: Boolean(result.json.personalizationUsed),
    personalizationEvidence: String(result.json.personalizationEvidence || "none"),
    audit: {
      model,
      createdAt: new Date().toISOString(),
      promptSha256: promptSha,
      responseId: result.responseId,
    },
  };
}