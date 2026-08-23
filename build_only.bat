@echo off
setlocal enabledelayedexpansion
title Krishi MCQ Pro - Build Only (No Deploy)
cd /d "%~dp0"
cls

echo ==============================================================
echo    Krishi MCQ Pro - BUILD ONLY (www refresh, no deploy)
echo ==============================================================
echo.

echo [1/5] Syntax Verification...
node --check js\app.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Syntax error in app.js! Build aborted.
    exit /b 1
)
node --check js\pwa_helpers.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Syntax error in pwa_helpers.js! Build aborted.
    exit /b 1
)
node --check js\sqlite_db.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Syntax error in sqlite_db.js! Build aborted.
    exit /b 1
)
echo  =^> Syntax OK!
echo.

echo [2/5] Bumping Version + Cache Tokens...
call node bump_version.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Version bump failed!
    exit /b 1
)
echo.

echo [3/5] Syncing Assets root -^> www...
call node sync-assets.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Asset sync failed!
    exit /b 1
)
echo.

echo [4/5] Minifying Core JS (www only)...
call npx.cmd -y terser www\js\app.js -o www\js\app.js -c -m
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Minification failed for app.js!
    exit /b 1
)
call npx.cmd -y terser www\js\pwa_helpers.js -o www\js\pwa_helpers.js -c -m
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Minification failed for pwa_helpers.js!
    exit /b 1
)
echo  =^> Minified!
echo.

echo [5/5] Rollback Backup...
if not exist .backups mkdir .backups
for /f "usebackq" %%I in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"`) do set datetime=%%I
powershell -Command "Compress-Archive -Path www\* -DestinationPath .backups\www_build_!datetime!.zip -Force"
echo  =^> Backup: .backups\www_build_!datetime!.zip
echo.

echo ==============================================================
echo   BUILD COMPLETE! www/ is ready.
echo   Test locally: any static server on www/
echo   Deploy when ready: deploy_updates.bat
echo ==============================================================
pause
exit /b 0
