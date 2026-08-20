export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>
}

/**
 * Default sender — logs the email instead of sending it. This is what runs
 * out of the box with no SMTP configured, consistent with the rest of this
 * codebase's "degrade gracefully instead of hard-failing on missing infra"
 * pattern (see agent-bridge's ChannelMemoryStore fallback). Verification
 * and invite links are printed to stdout so local dev/testing works without
 * provisioning a real email provider.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<void> {
    console.log(`\n─── [dev email] ───────────────────────────────`)
    console.log(`To:      ${msg.to}`)
    console.log(`Subject: ${msg.subject}`)
    console.log(msg.text)
    console.log(`───────────────────────────────────────────────\n`)
  }
}
