import twilio from "twilio";

let client;
export function initTwilio() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
}

export async function sendInviteSms({ to, inviteUrl, inviterName }) {
  if (!client) initTwilio();
  const { TWILIO_MESSAGING_SERVICE_SID } = process.env;
  return client.messages.create({
    to,
    messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
    body: `${inviterName} Invited to join Jambubble Tap to join: ${inviteUrl}`,
  });
}
