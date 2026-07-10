import nodemailer from 'nodemailer'
import { findRoleSettings } from '../models/notificationSettings'
import { findAllUsers } from '../models/user'

// Node-side counterpart to CLI Engine/internal/mailer/mailer.go — same
// fail-soft philosophy: a missing config or failed send is logged and
// swallowed, never thrown, so a notification problem can't break the MCP
// save_analysis flow it's called from.

// Resolves who should receive a notification: every active user whose role
// has notifications enabled in notification_role_settings. Mirrors the Go
// CLI's db.FindEnabledRoles + db.FindActiveUserEmailsByRoles used for audit-
// failure alerts, so both alert types reach the same audience.
export async function resolveNotificationRecipients(): Promise<string[]> {
  const roleSettings = await findRoleSettings()
  const enabledRoles = new Set<string>(roleSettings.filter(r => r.enabled).map(r => r.role))
  const users = await findAllUsers()
  return users
    .filter(u => u.is_active && enabledRoles.has(u.role))
    .map(u => u.email)
}

export async function sendMail(subject: string, html: string, recipients: string[]): Promise<void> {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) {
    console.warn('[mailer] skipped: GMAIL_USER/GMAIL_APP_PASSWORD not set')
    return
  }
  if (recipients.length === 0) {
    console.warn('[mailer] skipped: no notification recipients resolved')
    return
  }

  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  })

  try {
    await transport.sendMail({ from: user, to: recipients, subject, html })
  } catch (e) {
    console.warn('[mailer] failed to send:', e instanceof Error ? e.message : e)
  }
}
