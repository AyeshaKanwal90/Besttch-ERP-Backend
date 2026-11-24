import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      ...(env.smtp.user ? { auth: { user: env.smtp.user, pass: env.smtp.pass } } : {}),
    });
  }
  return transporter;
}

/**
 * Sends an email over SMTP. When SMTP_HOST isn't configured (local dev)
 * the message is printed to the server console instead, so flows like
 * password reset can still be tested end to end.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!env.smtp.host) {
    console.log(
      [
        "",
        "──────── Email (SMTP not configured, not sent) ────────",
        `From:    ${env.mailFrom}`,
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "───────────────────────────────────────────────────────",
        "",
      ].join("\n")
    );
    return;
  }

  await getTransporter().sendMail({ from: env.mailFrom, ...message });
}
