export const welcomeMessage = (name = 'there') => `
    <div style="text-align: center;">
        <img src="https://res.cloudinary.com/db7g8qncw/image/upload/v1756127664/logo_qriv3i.png" alt="Logo" style="width: 64px; margin-bottom: 20px;" />
        <h2 style="font-size: 22px; color: #333;"> Welcome, ${name}! </h2>
        <p style="font-size: 16px; color: #555;">
            Your account has been successfully created. You can now log in and enjoy our services.
        </p>
        <p style="font-size: 14px; color: #999;">
            Thanks for joining us.
        </p>
    </div>
`;