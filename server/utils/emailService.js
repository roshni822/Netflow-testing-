// M3 - Phase 2 - utils/emailService.js
// SMTP transport (Brevo in dev/prod). Every public helper is non-blocking
// (returns a promise) and swallows its own errors via .catch(), except
// sendMail itself which rethrows so critical flows (password reset) can react.

const nodemailer = require('nodemailer')

const SMTP_PORT = Number(process.env.SMTP_PORT) || 587

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: SMTP_PORT,
  // 465 = implicit TLS; 587/2525 = STARTTLS (secure:false + upgrade).
  secure: SMTP_PORT === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

const deliverMail = async ({ to, subject, text, html }) => {
  await transporter.sendMail({
    from: `"${process.env.SENDER_NAME}" <${process.env.SENDER_EMAIL}>`,
    to,
    subject,
    text,
    ...(html ? { html } : {})
  })
  console.log(`Email sent to: ${to}`)
}

const sendMail = async (message) => {
  if (require('../database/layout').organizationSchemas() || require('../database/context').transactions.getStore()) return require('../database/outbox').enqueue('email', message)
  return deliverMail(message)
}

const sendApprovalEmail = ({ to, submitterName, taskTitle, approverName, comment }) => {
  const safeName = submitterName || 'there'
  return sendMail({
    to,
    subject: 'Your request has been approved — NetFlow',
    text:
      `Hi ${safeName},\n\n` +
      `Your request "${taskTitle}" has been approved by ${approverName}.\n\n` +
      `${comment ? `Comment: ${comment}\n\n` : ''}` +
      `Log in to NetFlow to view details.\n\n` +
      `NetFlow Team`,
    html:
      `<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">` +

        `<!-- Body -->` +
        `<div style="padding:24px;">` +
          `<p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#059669;text-transform:uppercase;letter-spacing:0.8px;">Approved</p>` +
          `<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#059669;line-height:1.2;">Your request has been approved.</h1>` +
          `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">Hi ${safeName}, your request has been reviewed and approved.</p>` +

          `<!-- Details Card -->` +
          `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;">` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Request</p>` +
            `<p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#111827;">${taskTitle}</p>` +
            `<div style="height:1px;background:#e5e7eb;margin:0 0 10px;"></div>` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Approved By</p>` +
            `<p style="margin:0${comment ? ' 0 10px' : ';'};font-size:14px;color:#111827;">${approverName}</p>` +
            `${comment
              ? `<div style="height:1px;background:#e5e7eb;margin:0 0 10px;"></div>` +
                `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Comment</p>` +
                `<p style="margin:0;font-size:14px;color:#111827;">${comment}</p>`
              : ''
            }` +
          `</div>` +
        `</div>` +

        `<!-- Footer -->` +
        `<div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:14px 24px;">` +
          `<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">NetFlow Team &nbsp;&bull;&nbsp; This is an automated message.</p>` +
          `<p style="margin:0;font-size:12px;color:#d1d5db;">If you did not expect this email, please ignore it.</p>` +
        `</div>` +

      `</div>`
  }).catch(err => console.error('sendApprovalEmail error:', err.message))
}

const sendRejectionEmail = ({ to, submitterName, taskTitle, approverName, comment }) => {
  const safeName = submitterName || 'there'
  const reason = comment || 'No reason provided'
  return sendMail({
    to,
    subject: 'Your request needs attention — NetFlow',
    text:
      `Hi ${safeName},\n\n` +
      `Your request "${taskTitle}" has been rejected by ${approverName}.\n\n` +
      `Reason: ${reason}\n\n` +
      `Log in to NetFlow for details.\n\n` +
      `NetFlow Team`,
    html:
      `<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">` +

        `<!-- Body -->` +
        `<div style="padding:24px;">` +
          `<p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#dc2626;text-transform:uppercase;letter-spacing:0.8px;">Rejected</p>` +
          `<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#dc2626;line-height:1.2;">Your request needs attention.</h1>` +
          `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">Hi ${safeName}, your request has been reviewed and was not approved.</p>` +

          `<!-- Details Card -->` +
          `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;">` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Request</p>` +
            `<p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#111827;">${taskTitle}</p>` +
            `<div style="height:1px;background:#e5e7eb;margin:0 0 10px;"></div>` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Rejected By</p>` +
            `<p style="margin:0 0 10px;font-size:14px;color:#111827;">${approverName}</p>` +
            `<div style="height:1px;background:#e5e7eb;margin:0 0 10px;"></div>` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Reason</p>` +
            `<p style="margin:0;font-size:14px;color:#111827;">${reason}</p>` +
          `</div>` +
        `</div>` +

        `<!-- Footer -->` +
        `<div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:14px 24px;">` +
          `<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">NetFlow Team &nbsp;&bull;&nbsp; This is an automated message.</p>` +
          `<p style="margin:0;font-size:12px;color:#d1d5db;">If you did not expect this email, please ignore it.</p>` +
        `</div>` +

      `</div>`
  }).catch(err => console.error('sendRejectionEmail error:', err.message))
}

const sendEscalationEmail = ({ to, managerName, taskTitle, originalAssignee, hoursOverdue }) => {
  const safeName = managerName || 'there'
  const appUrl = (process.env.CLIENT_URL || 'https://net-flow-sw.vercel.app').split(',')[0].trim().replace(/\/$/, '')
  return sendMail({
    to,
    subject: 'Approval overdue — action required — NetFlow',
    text:
      `Hi ${safeName},\n\n` +
      `The task "${taskTitle}" assigned to ${originalAssignee} is ${hoursOverdue} hours overdue and has been escalated to you.\n\n` +
      `Please log in to NetFlow to take action.\n\n` +
      `NetFlow Team`,
    html:
      `<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">` +

        `<!-- Body -->` +
        `<div style="padding:24px;">` +
          `<p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.8px;">Action Required</p>` +
          `<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#d97706;line-height:1.2;">Approval overdue.</h1>` +
          `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">Hi ${safeName}, a pending approval has been escalated to you and requires your attention.</p>` +

          `<!-- Details Card -->` +
          `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;">` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Task</p>` +
            `<p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#111827;">${taskTitle}</p>` +
            `<div style="height:1px;background:#e5e7eb;margin:0 0 10px;"></div>` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Originally Assigned To</p>` +
            `<p style="margin:0 0 10px;font-size:14px;color:#111827;">${originalAssignee}</p>` +
            `<div style="height:1px;background:#e5e7eb;margin:0 0 10px;"></div>` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Overdue By</p>` +
            `<p style="margin:0;font-size:14px;color:#d97706;font-weight:600;">${hoursOverdue} hours</p>` +
          `</div>` +

          `<!-- CTA Button -->` +
          `<a href="${appUrl}" style="display:block;margin-top:20px;background:#d97706;color:#ffffff;text-align:center;text-decoration:none;font-size:14px;font-weight:600;padding:12px;border-radius:4px;">Take Action in NetFlow</a>` +
        `</div>` +

        `<!-- Footer -->` +
        `<div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:14px 24px;">` +
          `<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">NetFlow Team &nbsp;&bull;&nbsp; This is an automated message.</p>` +
          `<p style="margin:0;font-size:12px;color:#d1d5db;">If you did not expect this email, please ignore it.</p>` +
        `</div>` +

      `</div>`
  }).catch(err => console.error('sendEscalationEmail error:', err.message))
}

const sendTaskAssignedEmail = ({ to, assigneeName, taskTitle, submittedBy, dueDate, taskId }) => {
  const base = (process.env.CLIENT_URL || 'https://net-flow-sw.vercel.app').split(',')[0].trim().replace(/\/$/, '')
  const taskUrl = `${base}/tasks/${taskId}`
  const safeAssignee = assigneeName || 'there'
  const safeSubmitter = submittedBy || 'System'
  const dueDateStr = dueDate ? new Date(dueDate).toDateString() : 'Not specified'

  return sendMail({
    to,
    subject: 'New task assigned to you — NetFlow',
    text:
      `Hi ${safeAssignee},\n\n` +
      `A new task has been assigned to you.\n\n` +
      `Task: ${taskTitle}\n` +
      `Submitted by: ${safeSubmitter}\n` +
      `Due by: ${dueDateStr}\n\n` +
      `Approve: ${taskUrl}?action=approve\n` +
      `Reject:  ${taskUrl}?action=reject\n\n` +
      `NetFlow Team`,
    html:
      `<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">` +

        `<!-- Body -->` +
        `<div style="padding:24px;">` +
          `<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">New task assigned to you.</h1>` +
          `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">Hi ${safeAssignee}, a new task has been assigned to you in NetFlow.</p>` +

          `<!-- Task Details Card -->` +
          `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;">` +

            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Task</p>` +
            `<p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#111827;">${taskTitle}</p>` +
            `<div style="height:1px;background:#e5e7eb;margin:0 0 10px;"></div>` +

            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Submitted By</p>` +
            `<p style="margin:0 0 10px;font-size:14px;color:#111827;">${safeSubmitter}</p>` +
            `<div style="height:1px;background:#e5e7eb;margin:0 0 10px;"></div>` +

            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Due By</p>` +
            `<p style="margin:0;font-size:14px;color:#111827;">${dueDateStr}</p>` +

          `</div>` +

          `<!-- Action Buttons -->` +
          `<table style="width:100%;border-collapse:collapse;margin-top:20px;">` +
            `<tr>` +
              `<td style="padding-right:6px;">` +
                `<a href="${taskUrl}?action=approve" style="display:block;background:#059669;color:#ffffff;text-align:center;text-decoration:none;font-size:14px;font-weight:600;padding:11px;border-radius:4px;">Approve</a>` +
              `</td>` +
              `<td style="padding-left:6px;">` +
                `<a href="${taskUrl}?action=reject" style="display:block;background:#dc2626;color:#ffffff;text-align:center;text-decoration:none;font-size:14px;font-weight:600;padding:11px;border-radius:4px;">Reject</a>` +
              `</td>` +
            `</tr>` +
          `</table>` +

          `<!-- Secondary Link -->` +
          `<p style="margin:16px 0 0;text-align:center;font-size:13px;">` +
            `<a href="${taskUrl}" style="color:#4f46e5;text-decoration:underline;">Or open task in NetFlow</a>` +
          `</p>` +

        `</div>` +

        `<!-- Footer -->` +
        `<div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:14px 24px;">` +
          `<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">NetFlow Team &nbsp;&bull;&nbsp; This is an automated message.</p>` +
          `<p style="margin:0;font-size:12px;color:#d1d5db;">If you did not expect this email, please ignore it.</p>` +
        `</div>` +

      `</div>`
  }).catch(err => console.error('sendTaskAssignedEmail error:', err.message))
}

// Password reset. Unlike the notification helpers above, this one does NOT
// swallow errors - the caller awaits it so it can log delivery failures while
// still returning a generic response to the client (to avoid email enumeration).
const sendPasswordResetEmail = ({ to, name, resetUrl, expiresMinutes = 30 }) => {
  const safeName = name || 'there'
  return sendMail({
    to,
    subject: 'Reset your NetFlow password',
    text:
      `Hi ${safeName},\n\n` +
      `We received a request to reset your NetFlow password.\n\n` +
      `Reset it using this link (valid for ${expiresMinutes} minutes):\n${resetUrl}\n\n` +
      `If you did not request this, you can safely ignore this email - your password will not change.\n\n` +
      `NetFlow Team`,
    html:
      `<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">` +

        `<!-- Body -->` +
        `<div style="padding:24px;">` +
          `<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">Reset your password.</h1>` +
          `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">` +
            `Hi ${safeName}, we received a request to reset your NetFlow password. Click the button below to proceed.` +
          `</p>` +

          `<!-- Reset Button -->` +
          `<a href="${resetUrl}" style="display:block;background:#4f46e5;color:#ffffff;text-align:center;text-decoration:none;font-size:14px;font-weight:600;padding:12px;border-radius:4px;">Reset Password</a>` +

          
          `<!-- Security Note -->` +
          `<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">` +
            `This link expires in ${expiresMinutes} minutes. If you did not request a password reset, you can safely ignore this email — your password will not change.` +
          `</p>` +
        `</div>` +

        `<!-- Footer -->` +
        `<div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:14px 24px;">` +
          `<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">NetFlow Team &nbsp;&bull;&nbsp; This is an automated message.</p>` +
          `<p style="margin:0;font-size:12px;color:#d1d5db;">If you did not expect this email, please ignore it.</p>` +
        `</div>` +

      `</div>`
  })
}

const sendWelcomeEmail = ({ to, name, tempPassword }) => {
  const safeName = name || 'there'
  const appUrl = (process.env.CLIENT_URL || 'https://net-flow-sw.vercel.app').split(',')[0].trim().replace(/\/$/, '')

  return sendMail({
    to,
    subject: 'Welcome to NetFlow',
    text:
      `Hi ${safeName},\n\n` +
      `Your NetFlow account has been created.\n\n` +
      `Login email: ${to}\n` +
      `${tempPassword ? `Temporary password: ${tempPassword}\n\n` : ''}` +
      `Sign in at ${appUrl} to get started.\n\n` +
      `NetFlow Team`,
    html:
      `<div style="max-width:480px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">` +

        `<!-- Body -->` +
        `<div style="padding:24px;">` +
          `<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">Welcome to NetFlow.</h1>` +
          `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">` +
            `Hi ${safeName}, your account has been created. Use the details below to sign in.` +
          `</p>` +

          `<!-- Credentials Block -->` +
          `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;">` +
            `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Login Email</p>` +
            `<p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#111827;">${to}</p>` +
            `${tempPassword
              ? `<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;">Temporary Password</p>` +
                `<p style="margin:0 0 10px;">` +
                  `<span style="font-family:monospace;font-size:13px;color:#3730a3;background:#eef2ff;padding:3px 8px;border-radius:4px;display:inline-block;">${tempPassword}</span>` +
                `</p>`
              : ''
            }` +
            `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">Please change your password after your first sign-in.</p>` +
          `</div>` +

          `<!-- CTA Button -->` +
          `<a href="${appUrl}" style="display:block;margin-top:20px;background:#4f46e5;color:#ffffff;text-align:center;text-decoration:none;font-size:14px;font-weight:600;padding:12px;border-radius:4px;">Sign In to NetFlow</a>` +
        `</div>` +

        `<!-- Footer -->` +
        `<div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:14px 24px;">` +
          `<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">NetFlow Team &nbsp;&bull;&nbsp; This is an automated message.</p>` +
          `<p style="margin:0;font-size:12px;color:#d1d5db;">If you did not expect this email, please ignore it.</p>` +
        `</div>` +

      `</div>`
  }).catch(err => console.error('sendWelcomeEmail error:', err.message))
}

module.exports = {
  deliverMail,
  sendMail,
  sendApprovalEmail,
  sendRejectionEmail,
  sendEscalationEmail,
  sendTaskAssignedEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail
}
