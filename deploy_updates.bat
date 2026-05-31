@echo off
title 🚀 Krishi MCQ Pro - Live Update Deployer 🚀
cd /d "%~dp0"
cls

echo ==============================================================
echo       🚀 Krishi MCQ Pro - Live OTA Update Deployer 🚀
echo ==============================================================
echo.
echo  [STATUS] Building assets and deploying to Firebase...
echo.

call node sync-assets.js
if %ERRORLEVEL% neq 0 goto error_exit

echo.
echo  [STATUS] Uploading to Firebase Hosting...
echo.
call npx.cmd -y -p firebase-tools firebase deploy --only hosting
if %ERRORLEVEL% neq 0 goto error_exit

echo.
echo ==============================================================
echo  🎉 LIVE UPDATE DEPLOY COMPLETE! 🎉
echo  Your mobile app will receive this update automatically!
echo ==============================================================
pause
exit /b 0

:error_exit
echo.
echo [PROCESS FAILED] Deploy terminated due to an error.
pause
exit /b 1
