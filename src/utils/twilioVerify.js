import twilio from 'twilio';
import { error, log } from './logger.js';

const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_VERIFY_SERVICE_SID,
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    throw new Error('Missing Twilio Env Ver.');
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

//Required E.164 mobile No
function assertE164(mobileNo) {
    const s = String(mobileNo || '').trim();
    if (!/^\+\d{6,15}$/.test(s)) {
        throw new Error('number Not valid');
        
    }
    return s;
}

function assertEmail(email) {
    const e = String(email || '').trim().toLocaleLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(e)) throw new Error('invalid email');
    return e;
}

// Start Verify (SMS)
export async function startSmsVerification(mobileNo) {
    const to = assertE164(mobileNo);
    const resp = await client.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({to, channel: 'sms'});
    log('Verify sms started', {to, status: resp.status });
    return resp.status;
}

// Start Verify (Email)
export async function startEmailVerification(email) {
    const to = assertEmail(email);
    const resp = await client.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({to, channel: 'email'});
    log('Verify email started', {to, status: resp.status });
    return resp.status;
}

//verify OTP
export async function checkVerificationForTo(to, code) {
    const resp = await client.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({to, code});
    log('verify check', { to, status: resp.status });
    return resp.status === 'approved';
}

//Check SMS than Email
export async function checkSmsThenEmail({ mobileNo, email, code}) {
    const phone = assertE164(mobileNo);

    //SMS
    try {
        if (await checkVerificationForTo(phone, code)) {
            return { ok: true, channel: 'sms'};
        }
    } catch { }

    //Email
    try{
        const mail = assertEmail(email);
        if (await checkVerificationForTo(mail, code)) {
            return { ok: true, channel: 'email' };
        }
    } catch { }
    return { ok: false};
}
