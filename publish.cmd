@echo off
chcp 65001 >nul
cd /d "%~dp0"
call firebase deploy --only hosting,firestore:rules --non-interactive
echo Site: https://housewares-catalog-adel.web.app
timeout /t 20
