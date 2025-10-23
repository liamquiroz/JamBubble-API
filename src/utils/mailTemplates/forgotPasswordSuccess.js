export const resetConfirmMessage = (name = '') => `
    <div style="text-align: center;">
        <img src="https://res.cloudinary.com/db7g8qncw/image/upload/v1756127664/logo_qriv3i.png" alt="Logo" style="width: 64px; margin-bottom: 20px;" />
        <h2 style="font-size: 22px; color: #333;"> Password Change </h2>
            <p style="font-size: 16px; color: #555;">
                Hellow ${name || 'user'}, your password has been successfully reset.
            </p>
            
    </div>

`;