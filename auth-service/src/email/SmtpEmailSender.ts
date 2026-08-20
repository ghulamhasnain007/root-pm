import nodemailer, { type Transporter } from 'nodemailer'
import type { EmailMessage, EmailSender } from './EmailSender.js'

export class SmtpEmailSender implements EmailSender {
  private transporter: Transporter
  private from: string

  constructor(opts: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
    })
    this.from = opts.from
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text })
  }
}
