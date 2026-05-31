@echo off
title 🌾 Krishi MCQ Pro - Android Build Engine 🌾
cls

echo ==============================================================
echo       🌾 Krishi MCQ Pro - Android Compile & Sync 🌾
echo ==============================================================
echo.

:: Ensure we are in the correct directory of the script itself
cd /d "%~dp0"

:: 1. Validate Node.js Environment
echo [1/5] Checking Node.js Environment...
where node >nul 2>nul
if %ERRORLEVEL% equ 0 goto node_ok

:: Try default path fallback
set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if %ERRORLEVEL% equ 0 goto node_ok

echo [ERROR] Node.js is not installed or not in PATH!
echo Please install Node.js from https://nodejs.org/
goto error_exit

:node_ok
echo  - Node.js Version: 
node --version
echo  - NPM Version:
call npm --version

:: 2. Sync Active Web Assets
echo.
echo [2/5] Syncing Active Web Assets to www directory...
node sync-assets.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Asset Synchronization failed!
    goto error_exit
)

:: 3. Validate Java JDK / JAVA_HOME (Diagnostic warning only)
echo.
echo [3/5] Checking JDK Environment...
where javac >nul 2>nul
if %ERRORLEVEL% equ 0 goto jdk_ok

if "%JAVA_HOME%"=="" goto jdk_missing
set "PATH=%JAVA_HOME%\bin;%PATH%"
where javac >nul 2>nul
if %ERRORLEVEL% equ 0 goto jdk_ok

echo  - [WARNING] JAVA_HOME is set, but javac was not found in "%JAVA_HOME%\bin".
goto jdk_done

:jdk_missing
echo  - [WARNING] Java Compiler (javac) not found in PATH and JAVA_HOME is not set.
echo             (Note: Android Studio will use its internal embedded JDK to build).
goto jdk_done

:jdk_ok
echo  - Java Compiler Version:
javac -version
if not "%JAVA_HOME%"=="" echo  - JAVA_HOME Location: %JAVA_HOME%

:jdk_done

:: 4. Check Android SDK Location
echo.
echo [4/5] Checking Android SDK Environment...
if not "%ANDROID_HOME%"=="" (
    echo  - Android SDK Location: %ANDROID_HOME%
    goto sdk_done
)
if not "%ANDROID_SDK_ROOT%"=="" (
    echo  - Android SDK Location: %ANDROID_SDK_ROOT%
    goto sdk_done
)
echo [WARNING] ANDROID_HOME variable is not set!
echo           Android Studio might fail to compile if Android SDK path is not configured.

:sdk_done

:: 5. Capacitor Sync
echo.
echo [5/5] Syncing Assets to Capacitor Android Project...
call npx.cmd cap sync android
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Capacitor sync failed!
    echo Please run 'npm install' in this folder and try again.
    goto error_exit
)

:: 6. Open Android Studio
echo.
echo [6/5] Launching Android Studio...
call npx.cmd cap open android
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to automatically open Android Studio!
    echo Please open Android Studio manually and open the "android" folder.
)

echo.
echo ==============================================================
echo  🎉 COMPILE & SYNC COMPLETE! 🎉
echo  
echo  Next Steps in Android Studio:
echo    1. Wait for gradle sync to finish (at the bottom right).
echo    2. Go to: Build > Build Bundle(s) / APK(s) > Build APK(s)
echo    3. The freshly compiled APK with the new layout will be here:
echo       android\app\build\outputs\apk\debug\app-debug.apk
echo ==============================================================
pause
exit /b 0

:error_exit
echo.
echo [PROCESS FAILED] Build terminated due to an error.
pause
exit /b 1
