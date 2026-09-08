@echo off
title AuStudio Playwright - Rekam Cepat (CLI)
cd /d "%~dp0"

echo =====================================================================
echo    🔴 AuStudio Playwright - Rekam Cepat (Mode CLI)
echo    🛡️  Google Chrome Windows + Anti-Bot Protection
echo =====================================================================
echo.
set /p TARGET_URL="Masukkan URL web target (Tekan ENTER untuk https://bot.sannysoft.com): "
if "%TARGET_URL%"=="" set TARGET_URL=https://bot.sannysoft.com

set /p SESSION_NAME="Masukkan nama sesi (Tekan ENTER untuk nama otomatis): "

echo.
echo Membuka Chrome Windows...
if "%SESSION_NAME%"=="" (
    node cli.js "%TARGET_URL%"
) else (
    node cli.js "%TARGET_URL%" "%SESSION_NAME%"
)

echo.
echo =====================================================================
echo Selesai! Script hasil rekaman tersimpan di folder recordings\
echo =====================================================================
pause
