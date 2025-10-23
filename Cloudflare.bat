@echo off
setlocal

:: Ask for port number
set /p PORT=Enter your local port number (e.g. 3000):

:: Run Cloudflare tunnel
echo Starting Cloudflare Tunnel on port %PORT%...
cloudflared tunnel --url http://localhost:%PORT%

pause