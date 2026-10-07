@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\commit-push.ps1"
set "publishExitCode=%errorlevel%"
echo.
pause
exit /b %publishExitCode%
