@echo off
title AuStudio - Test REST API Jobs Gemini TTS
cd /d "%~dp0"

echo =====================================================================
echo    🚀 AuStudio - Test Gemini TTS (Langsung Hit REST API)
echo    Menguji endpoint /api/tts/jobs via HTTP:
echo    - Voice: Achernar
echo    - Style: Vocal Smile
echo    - Pace: Natural
echo    - Accent: Neutral
echo =====================================================================
echo.

node test/hit-tts-api.js

echo.
pause
