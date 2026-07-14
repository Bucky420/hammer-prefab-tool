@echo off
cd /d "%~dp0"
start "Hammer Prefab Tool Dev" cmd /k "npm.cmd run dev"
timeout /t 3 /nobreak >nul
start "" http://localhost:8787
