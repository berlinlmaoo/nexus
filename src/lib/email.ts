import nodemailer from "nodemailer"

const smtpConfigured = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
)

function createTransporter() {
  if (!smtpConfigured) return null
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT!, 10),
    secure: parseInt(process.env.SMTP_PORT!, 10) === 465,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  })
}

const fromAddress = process.env.SMTP_FROM || "NEXUS <noreply@patsgroup.id>"

// ── HTML wrapper ────────────────────────────────────────────────
function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:8px;border:1px solid #e4e4e7;overflow:hidden;">
    <div style="background:#18181b;padding:24px 32px;">
      <h1 style="margin:0;font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px;">NEXUS</h1>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;font-size:16px;font-weight:600;color:#18181b;">${title}</h2>
      ${body}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e4e4e7;text-align:center;">
      <p style="margin:0;font-size:12px;color:#a1a1aa;">NEXUS &mdash; Project & Task System by PATS Group</p>
    </div>
  </div>
</body>
</html>`
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#27272a;">${text}</p>`
}

function button(label: string, url: string): string {
  return `<div style="margin:24px 0;"><a href="${url}" style="display:inline-block;padding:10px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">${label}</a></div>`
}

function metaRow(label: string, value: string): string {
  return `<div style="display:flex;gap:8px;margin-bottom:4px;font-size:13px;">
    <span style="color:#71717a;min-width:80px;">${label}</span>
    <span style="color:#27272a;font-weight:500;">${value}</span>
  </div>`
}

// ── Email templates ─────────────────────────────────────────────

export interface EmailPayload {
  to: string
  subject: string
  html: string
}

const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"

export function taskAssignedEmail(data: {
  recipientName: string
  taskTitle: string
  taskId: string
  projectName: string
  assignedBy: string
}): EmailPayload {
  return {
    to: "",
    subject: `You've been assigned: ${data.taskTitle}`,
    html: wrapHtml(
      "Task Assigned to You",
      paragraph(`Hi ${data.recipientName},`) +
        paragraph(`<strong>${data.assignedBy}</strong> assigned you a task:`) +
        metaRow("Task", data.taskTitle) +
        metaRow("Project", data.projectName) +
        button("View Task", `${baseUrl}/tasks/${data.taskId}`)
    ),
  }
}

export function taskDueSoonEmail(data: {
  recipientName: string
  taskTitle: string
  taskId: string
  dueDate: string
}): EmailPayload {
  return {
    to: "",
    subject: `Due soon: ${data.taskTitle}`,
    html: wrapHtml(
      "Task Due Soon",
      paragraph(`Hi ${data.recipientName},`) +
        paragraph(`Your task <strong>${data.taskTitle}</strong> is due on <strong>${data.dueDate}</strong>.`) +
        button("View Task", `${baseUrl}/tasks/${data.taskId}`)
    ),
  }
}

export function commentMentionEmail(data: {
  recipientName: string
  mentionedBy: string
  taskTitle: string
  taskId: string
  commentSnippet: string
}): EmailPayload {
  return {
    to: "",
    subject: `${data.mentionedBy} mentioned you in ${data.taskTitle}`,
    html: wrapHtml(
      "You Were Mentioned",
      paragraph(`Hi ${data.recipientName},`) +
        paragraph(`<strong>${data.mentionedBy}</strong> mentioned you in a comment on <strong>${data.taskTitle}</strong>:`) +
        `<div style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:6px;border-left:3px solid #18181b;">
          <p style="margin:0;font-size:13px;color:#3f3f46;line-height:1.5;">${data.commentSnippet}</p>
        </div>` +
        button("View Comment", `${baseUrl}/tasks/${data.taskId}`)
    ),
  }
}

export function projectInviteEmail(data: {
  recipientName: string
  projectName: string
  projectId: string
  invitedBy: string
  role: string
}): EmailPayload {
  return {
    to: "",
    subject: `You're invited to ${data.projectName}`,
    html: wrapHtml(
      "Project Invitation",
      paragraph(`Hi ${data.recipientName},`) +
        paragraph(`<strong>${data.invitedBy}</strong> invited you to join the project:`) +
        metaRow("Project", data.projectName) +
        metaRow("Role", data.role) +
        button("Open Project", `${baseUrl}/projects/${data.projectId}`)
    ),
  }
}

export function statusUpdateEmail(data: {
  recipientName: string
  projectName: string
  projectId: string
  status: string
  updatedBy: string
  summary: string
}): EmailPayload {
  return {
    to: "",
    subject: `Status update: ${data.projectName}`,
    html: wrapHtml(
      "Project Status Update",
      paragraph(`Hi ${data.recipientName},`) +
        paragraph(`<strong>${data.updatedBy}</strong> posted a status update for <strong>${data.projectName}</strong>:`) +
        metaRow("Status", data.status) +
        `<div style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:6px;">
          <p style="margin:0;font-size:13px;color:#3f3f46;line-height:1.5;">${data.summary}</p>
        </div>` +
        button("View Project", `${baseUrl}/projects/${data.projectId}`)
    ),
  }
}

// ── Send function ───────────────────────────────────────────────

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const transporter = createTransporter()
  if (!transporter) {
    console.log("[EMAIL] SMTP not configured. Would have sent:", {
      to: payload.to,
      subject: payload.subject,
    })
    return false
  }

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    })
    console.log("[EMAIL] Sent to", payload.to)
    return true
  } catch (error) {
    console.error("[EMAIL] Failed to send:", error)
    return false
  }
}
