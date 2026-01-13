import { loadLexicon } from "../config/lexicon.js";

const LEX = loadLexicon();

export function normalizeEmailText(input: string): string {
  return input
    .replace(/&#64;|&#x40;|&commat;/gi, "@")
    .replace(/&#46;|&#x2e;|&period;/gi, ".")
    .replace(/\s*\(at\)\s*|\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(dot\)\s*|\s*\[dot\]\s*/gi, ".")
    .replace(/\s*\(ät\)\s*|\s*\[ät\]\s*/gi, "@")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

export function trimEmailPunctuation(email: string): string {
  return email.replace(/^[.,;:!?]+|[.,;:!?]+$/g, "");
}

export function isSyntaxValid(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return re.test(email.trim().toLowerCase());
}

export function splitEmail(email: string): { user: string; domain: string } | null {
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  return { user: parts[0], domain: parts[1] };
}

export function isLocalPartOutreachSafe(user: string): boolean {
  // Only allow alphanumeric, dot, underscore, hyphen, plus
  if (!/^[a-z0-9._+-]+$/.test(user)) return false;
  
  // No leading/trailing punctuation
  if (/^[._+-]|[._+-]$/.test(user)) return false;
  
  // No repeated punctuation
  if (/[._+-]{2,}/.test(user)) return false;
  
  // No repeated dots
  if (user.includes("..")) return false;
  
  // Length check
  if (user.length > 40) return false;
  
  // Digit ratio check (avoid IDs)
  const digitCount = user.replace(/[^0-9]/g, "").length;
  const digitRatio = user.length ? digitCount / user.length : 1;
  if (digitRatio > 0.4) return false;
  
  return true;
}

export function isDisposableDomain(domain: string): boolean {
  // You might want to use a npm package like 'disposable-email-domains' here
  // For now, just return false
  return false;
}

export function isBlockedByLexicon(domain: string): { blocked: boolean; reason?: string } {
  const d = domain.toLowerCase();
  
  if (LEX.email.blocked_domain_suffixes.includes(d)) {
    return { blocked: true, reason: "blocked_suffix" };
  }
  
  for (const suffix of LEX.email.blocked_domain_suffixes) {
    if (d.endsWith("." + suffix)) {
      return { blocked: true, reason: `subdomain_of_${suffix}` };
    }
  }
  
  return { blocked: false };
}

export function isPlaceholderEmail(email: string): { yes: boolean; reason?: string } {
  const e = email.trim().toLowerCase();
  const parts = splitEmail(e);
  if (!parts) return { yes: false };
  
  const { user, domain } = parts;
  
  if (LEX.email.reserved_domains.includes(domain)) {
    return { yes: true, reason: "reserved_domain" };
  }
  
  if (LEX.email.bounce_fake_domains.includes(domain)) {
    return { yes: true, reason: "fake_domain" };
  }
  
  if (LEX.email.placeholder_users.includes(user) && LEX.email.free_email_domains.includes(domain)) {
    return { yes: true, reason: "placeholder_user_on_free_domain" };
  }
  
  return { yes: false };
}

export function decontaminatePhoneTail(email: string, fullText: string): string {
  const parts = splitEmail(email);
  if (!parts) return email;
  
  const { user, domain } = parts;
  
  // Match: 3+ digits then normal username starting with letter
  const m = user.match(/^(\d{3,})([a-z][a-z0-9._%+-]{1,})$/i);
  if (!m) return email;
  
  const digitPrefix = m[1];
  const candidateUser = m[2];
  
  // Validate candidate
  if (!isLocalPartOutreachSafe(candidateUser)) return email;
  
  const candidateEmail = `${candidateUser}@${domain}`;
  
  // If clean email exists in text, use it
  if (fullText.toLowerCase().includes(candidateEmail)) {
    return candidateEmail;
  }
  
  // If digit prefix looks like phone tail, strip it
  if (digitPrefix.length >= 5) {
    return candidateEmail;
  }
  
  return email;
}