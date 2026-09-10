@echo off
rem Aph Windows launcher — mirrors scripts/dev.py and packaging/AppRun:
rem seed first-run prefs, then run the bundled Firefox with the Aph profile.
setlocal
set "PROFILE=%APPDATA%\Aph\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
rem Seed-once defaults: never overwrite an existing user.js (user edits persist).
if not exist "%PROFILE%\user.js" copy /Y "%~dp0config\user.js" "%PROFILE%\user.js" >nul
rem No --no-remote so external links reuse the running instance.
start "" "%~dp0firefox\firefox.exe" --profile "%PROFILE%" %*
