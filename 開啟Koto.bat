@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Koto Server - DO NOT CLOSE
echo.
echo  ========================================
echo   Koto 日語文法筆記本
echo   請保持此視窗開啟！關閉後網站會無法連線
echo   網址: http://127.0.0.1:8765/
echo  ========================================
echo.
start "" "http://127.0.0.1:8765/"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
echo.
echo 伺服器已結束。
pause