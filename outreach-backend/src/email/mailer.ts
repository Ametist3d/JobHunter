import FormData from "form-data";
import fs from "fs";
import fetch from "node-fetch";

// Mailgun config
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const MAILGUN_API_KEY = process.env.MAILGUN_API_PASS;
const MAILGUN_FROM = process.env.MAILGUN_FROM || `postmaster@${MAILGUN_DOMAIN}`;

// Brevo config (fallback)
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL || "noreply@threedex.ai";
const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME || "Threedex Studio";

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachmentPath?: string;
};

// Track if Mailgun limit was hit this session
let mailgunLimitHit = false;

async function sendViaMailgun(input: SendMailInput) {
  if (!MAILGUN_DOMAIN || !MAILGUN_API_KEY) {
    throw new Error("Mailgun env vars missing");
  }

  const form = new FormData();
  form.append("from", MAILGUN_FROM);
  form.append("to", input.to);
  form.append("subject", input.subject);

  if (input.html) {
    form.append("html", input.html);
  } else {
    form.append("text", input.text);
  }

  if (input.attachmentPath && fs.existsSync(input.attachmentPath)) {
    form.append("attachment", fs.createReadStream(input.attachmentPath));
  }

  form.append("o:tracking", "no");
  form.append("o:tracking-clicks", "no");
  form.append("o:tracking-opens", "yes");

  const res = await fetch(
    `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64"),
      },
      body: form as any,
    }
  );

  const bodyText = await res.text();

  // Check for daily limit error
  if (!res.ok) {
    const isLimitError =
      res.status === 429 ||
      bodyText.toLowerCase().includes("limit") ||
      bodyText.toLowerCase().includes("quota");

    if (isLimitError) {
      mailgunLimitHit = true;
      throw new Error("MAILGUN_LIMIT_REACHED");
    }
    throw new Error(`Mailgun error ${res.status}: ${bodyText}`);
  }

  try {
    return { ...JSON.parse(bodyText), provider: "mailgun" };
  } catch {
    return { message: bodyText, provider: "mailgun" };
  }
}

async function sendViaBrevo(input: SendMailInput) {
  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY missing");
  }

  const payload: any = {
    sender: { name: BREVO_FROM_NAME, email: BREVO_FROM_EMAIL },
    to: [{ email: input.to }],
    subject: input.subject,
  };

  if (input.html) {
    payload.htmlContent = input.html;
  } else {
    payload.textContent = input.text;
  }

  // Brevo attachments require base64
  if (input.attachmentPath && fs.existsSync(input.attachmentPath)) {
    const content = fs.readFileSync(input.attachmentPath);
    const filename = input.attachmentPath.split("/").pop() || "attachment";
    payload.attachment = [{ content: content.toString("base64"), name: filename }];
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(`Brevo error ${res.status}: ${bodyText}`);
  }

  try {
    return { ...JSON.parse(bodyText), provider: "brevo" };
  } catch {
    return { message: bodyText, provider: "brevo" };
  }
}

export async function sendEmail(input: SendMailInput) {
  // If Mailgun limit already hit this session, go straight to Brevo
  if (mailgunLimitHit && BREVO_API_KEY) {
    console.log("[Mailer] Using Brevo (Mailgun limit previously hit)");
    return sendViaBrevo(input);
  }

  // Try Mailgun first (if configured)
  if (MAILGUN_DOMAIN && MAILGUN_API_KEY) {
    try {
      return await sendViaMailgun(input);
    } catch (e: any) {
      if (e.message === "MAILGUN_LIMIT_REACHED" && BREVO_API_KEY) {
        console.log("[Mailer] Mailgun limit reached, falling back to Brevo");
        return sendViaBrevo(input);
      }
      throw e;
    }
  }

  // Fallback to Brevo if Mailgun not configured
  if (BREVO_API_KEY) {
    return sendViaBrevo(input);
  }

  throw new Error("No email provider configured (need MAILGUN or BREVO)");
}