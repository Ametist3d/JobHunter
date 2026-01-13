import { randomUUID } from "node:crypto";
import { loadAllCampaigns, saveCampaign } from "./persist.js";

export type SiteContext = {
  title?: string;
  metaDescription?: string;
  h1?: string;
  h2?: string[];
  navLinks?: { text: string; href: string }[];
  textSnippet?: string;
};

export type PersonalizedCopy = {
  subject: string;
  body: string;
};

export type ProspectAI = {
  model: string;
  createdAt: string;
  promptSha256: string;
  responseChars: number;
};

export type Prospect = {
  id: string;
  website: string;

  foundEmails: string[];
  evidenceUrls: string[];

  siteContext?: SiteContext;
  personalized?: PersonalizedCopy;

  ai?: ProspectAI;

  status: "pending" | "crawling" | "crawled" | "sent" | "failed";
  error?: string;
};

export type Campaign = {
  id: string;
  createdAt: string;

  input: {
    region: string;
    companySize: string;
    description: string;
  };

  // base/fallback email (used if personalization not available)
  email: {
    subject: string;
    body: string;
  };

  prospects: Prospect[];

  status: "created" | "running" | "done" | "failed";

  stats: {
    total: number;
    crawled: number;
    emailsFound: number;
    sent: number;
    failed: number;
  };
};

const campaigns = new Map<string, Campaign>();

// Load persisted campaigns on startup
for (const c of loadAllCampaigns()) {
  campaigns.set(c.id, c);
}

export function createCampaign(params: {
  input: Campaign["input"];
  email: Campaign["email"];
  prospects: { website: string }[];
}) {
  const id = randomUUID();
  const now = new Date().toISOString();

  const campaign: Campaign = {
    id,
    createdAt: now,
    input: params.input,
    email: params.email,
    prospects: params.prospects.map((p) => ({
      id: randomUUID(),
      website: p.website,
      foundEmails: [],
      evidenceUrls: [],
      status: "pending",
    })),
    status: "created",
    stats: {
      total: params.prospects.length,
      crawled: 0,
      emailsFound: 0,
      sent: 0,
      failed: 0,
    },
  };

  campaigns.set(id, campaign);
  saveCampaign(campaign);
  return campaign;
}

export function getCampaign(id: string) {
  return campaigns.get(id);
}

export function updateCampaign(id: string, updater: (c: Campaign) => void) {
  const c = campaigns.get(id);
  if (!c) return null;

  updater(c);
  campaigns.set(id, c);
  saveCampaign(c);
  return c;
}
