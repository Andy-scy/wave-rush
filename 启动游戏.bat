@echo off
title WAVE RUSH - Jet Ski Racing
cd /d "%~dp0"
echo ================================================
echo   WAVE RUSH - starting local server...
echo   Browser will open at http://localhost:8080
echo   Phones on the same WiFi: http://^<PC-IP^>:8080
echo   Close this window to stop the server.
echo ================================================
rem Prefer the bundled portable Node (tools\), fall back to system Node.
set "NODE_EXE=tools\node-v22.14.0-win-x64\node.exe"
if not exist "%NODE_EXE%" (
  set "NODE_EXE=node"
)
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8080"
%NODE_EXE% server.mjs
pause
