import dns from "node:dns/promises";
import net from "node:net";

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

const RESERVED_DOMAINS = new Set([
  "example.com", "example.net", "example.org",
  "test", "invalid", "localhost", "local",
]);

const BOUNCE_SEEN_FAKE_DOMAINS = new Set([
  "primer.com",
  "email.com",
  "someplace.studio",
]);

const PLACEHOLDER_USERS = new Set([
  "example",
  "email",
  "name",
  "name.surname",
  "yourname",
  "your.name",
  "your.email",
  "yourname.surname",
]);

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "zoho.com",
]);

// Common disposable email domains
const DISPOSABLE_DOMAINS = new Set([
  "tempmail.com", "throwaway.email", "guerrillamail.com", "10minutemail.com",
  "mailinator.com", "temp-mail.org", "fakeinbox.com", "sharklasers.com",
  "trashmail.com", "yopmail.com", "getnada.com", "maildrop.cc",
]);

// Role-based prefixes (often unmonitored or forwarded)
const ROLE_PREFIXES = [
  "info", "contact", "hello", "support", "sales", "admin", "office",
  "team", "jobs", "careers", "hr", "marketing", "press", "media",
  "noreply", "no-reply", "donotreply", "postmaster", "webmaster",
];

function isPlaceholderEmail(email: string) {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return false;

  const user = e.slice(0, at);
  const domain = e.slice(at + 1);

  if (RESERVED_DOMAINS.has(domain)) return true;
  if (BOUNCE_SEEN_FAKE_DOMAINS.has(domain)) return true;

  // example@gmail.com, email@gmail.com, name.surname@... etc
  if (PLACEHOLDER_USERS.has(user) && (FREE_EMAIL_DOMAINS.has(domain) || domain === "email.com")) {
    return true;
  }

  // also treat "example.*" usernames as suspicious
  if (/^example[\d._-]*$/.test(user) && FREE_EMAIL_DOMAINS.has(domain)) {
    return true;
  }

  return false;
}

function checkSyntax(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return re.test(email.trim().toLowerCase());
}

function isDisposable(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

function isRoleBased(localPart: string): boolean {
  const lower = localPart.toLowerCase();
  return ROLE_PREFIXES.some(prefix => lower === prefix || lower.startsWith(prefix + "."));
}

async function checkMx(domain: string): Promise<{ exists: boolean; records: string[] }> {
  try {
    const records = await dns.resolveMx(domain);
    const sorted = records.sort((a, b) => a.priority - b.priority);
    return { exists: sorted.length > 0, records: sorted.map(r => r.exchange) };
  } catch {
    return { exists: false, records: [] };
  }
}

/**
 * SMTP verification - connects to mail server and checks if recipient exists
 * Note: Some servers always return OK (catch-all), some block this
 */
async function checkSmtp(
  email: string, 
  mxHost: string, 
  timeoutMs = 10000
): Promise<{ valid: boolean | "unknown"; isCatchAll: boolean }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let step = 0;
    let response = "";
    let isCatchAll = false;

    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ valid: "unknown", isCatchAll: false });
    }, timeoutMs);

    socket.on("data", (data) => {
      response = data.toString();
      const code = parseInt(response.substring(0, 3), 10);

      if (step === 0 && code === 220) {
        // Server ready, send HELO
        socket.write("HELO verify.local\r\n");
        step = 1;
      } else if (step === 1 && code === 250) {
        // HELO accepted, send MAIL FROM
        socket.write("MAIL FROM:<verify@verify.local>\r\n");
        step = 2;
      } else if (step === 2 && code === 250) {
        // MAIL FROM accepted, send RCPT TO with real email
        socket.write(`RCPT TO:<${email}>\r\n`);
        step = 3;
      } else if (step === 3) {
        // Check RCPT TO response
        if (code === 250) {
          // Email exists (or catch-all)
          // Test with random address to detect catch-all
          const randomEmail = `test-${Date.now()}@${email.split("@")[1]}`;
          socket.write(`RCPT TO:<${randomEmail}>\r\n`);
          step = 4;
        } else if (code === 550 || code === 551 || code === 552 || code === 553) {
          // User not found
          socket.write("QUIT\r\n");
          clearTimeout(timeout);
          socket.destroy();
          resolve({ valid: false, isCatchAll: false });
        } else {
          socket.write("QUIT\r\n");
          clearTimeout(timeout);
          socket.destroy();
          resolve({ valid: "unknown", isCatchAll: false });
        }
      } else if (step === 4) {
        // Catch-all detection
        if (code === 250) {
          // Random address accepted = catch-all server
          isCatchAll = true;
        }
        socket.write("QUIT\r\n");
        clearTimeout(timeout);
        socket.destroy();
        resolve({ valid: true, isCatchAll });
      }
    });

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve({ valid: "unknown", isCatchAll: false });
    });

    socket.on("close", () => {
      clearTimeout(timeout);
    });

    socket.connect(25, mxHost);
  });
}

export async function validateEmail(
  email: string,
  options: { skipSmtp?: boolean; timeoutMs?: number } = {}
): Promise<EmailValidationResult> {
  const e = email.trim().toLowerCase();
  const [localPart, domain] = e.split("@");

  const result: EmailValidationResult = {
    email: e,
    valid: false,
    checks: {
      syntax: false,
      mxExists: false,
      isDisposable: false,
      isRoleBased: false,
    },
    risk: "high",
  };

  // 1. Syntax check
  result.checks.syntax = checkSyntax(e);
  if (!result.checks.syntax) {
    result.reason = "Invalid email syntax";
    return result;
  }

  // 2. Disposable check
  result.checks.isDisposable = isDisposable(domain);
  if (result.checks.isDisposable) {
    result.reason = "Disposable email domain";
    return result;
  }

  // 3. Role-based check
  result.checks.isRoleBased = isRoleBased(localPart);

  // 4. MX record check
  const mx = await checkMx(domain);
  result.checks.mxExists = mx.exists;
  if (!mx.exists) {
    result.reason = "Domain has no mail server (MX record)";
    return result;
  }

  // 5. SMTP verification (optional, can be slow/blocked)
  if (!options.skipSmtp && mx.records.length > 0) {
    try {
      const smtp = await checkSmtp(e, mx.records[0], options.timeoutMs || 10000);
      result.checks.smtpValid = smtp.valid;
      result.checks.isCatchAll = smtp.isCatchAll;

      if (smtp.valid === false) {
        result.reason = "SMTP verification failed - mailbox doesn't exist";
        return result;
      }
    } catch {
      result.checks.smtpValid = "unknown";
    }
  }

    if (isPlaceholderEmail(email)) {
        return {
            email,
            valid: false,
            checks: {
            syntax: true,
            mxExists: true,
            isDisposable: false,
            isRoleBased: false,
            smtpValid: "unknown",
            isCatchAll: false,
            },
            risk: "high",
            reason: "Placeholder/test email (filtered)",
        };
    }

  // Calculate risk
  result.valid = true;
  
  if (result.checks.smtpValid === false) {
    result.risk = "high";
  } else if (result.checks.isCatchAll || result.checks.smtpValid === "unknown") {
    result.risk = result.checks.isRoleBased ? "medium" : "low";
  } else if (result.checks.isRoleBased) {
    result.risk = "medium";
    result.reason = "Role-based email (may be unmonitored)";
  } else {
    result.risk = "low";
  }

  return result;
}

/**
 * Batch validate emails
 */
export async function validateEmails(
  emails: string[],
  options: { skipSmtp?: boolean; concurrency?: number } = {}
): Promise<EmailValidationResult[]> {
  const concurrency = options.concurrency || 5;
  const results: EmailValidationResult[] = [];
  
  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(e => validateEmail(e, options))
    );
    results.push(...batchResults);
  }
  
  return results;
}