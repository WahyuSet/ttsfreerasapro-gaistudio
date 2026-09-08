@echo off
title AuStudio - Restart Server Service
cd /d "%~dp0"

echo =====================================================================
echo    🔄 AuStudio - Restarting Gemini TTS Service
echo =====================================================================
echo.

set PORT=3001
if exist .env (
    for /f "tokens=1,2 delims==" %%A in (.env) do (
        if "%%A"=="PORT" set PORT=%%B
    )
)

echo [1/3] Menghentikan proses server yang sedang berjalan pada port %PORT%...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% "') do (
    if not "%%a"=="0" (
        echo     -> Menghentikan PID %%a yang menggunakan port %PORT%...
        taskkill /f /pid %%a >nul 2>&1
    )
)

timeout /t 1 /nobreak >nul

echo.
echo [2/3] Memastikan port %PORT% telah bebas...
timeout /t 1 /nobreak >nul

echo.
echo [3/3] Menjalankan kembali AuStudio Server...
echo =====================================================================
echo    🌐 Dashboard : http://localhost:%PORT%
echo =====================================================================
echo.

node src/server.js

if %errorlevel% neq 0 (
    echo.
    echo [!] Server berhenti atau terjadi kendala.
    pause
)
