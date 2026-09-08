@echo off
title AuStudio - Test REST API Jobs Gemini TTS
cd /d "%~dp0"

echo =====================================================================
echo    🚀 AuStudio - Test REST API Jobs Gemini TTS
echo    Menguji endpoint /api/tts/jobs via HTTP dengan Voice Settings:
echo    - Voice: Achernar
echo    - Style: Vocal Smile
echo    - Pace: Natural
echo    - Accent: Neutral
echo =====================================================================
echo.

node test/hit-tts-api.js

echo.
pause
