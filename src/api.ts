export type CompanySize = "small" | "medium" | "large";
export type SearchProvider = "gemini" | "deepseek" | "perplexity";

/** ---------- Common helpers ---------- */

type ApiOk<T> = T & { ok: true };
type ApiErr = { ok: false; error?: string };

async function readJsonOrThrow<T = any>(r: Response): Promise<T> {
  const text = await r.text();
  let data: any;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text || `HTTP ${r.status}` };
  }

  if (!r.ok) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }

  // Many endpoints return {ok:false} with 200. Treat that as error too.
  if (data && typeof data === "object" && data.ok === false) {
    throw new Error(data?.error || "Request failed");
  }

  return data as T;
}

async function postJson<T = any>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await readJsonOrThrow<T>(r);
}

/** ---------- Discover Jobs ---------- */

export type DiscoverJobsInput = {
  region: string;
  position: string;
  industry?: string;
  companySize: CompanySize;
  limit?: number;
  providers: SearchProvider[];
};

export type JobLead = {
  website: string;
  companyName?: string;
  jobTitle?: string;
  snippet?: string;
  source?: string;
  vacancyConfirmed?: boolean;
};

export type DiscoverJobsResponse = {
  ok: boolean;
  leads: JobLead[];
  byProvider: Record<string, { count: number; model: string }>;
  stats: { total: number; unique: number; duplicatesRemoved: number };
};

export async function discoverJobs(input: DiscoverJobsInput): Promise<DiscoverJobsResponse> {
  return await postJson("/api/discover-jobs", input);
}

/** ---------- Analyze Leads ---------- */

export type AnalyzeResultRow = {
  website: string;
  ok: boolean;
  emails?: string[];
  siteContext?: any;
  error?: string;
};

export type AnalyzeInput = {
  leads: JobLead[];
  position?: string;
  maxSites?: number;
  timeoutMs?: number;
  maxPages?: number;
};

export type AnalyzeResponse = {
  ok: boolean;
  results: AnalyzeResultRow[];
  stats: {
    total: number;
    withEmail: number;
    withoutEmail: number;
    withMatchingJob?: number;
    failures: number;
  };
};

export async function analyzeLeads(input: AnalyzeInput): Promise<AnalyzeResponse> {
  return await postJson("/api/analyze", input);
}

/** ---------- Prefilter ---------- */

export type PrefilterResult = {
  website: string;
  isCompany: boolean;
  hasOpenJobs: boolean;
  careersUrl?: string;
  reason?: string;
};

export async function prefilterLeads(input: {
  websites: string[];
  position: string;
}): Promise<{
  ok: boolean;
  results: PrefilterResult[];
  stats: { total: number; valid: number; filtered: number };
}> {
  return await postJson("/api/prefilter", input);
}

/** ---------- Generate Applications ---------- */

export type ApplicationDraftRow = {
  website: string;
  to: string | null;
  ok: boolean;
  subject?: string;
  body?: string;
  language?: string;
  personalizationUsed?: boolean;
  error?: string;
};

export type GenerateApplicationsInput = {
  applicant: {
    fullName: string;
    phone?: string;
    portfolioUrl?: string;
    coverLetterBase: string;
  };
  position: string;
  targets: Array<{
    website: string;
    to: string;
    companyName?: string;
    jobTitle?: string;
    siteContext?: any;
  }>;
};

export type GenerateApplicationsResponse = {
  ok: boolean;
  results: ApplicationDraftRow[];
  stats: { total: number; ok: number; failed: number };
};

export async function generateApplications(
  input: GenerateApplicationsInput
): Promise<GenerateApplicationsResponse> {
  return await postJson("/api/generate-applications", input);
}

/** ---------- Send Applications ---------- */

export type SendResultRow = {
  ok: boolean;
  dryRun: boolean;
  to?: string;
  website?: string;
  dedupeSkipped?: boolean;
  messageId?: string;
  error?: string;
};

export type SendApplicationsInput = {
  dryRun?: boolean;
  delayMs?: number;
  cvFilename?: string;
  region?: string;
  items: Array<{
    website?: string;
    to: string;
    subject: string;
    body: string;
  }>;
};

export type SendApplicationsResponse = {
  ok: boolean;
  results: SendResultRow[];
  stats: { total: number; sent: number; failed: number; dryRunOk: number; skippedDuplicates: number };
};

export async function sendApplications(input: SendApplicationsInput): Promise<SendApplicationsResponse> {
  return await postJson("/api/send-applications", input);
}

/** ---------- Email validation ---------- */

export type EmailValidationResult = {
  email: string;
  valid: boolean;
  checks: {
    syntax: boolean;
    mxExists: boolean;
    smtpValid?: boolean | "unknown";
    isDisposable: boolean;
    isRoleBased: boolean;
    isCatchAll?: boolean;
  };
  risk: "low" | "medium" | "high";
  reason?: string;
};

export async function validateEmailApi(
  email: string,
  skipSmtp = false
): Promise<EmailValidationResult> {
  const data = await postJson<{ ok: boolean; result: EmailValidationResult }>(
    "/api/validate-email",
    { email, skipSmtp }
  );
  return data.result;
}

export async function validateEmailsApi(
  emails: string[],
  skipSmtp = true
): Promise<{ ok: boolean; results: EmailValidationResult[]; stats: { total: number; valid: number; invalid: number } }> {
  return await postJson("/api/validate-emails", { emails, skipSmtp });
}

/** ---------- CSV export ---------- */

export function exportLeadsCsv(filename: string, leads: JobLead[]) {
  if (!leads?.length) return;

  const headers = ["website", "companyName", "jobTitle", "snippet"];
  const escape = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };

  const rows = [
    headers.join(","),
    ...leads.map((l) => headers.map((h) => escape((l as any)[h])).join(",")),
  ].join("\n");

  const blob = new Blob([rows], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
