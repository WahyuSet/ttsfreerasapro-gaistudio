@echo off
title AuStudio - Rekam Langkah Playwright (Chrome Stealth)
cd /d "%~dp0"

node cli.js

if %errorlevel% neq 0 (
    echo.
    echo Terjadi kesalahan. Tekan tombol apa saja untuk keluar.
    pause >nul
)
