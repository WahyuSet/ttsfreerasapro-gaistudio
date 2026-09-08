@echo off
title AuStudio - Gemini TTS REST API Server
cd /d "%~dp0"

echo =====================================================================
echo    🚀 AuStudio - Gemini 2.5 Pro TTS REST API Server
echo    🛡️  Stealth Browser Engine + Auto-Chunking + API Key Auth
echo =====================================================================
echo.
echo Menjalankan server...
echo.

node src/server.js

if %errorlevel% neq 0 (
    echo.
    echo [!] Server berhenti atau terjadi kendala.
    pause
)
