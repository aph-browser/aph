@echo off
rem Aph Windows launcher — mirrors scripts/dev.py and packaging/AppRun:
rem seed first-run prefs, then run the bundled Firefox with the Aph profile.
setlocal
set "PROFILE=%APPDATA%\Aph\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
rem Seed-once defaults: never overwrite an existing user.js (user edits persist).
if not exist "%PROFILE%\user.js" copy /Y "%~dp0config\user.js" "%PROFILE%\user.js" >nul
rem Seed-once menu accents (dev.py parity): never overwrite user edits.
if not exist "%PROFILE%\chrome" mkdir "%PROFILE%\chrome"
if not exist "%PROFILE%\chrome\userChrome.css" copy /Y "%~dp0config\userChrome.css" "%PROFILE%\chrome\userChrome.css" >nul
rem No --no-remote so external links reuse the running instance.
start "" "%~dp0firefox\firefox.exe" --profile "%PROFILE%" %*
