import { loadLexicon } from "../config/lexicon.js";

const LEX = loadLexicon();

const EMAIL_REGEX = /([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi;

// Load from lexicon
const BLOCKED_DOMAIN_SUFFIXES = new Set(LEX.email.blocked_domain_suffixes);
const BLOCKED_EXTENSIONS = LEX.email.blocked_extensions;
const GOOD_PREFIXES = new Set(LEX.email.good_prefixes);
const RESERVED_DOMAINS = new Set(LEX.email.reserved_domains);
const BOUNCE_FAKE_DOMAINS = new Set(LEX.email.bounce_fake_domains);
const PLACEHOLDER_USERS = new Set(LEX.email.placeholder_users);
const FREE_EMAIL_DOMAINS = new Set(LEX.email.free_email_domains);

// Convert pattern strings to RegExp objects
const BLOCKED_USER_PATTERNS: RegExp[] = LEX.email.blocked_user_patterns.map(
  pattern => new RegExp(pattern, 'i')
);

function normalizeEmailText(input: string): string {
  return input
    .replace(/&#64;|&#x40;|&commat;/gi, "@")
    .replace(/&#46;|&#x2e;|&period;/gi, ".")
    .replace(/\s*\(at\)\s*|\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(dot\)\s*|\s*\[dot\]\s*/gi, ".")
    // zero-width junk often appears around emails
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function looksLikeFile(email: string): boolean {
  const lower = email.toLowerCase();
  return BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isBlockedDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (BLOCKED_DOMAIN_SUFFIXES.has(d)) return true;

  // also block subdomains of blocked suffixes
  for (const suf of BLOCKED_DOMAIN_SUFFIXES) {
    if (d.endsWith("." + suf)) return true;
  }
  return false;
}

function looksLikeMachineUser(user: string): boolean {
  return BLOCKED_USER_PATTERNS.some((re) => re.test(user));
}

/**
 * Outreach-safe local-part characters.
 * - RFC allows many more symbols (e.g. % ! ' etc). We intentionally restrict.
 */
function hasOnlyAllowedEmailChars(user: string): boolean {
  return /^[a-z0-9._+-]+$/.test(user);
}

function looksHumanEnough(user: string): boolean {
  if (GOOD_PREFIXES.has(user)) return true;
  if (user.length > 40) return false;

  const digitCount = user.replace(/[^0-9]/g, "").length;
  const digitRatio = user.length ? digitCount / user.length : 1;
  if (digitRatio > 0.4) return false;

  return true;
}

/**
 * Fix cases where phone number tail gets concatenated with email local-part, e.g.:
 * "... (+420) 226 200 150" + "qarta@qarta.cz" => "150qarta@qarta.cz"
 */
function decontaminatePhoneSuffixUser(user: string, domain: string, normalizedText: string): string {
  const u = user.toLowerCase();
  const d = domain.toLowerCase();

  // 3+ digits then a normal-looking username starting with a letter
  const m = u.match(/^(\d{3,})([a-z][a-z0-9._%+-]{1,})$/i);
  if (!m) return u;

  const digitPrefix = m[1];
  const candidateUser = m[2];

  // Candidate must pass the same sanity checks
  if (looksLikeMachineUser(candidateUser)) return u;
  if (!looksHumanEnough(candidateUser)) return u;

  const candidateEmail = `${candidateUser}@${d}`;

  // If the clean email exists anywhere, trust it.
  if (normalizedText.toLowerCase().includes(candidateEmail)) return candidateUser;

  // Otherwise, if the digit prefix is long enough to look like a phone tail, trust stripping.
  if (digitPrefix.length >= 5) return candidateUser;

  return u;
}

function isPlaceholderOrTest(user: string, domain: string): boolean {
  if (RESERVED_DOMAINS.has(domain)) return true;
  if (BOUNCE_FAKE_DOMAINS.has(domain)) return true;

  // example@gmail.com / name.surname@yahoo.com style placeholders
  if (PLACEHOLDER_USERS.has(user) && FREE_EMAIL_DOMAINS.has(domain)) return true;

  return false;
}

function isValidDomain(domain: string): boolean {
  if (!domain.includes(".")) return false;
  // ascii hostname only, strict-ish
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false;
  // avoid leading/trailing dot/dash artifacts
  if (/^[.-]|[.-]$/.test(domain)) return false;
  return true;
}

function isValidUser(user: string): boolean {
  if (!user) return false;

  // strict allowed chars
  if (!hasOnlyAllowedEmailChars(user)) return false;

  // no leading/trailing punctuation
  if (/^[._+-]|[._+-]$/.test(user)) return false;

  // avoid repeated punctuation runs
  if (/[._+-]{2,}/.test(user)) return false;

  // no repeated dots
  if (user.includes("..")) return false;

  if (looksLikeMachineUser(user)) return false;
  if (!looksHumanEnough(user)) return false;

  return true;
}

export function extractEmailsFromText(text: string): string[] {
  const normalized = normalizeEmailText(text);
  const out = new Set<string>();

  EMAIL_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = EMAIL_REGEX.exec(normalized)) !== null) {
    let user = (m[1] || "").toLowerCase();
    const domain = (m[2] || "").toLowerCase();
    if (!user || !domain) continue;

    // fix "150qarta@..." style contamination
    user = decontaminatePhoneSuffixUser(user, domain, normalized);

    // fast rejects
    if (!isValidUser(user)) continue;
    if (!isValidDomain(domain)) continue;
    if (isBlockedDomain(domain)) continue;
    if (isPlaceholderOrTest(user, domain)) continue;

    const email = `${user}@${domain}`;

    if (looksLikeFile(email)) continue;

    out.add(email);
  }

  return [...out];
}
