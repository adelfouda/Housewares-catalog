@echo off
chcp 65001 >nul
cd /d "%~dp0"
call firebase login
node setup.js
pause
