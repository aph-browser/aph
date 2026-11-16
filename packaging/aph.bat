@echo off
rem Aph Windows launcher: run bundled Firefox with Aph's profile.
setlocal
set "PROFILE=%APH_PROFILE%"
if "%PROFILE%"=="" set "PROFILE=%APPDATA%\Aph\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
rem No --no-remote so external links reuse the running instance.
start "" "%~dp0firefox\firefox.exe" --profile "%PROFILE%" %*
goto :eof
