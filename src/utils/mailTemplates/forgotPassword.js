export const forgotPasswordMessage = (otp) => `
    <div style="text-align: center;">
        <img src="https://res.cloudinary.com/db7g8qncw/image/upload/v1756127664/logo_qriv3i.png" alt="Logo" style="width: 64px; margin-bottom: 20px;" />
        <h2 style="font-size: 22px color: #333;">
            Reset Your Password
        </h2>
        <p style="font-size:15px; color: #555; margin: 10px auto; max-width: 80%;">
            Use this code below to reset your password.
        </p>
        <div style="background: #f3f3f3; padding: 12px 24px; display: inline-block; font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 20px 0;">
            ${otp}
        </div>
        <p style="font-size: 14px; color: #888;">
            This OTP is valid for 10 minuts. Do not share it with anyone.
        </p>
    </div>
`;
