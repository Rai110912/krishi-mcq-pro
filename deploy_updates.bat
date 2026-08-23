@echo off
setlocal enabledelayedexpansion
title Krishi MCQ Pro - Advanced OTA Deployer
cd /d "%~dp0"
cls

echo ==============================================================
echo       Krishi MCQ Pro - Advanced OTA Deployer
echo ==============================================================
echo.

echo [1/8] Select Deployment Mode
echo ==================================
echo [1] Preview (Staging Channel)
echo [2] Live (Production)
echo ==================================
set /p deploy_mode="Enter choice (1 or 2): "

if "%deploy_mode%"=="1" (
    set FIREBASE_CMD=firebase hosting:channel:deploy staging
    echo =^> Selected: Staging Preview
) else (
    set FIREBASE_CMD=firebase deploy --only hosting,firestore:rules
    echo =^> Selected: Live Production
)
echo.

echo [2/8] Running JSON Database QA Test...
node qa_test_json.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] JSON Database QA Test Failed! Fix the database before deploying.
    goto error_exit
)
echo.

echo [2.5/8] Running Unit Test Suite (FSRS + Merge Engine)...
call npm test
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Unit tests failed! Deploy aborted.
    goto error_exit
)
echo  =^> All tests passed!
echo.

echo [3/8] Running Syntax Verification...
node -c js\app.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Syntax error detected in app.js! Deploy aborted.
    goto error_exit
)
node -c js\pwa_helpers.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Syntax error detected in pwa_helpers.js! Deploy aborted.
    goto error_exit
)
echo  =^> Syntax Check Passed!
echo.

echo [4/8] Generating Auto Version and Timestamp...
node bump_version.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to bump version! Deploy aborted.
    goto error_exit
)
echo.

echo [5/8] Syncing Assets to www folder...
call node sync-assets.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Asset sync failed! Deploy aborted.
    goto error_exit
)
echo.

echo [6/8] Obfuscating & Minifying Core JS...
call npx.cmd -y terser www\js\app.js -o www\js\app.js -c -m
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Minification failed for app.js! Deploy aborted.
    goto error_exit
)
call npx.cmd -y terser www\js\pwa_helpers.js -o www\js\pwa_helpers.js -c -m
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Minification failed for pwa_helpers.js! Deploy aborted.
    goto error_exit
)
echo  =^> Code Minification Complete!
echo.

echo [7/8] Creating Rollback Backup...
if not exist .backups mkdir .backups
for /f "usebackq" %%I in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"`) do set datetime=%%I
set backup_name=www_backup_!datetime!.zip
powershell -Command "Compress-Archive -Path www\* -DestinationPath .backups\%backup_name% -Force"
echo  =^> Backup saved to .backups\%backup_name%
echo.

echo [8/8] Uploading to Firebase Hosting...
echo ⏳ Please wait, this may take 10-30 seconds. Do not close the window...
set FORCE_COLOR=0
call npx.cmd -y -p firebase-tools !FIREBASE_CMD! > firebase_deploy_log.txt 2>&1
type firebase_deploy_log.txt
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Firebase deploy failed!
    goto error_exit
)
echo.

if "%deploy_mode%"=="1" (
    echo ==============================================================
    echo  🔎 YOUR SECRET PREVIEW LINK IS READY!
    echo ==============================================================
    powershell -Command "$lines = Get-Content firebase_deploy_log.txt; $url = ''; foreach ($line in $lines) { if ($line -match 'Channel URL|Hosting URL|URL:') { $url = [regex]::Match($line, 'https://[a-zA-Z0-9\-\.]+').Value; break; } }; if ($url) { Write-Host ' 🔗 CLICK OR COPY THIS LINK: ' -NoNewline; Write-Host $url -ForegroundColor Cyan -BackgroundColor Black; } else { Write-Host ' [Warning] Could not parse URL from logs.' }"
    echo ==============================================================
    echo.
)

echo [Bonus] Saving to Git Repository...
git add .
git commit -m "Auto-Deploy Backup: %backup_name%"
git push
echo.

echo [Logging] Writing to Deploy History...
echo [%date% %time%] Successfully deployed %backup_name% (Mode: %deploy_mode%) >> deploy_history.txt

echo ==============================================================
echo   LIVE UPDATE DEPLOY COMPLETE!
echo  Your mobile app will receive this update automatically!
echo ==============================================================
pause
exit /b 0

:error_exit
echo.
echo ==============================================================
echo  ❌ [PROCESS FAILED] Deploy terminated due to an error. ❌
echo ==============================================================
pause
exit /b 1
