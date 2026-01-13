// outreach-backend/src/email/mailer.ts
import nodemailer from "nodemailer";
import fs from "node:fs";

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachmentPath?: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function boolEnv(name: string, fallback: boolean) {
  const v = process.env[name];
  if (v == null) return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function intEnv(name: string, fallback: number) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

let cachedTransport: nodemailer.Transporter | null = null;

function getTransport() {
  if (cachedTransport) return cachedTransport;

  const host = requireEnv("SMTP_HOST");
  const port = intEnv("SMTP_PORT", 587);
  const secure = boolEnv("SMTP_SECURE", port === 465); // true for 465, false for 587 typically

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  return cachedTransport;
}

export async function sendEmail(input: SendMailInput) {
  const transport = getTransport();

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || requireEnv("SMTP_FROM");
  const fromName = process.env.SMTP_FROM_NAME || "";
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const replyTo = process.env.SMTP_USER;

  const attachments: NonNullable<
    nodemailer.SendMailOptions["attachments"]
  > = [];

  if (input.attachmentPath) {
    if (!fs.existsSync(input.attachmentPath)) {
      throw new Error(`Attachment not found: ${input.attachmentPath}`);
    }
    attachments.push({
      filename: input.attachmentPath.split(/[\\/]/).pop() || "attachment",
      path: input.attachmentPath,
    });
  }

  const info = await transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo, 
    attachments: attachments.length ? attachments : undefined,
  });

  return {
    provider: "smtp",
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  };
}

