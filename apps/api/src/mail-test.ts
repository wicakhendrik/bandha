/**
 * Sends a test email through the configured SMTP account, to check Microsoft 365 / any SMTP setup without registering anyone:
 *   pnpm --filter @bandha/api mail:test you@example.com
 * Reads MAIL_TRANSPORT, SMTP_URL and MAIL_FROM from the environment (the root .env in development). Prints a plain verdict and,
 * on failure, only the SMTP error code and server reply (never the URL, which contains the password).
 */
import nodemailer from "nodemailer";
import { loadConfig } from "./config";
import { verificationEmail } from "./mailer";

const to = process.argv[2];
if (!to || !/^\S+@\S+\.\S+$/.test(to)) {
  console.error("Usage: pnpm --filter @bandha/api mail:test you@example.com");
  process.exit(2);
}

const config = loadConfig({ ...process.env, NODE_ENV: undefined });
if (config.MAIL_TRANSPORT !== "smtp" || !config.SMTP_URL) {
  console.error("MAIL_TRANSPORT is not 'smtp' (or SMTP_URL is empty), so nothing would be sent. Set both in .env first.");
  process.exit(2);
}

const transport = nodemailer.createTransport(config.SMTP_URL);
try {
  await transport.verify();
  console.log("1/2 connected and signed in to the SMTP server: OK");
  const m = verificationEmail(to, "123456", 10);
  const info = await transport.sendMail({ from: config.MAIL_FROM, to, subject: `[TEST] ${m.subject}`, text: m.text, html: m.html });
  console.log(`2/2 test email accepted by the server (id ${info.messageId}). Check the inbox (and the spam folder) of ${to}.`);
} catch (err) {
  const e = err as { code?: string; responseCode?: number; response?: string; command?: string };
  console.error("FAILED:", [e.code, e.responseCode, e.command].filter(Boolean).join(" "), "\n", e.response ?? "(no server reply)");
  console.error("Hints: 535 5.7.139 / 5.7.3 = SMTP AUTH is off for this mailbox or basic auth is blocked (see docs/EMAIL.md); 553 5.7.1 = MAIL_FROM is not the mailbox or an alias it may send as.");
  process.exit(1);
}
