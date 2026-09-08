@echo off
title AuStudio - Buka Browser untuk Login
cd /d "%~dp0"

node login.js %*

if %errorlevel% neq 0 (
    echo.
    echo Terjadi kesalahan. Tekan tombol apa saja untuk keluar.
    pause >nul
)
