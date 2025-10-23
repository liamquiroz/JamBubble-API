export const emailWrapper = (bodyHtml) => `
        <div style="font-family: Arial, sans-serif; Background: #f4f4f4; padding: 40px;">
            <div style="max-width: 500px; background: white; margin: auto; border-radius: 10px; padding: 30px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
                ${bodyHtml}
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee" />
                <p style="font-size: 12px; color: #aaa; text-align: center;">
                    You're receiving this mail because you signed up or made a request on aur app.<br/>
                        If this wasn't you, no worries just ignore it.
                </p>
            </div>
        </div>

`;