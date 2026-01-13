export type CompanySize = "small" | "medium" | "large";

export type JobLead = {
  website: string;
  companyName?: string;
  jobTitle?: string;
  snippet?: string;
  source?: string;
};

export type AnalyzeResultRow = {
  website: string;
  ok: boolean;
  emails?: string[];
  siteContext?: any;
  error?: string;
};

export type ApplicationDraft = {
  id: string;
  website: string;
  companyName?: string;
  to: string;
  subject: string;
  body: string;
  language?: string;
  disabled?: boolean;
};

export type SendResultRow = {
  ok: boolean;
  dryRun: boolean;
  to?: string;
  website?: string;
  dedupeSkipped?: boolean;
  messageId?: string;
  error?: string;
};