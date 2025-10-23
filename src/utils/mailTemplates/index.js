import { emailWrapper } from './wrapper.js';
import { signupMessage } from './signup.js';
import { forgotPasswordMessage } from './forgotPassword.js';
import { welcomeMessage } from './welcome.js';
import { resetConfirmMessage } from './forgotPasswordSuccess.js';

export const getMailTemplate = (type, payload) => { 
    const { otp, name } = payload || {};
    switch (type) {
        case 'signup':
            return {
                subject: 'Verify Your Account',
                html: emailWrapper(signupMessage(otp)),
            };
        case 'forgot-password':
            return {
                subject: 'Reset Your Password',
                html: emailWrapper(forgotPasswordMessage(otp)),
            };
        case 'welcome':
            return {
                subject: 'Welcome to Our App...',
                html: emailWrapper(welcomeMessage(name)),
            };
        case 'reset-confirm':
                return {
                    subject: 'Your Password Reset',
                    html: emailWrapper(resetConfirmMessage(name)),
                };
        default:
            return{
                subject: 'Your OTP Code',
                html: emailWrapper(`<p> Your OTP is <strong> ${otp}</strong><p>`),
            };

    }
};