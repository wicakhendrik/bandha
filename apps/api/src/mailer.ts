import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "./config";

export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer { send(message: MailMessage): Promise<void> }

/**
 * Development only: prints the message instead of sending it, so a reset link can be followed without an SMTP server.
 * The config refuses this transport in production, because a printed link would end up in the logs.
 */
export class ConsoleMailer implements Mailer {
  async send(m: MailMessage): Promise<void> {
    console.log(`\n[mail:dev] To: ${m.to}\n[mail:dev] Subject: ${m.subject}\n${m.text}\n`);
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(m: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
  }
}

export function createMailer(config: Config): Mailer {
  return config.MAIL_TRANSPORT === "smtp" ? new SmtpMailer(config.SMTP_URL!, config.MAIL_FROM) : new ConsoleMailer();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Indonesian first, English below: the API does not know which language the person uses. */
export function resetPasswordEmail(to: string, link: string, minutes: number): MailMessage {
  const subject = "Atur ulang kata sandi Bandha / Reset your Bandha password";
  const text = [
    "Halo,",
    "",
    `Kami menerima permintaan untuk mengatur ulang kata sandi akun Bandha Anda. Buka tautan ini dalam ${minutes} menit:`,
    link,
    "",
    "Jika bukan Anda yang meminta, abaikan email ini. Kata sandi Anda tidak berubah.",
    "",
    "—",
    "",
    "Hello,",
    "",
    `We received a request to reset the password of your Bandha account. Open this link within ${minutes} minutes:`,
    link,
    "",
    "If you did not ask for this, ignore this email. Your password has not changed.",
  ].join("\n");
  const safe = esc(link);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5;color:#2A1A10">
<p>Halo,</p>
<p>Kami menerima permintaan untuk mengatur ulang kata sandi akun Bandha Anda. Tautan berlaku ${minutes} menit.</p>
<p><a href="${safe}" style="display:inline-block;background:#5C3A21;color:#FFF4DC;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Atur ulang kata sandi</a></p>
<p style="font-size:13px;color:#7D6650">Jika bukan Anda yang meminta, abaikan email ini. Kata sandi Anda tidak berubah.</p>
<hr style="border:0;border-top:1px solid #E6D8C3;margin:24px 0">
<p>Hello,</p>
<p>We received a request to reset the password of your Bandha account. The link is valid for ${minutes} minutes.</p>
<p><a href="${safe}" style="color:#5C3A21">Reset password</a></p>
<p style="font-size:13px;color:#7D6650">If you did not ask for this, ignore this email. Your password has not changed.</p>
<p style="font-size:12px;color:#7D6650;word-break:break-all">${safe}</p></div>`;
  return { to, subject, text, html };
}
