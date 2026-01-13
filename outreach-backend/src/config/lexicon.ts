import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

export type Lexicon = {
  crawl: {
    tokens_contact: string[];
    tokens_legal: string[];
    tokens_about: string[];
    url_hints: string[];
    job_keywords: string[];  // NEW
  };
  email: {
    blocked_extensions: string[];
    blocked_domain_suffixes: string[];
    blocked_user_patterns: string[];
    good_prefixes: string[];
    reserved_domains: string[];
    bounce_fake_domains: string[];
    placeholder_users: string[];
    free_email_domains: string[];
  };
  language: {
    stopwords: Record<string, string[]>;
  };
  urls: {
    candidate_paths: string[];
  };
  site_relevance: {
    blacklist_hosts: Set<string>;
    strong_negative_keywords: string[];
    negative_keywords: string[];
    positive_keywords: string[];
  };
};

let cachedLexicon: Lexicon | null = null;

export function loadLexicon(): Lexicon {
  if (cachedLexicon) return cachedLexicon;

  const lexiconPath = path.resolve(__dirname, "lexicon.yaml");
  
  try {
    const raw = fs.readFileSync(lexiconPath, "utf8");
    const parsed = yaml.parse(raw);

    cachedLexicon = {
      crawl: {
        tokens_contact: parsed.crawl?.tokens_contact || [],
        tokens_legal: parsed.crawl?.tokens_legal || [],
        tokens_about: parsed.crawl?.tokens_about || [],
        url_hints: parsed.crawl?.url_hints || [],
        job_keywords: parsed.crawl?.job_keywords || [],  // NEW
      },
      email: {
        blocked_extensions: parsed.email?.blocked_extensions || [],
        blocked_domain_suffixes: parsed.email?.blocked_domain_suffixes || [],
        blocked_user_patterns: parsed.email?.blocked_user_patterns || [],
        good_prefixes: parsed.email?.good_prefixes || [],
        reserved_domains: parsed.email?.reserved_domains || [],
        bounce_fake_domains: parsed.email?.bounce_fake_domains || [],
        placeholder_users: parsed.email?.placeholder_users || [],
        free_email_domains: parsed.email?.free_email_domains || [],
      },
      language: {
        stopwords: parsed.language?.stopwords || {},
      },
      urls: {
        candidate_paths: parsed.urls?.candidate_paths || [],
      },
      site_relevance: {
        blacklist_hosts: new Set(parsed.site_relevance?.blacklist_hosts || []),
        strong_negative_keywords: parsed.site_relevance?.strong_negative_keywords || [],
        negative_keywords: parsed.site_relevance?.negative_keywords || [],
        positive_keywords: parsed.site_relevance?.positive_keywords || [],
      },
    };

    return cachedLexicon;
  } catch (e: any) {
    console.error("[Lexicon] Failed to load lexicon.yaml:", e.message);
    throw new Error(`Failed to load lexicon: ${e.message}`);
  }
}