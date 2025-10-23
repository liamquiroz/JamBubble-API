import sgMail from '@sendgrid/mail';
import { log } from './logger.js';
import { getMailTemplate } from './mailTemplates/index.js';

const { SENDGRID_API_KEY, SENDGRID_FROM_EMAIL} = process.env;

if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL) {
    throw new Error('Missing SendGrid Env Var');
}

sgMail.setApiKey(SENDGRID_API_KEY);

function joinName(a, b) {
    const s = [a, b].filter(Boolean).join(' ').trim();
    return s || undefined;
}

export async function sendFromTemplate(type, to, payload = {}) {
    const { subject, html } = getMailTemplate(type, payload);
    const msg = { to, from: SENDGRID_FROM_EMAIL, subject, html };
    const [resp] = await sgMail.send(msg);
    log('Mail sent', {to, type, subject, status: resp.statusCode });
    return resp;
}

export async function sendOtpMail(to, otpOrNull, type, extra = {} ) {
    const computed = joinName(extra.fName, extra.lName);
    const name = extra.name ?? computed;

        return sendFromTemplate(type, to, { otp: otpOrNull ?? undefined, name, ...extra });
}

export async function sendWelcomeMail(to, {name, fName, lName} ={}) {
    const computed = joinName(fName, lName);
    const full = name ?? computed;
    return sendFromTemplate('welcome', to, {name: full});
}