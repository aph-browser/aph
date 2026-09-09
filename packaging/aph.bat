@echo off
rem Aph Windows launcher — mirrors scripts/dev.py and packaging/AppRun:
rem refresh managed prefs, then run the bundled Firefox with the Aph profile.
setlocal
set "PROFILE=%APPDATA%\Aph\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
rem Managed prefs always win (dev.py parity: config copied on every launch).
copy /Y "%~dp0config\user.js" "%PROFILE%\user.js" >nul
rem No --no-remote so external links reuse the running instance.
start "" "%~dp0firefox\firefox.exe" --profile "%PROFILE%" %*
