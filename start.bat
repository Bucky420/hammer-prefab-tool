@echo off
cd /d "%~dp0"
start "Hammer Prefab Tool" cmd /c "node server.js"
timeout /t 1 /nobreak >nul
if exist "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" (
  start "" "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" http://localhost:8787
) else (
  start "" http://localhost:8787
)
