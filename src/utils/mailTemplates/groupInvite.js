export function groupInvite({ groupName, inviteUrl, inviterName }) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>You're invited to join ${groupName}</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f9f9f9; margin:0; padding:20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:auto; background:#ffffff; border-radius:8px; overflow:hidden;">
      <tr>
        <td style="padding:24px; text-align:center; background:#111111;">
          <h1 style="color:#ffffff; margin:0; font-size:22px;">JamBubble</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px; color:#333333;">
          <h2 style="margin-top:0;">You’re invited!</h2>
          <p>You have been invited by ${inviterName} to join <b>${groupName}</b> on JamBubble.</p>
          <p style="margin:24px 0; text-align:center;">
            <a href="${inviteUrl}"
               style="display:inline-block; background:#007bff; color:#ffffff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:bold;">
              Join Group
            </a>
          </p>
          <p>If the button doesn’t work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color:#007bff;">${inviteUrl}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px; font-size:12px; color:#888888; text-align:center;">
          © ${new Date().getFullYear()} JamBubble. All rights reserved.
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}
