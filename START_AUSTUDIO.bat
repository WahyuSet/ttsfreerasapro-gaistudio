@echo off
title AuStudio Playwright - Stealth Recorder
cd /d "%~dp0"

echo =====================================================================
echo    🚀 AuStudio Playwright - Stealth Recorder
echo    🛡️  Google Chrome Windows + Anti-Bot Detection Bypass
echo =====================================================================
echo.
echo Menyiapkan server studio...
echo Jendela browser akan otomatis terbuka di http://localhost:3001 dalam 2 detik.
echo.

:: Buka browser secara otomatis setelah delay 2 detik
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"

:: Jalankan server Node.js
npm start

if %errorlevel% neq 0 (
    echo.
    echo [!] Terjadi kendala saat menjalankan server.
    pause
)
