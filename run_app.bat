@echo off
title 🌾 Krishi MCQ Pro Server Dashboard 🌾
cd /d "%~dp0"
cls

echo ==============================================================
echo           🌾 Krishi MCQ Pro PWA Server Console 🌾
echo ==============================================================
echo.

:: Get the Local IP Address dynamically using Python (Offline-Safe Private IP check)
for /f "delims=" %%i in ('python -c "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect((''10.255.255.255'',1)); print(s.getsockname()[0]); s.close()" 2^>nul') do set LOCAL_IP=%%i
if "%LOCAL_IP%"=="" (
    for /f "delims=" %%i in ('python -c "import socket; print(socket.gethostbyname(socket.gethostname()))" 2^>nul') do set LOCAL_IP=%%i
)
if "%LOCAL_IP%"=="" (set LOCAL_IP=127.0.0.1)

:: Write local IP to ip.json for the Web UI to fetch and render the QR Code
echo {"ip": "%LOCAL_IP%"} > ip.json

:: Check if port 8080 is already active
netstat -ano | findstr :8080 >nul
if %errorlevel% equ 0 (
    echo [STATUS] Local server is already running on port 8080.
) else (
    echo [STATUS] Starting background HTTP server on port 8080...
    start /min "" python -m http.server 8080
    timeout /t 2 /nobreak >nul
)

echo.
echo ==============================================================
echo   PC WEB APP ACCESS URL:
echo   👉 http://localhost:8080/index.html
echo.
echo   MOBILE DEVICE ACCESS URL (Connect to same WiFi/Hotspot):
echo   👉 http://%LOCAL_IP%:8080/index.html
echo.
echo   [PWA Info] Service Worker Caching V3 is active.
echo   Mobile updates will auto-reload when you save PC edits!
echo ==============================================================
echo.
echo   Instructions for Mobile Setup:
echo   1. Make sure your PC is connected to your phone's Hotspot.
echo   2. Open the Mobile Access URL on your phone's browser.
echo   3. Press "Add to Home Screen" to install it as an App!
echo.
echo ==============================================================
echo.
echo Press [Enter] to launch the app on your PC, or leave this window open
echo to keep serving your mobile device.
pause >nul
start "" "http://localhost:8080/index.html"
