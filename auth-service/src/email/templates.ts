import type { EmailMessage } from './EmailSender.js'

export function verificationEmail(opts: { to: string; orgName: string; verifyUrl: string }): EmailMessage {
  return {
    to: opts.to,
    subject: `Verify your email to activate ${opts.orgName} on Root-PM`,
    text: `Welcome to Root-PM. Click the link below to verify your email and activate your organization:\n\n${opts.verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Welcome to Root-PM.</p><p><a href="${opts.verifyUrl}">Click here to verify your email</a> and activate your organization.</p><p>This link expires in 24 hours.</p>`,
  }
}

export function inviteEmail(opts: { to: string; orgName: string; inviterName: string; role: string; acceptUrl: string }): EmailMessage {
  return {
    to: opts.to,
    subject: `${opts.inviterName} invited you to join ${opts.orgName} on Root-PM`,
    text: `${opts.inviterName} has invited you to join ${opts.orgName} as ${opts.role}.\n\nAccept the invite:\n${opts.acceptUrl}\n\nThis link expires in 7 days.`,
    html: `<p>${opts.inviterName} has invited you to join <strong>${opts.orgName}</strong> as <strong>${opts.role}</strong>.</p><p><a href="${opts.acceptUrl}">Accept the invite</a></p><p>This link expires in 7 days.</p>`,
  }
}
