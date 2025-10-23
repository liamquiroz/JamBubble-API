import sg from "@sendgrid/mail";
import { groupInvite } from "../utils/mailTemplates/groupInvite.js";

let initialized = false;
export function initSendGrid() {
  if (!initialized && process.env.SENDGRID_API_KEY) {
    sg.setApiKey(process.env.SENDGRID_API_KEY);
    initialized = true;
  }
}

export async function sendInviteEmail({ to, inviteUrl, groupName = "Group", inviterName }) {
  if (!initialized) initSendGrid();

  const from = {
    email: process.env.SENDGRID_FROM_EMAIL,
    name: process.env.SENDGRID_FROM_NAME,
  };

  const msg = {
    to,
    from,
    subject: `join Jambubble with ${inviterName}`,
    html: groupInvite({ inviterName, inviteUrl, groupName}),
  };

  return sg.send(msg);
}
