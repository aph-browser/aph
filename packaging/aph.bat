@echo off
rem Aph Windows launcher — mirrors packaging/seed-profile.sh line-for-line
rem (scripts/dev.py is the Python equivalent): seed first-run prefs once,
rem never overwrite user edits, then run the bundled Firefox with Aph's profile.
setlocal
set "PROFILE=%APH_PROFILE%"
if "%PROFILE%"=="" set "PROFILE=%APPDATA%\Aph\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
rem Seed-once defaults: never overwrite an existing user.js (user edits persist).
if not exist "%PROFILE%\user.js" copy /Y "%~dp0config\user.js" "%PROFILE%\user.js" >nul
rem Seed-once menu accents: never overwrite user edits.
if not exist "%PROFILE%\chrome" mkdir "%PROFILE%\chrome"
if not exist "%PROFILE%\chrome\userChrome.css" copy /Y "%~dp0config\userChrome.css" "%PROFILE%\chrome\userChrome.css" >nul
rem Seed-once new-tab backdrop: never overwrite user edits.
if not exist "%PROFILE%\chrome\userContent.css" copy /Y "%~dp0config\userContent.css" "%PROFILE%\chrome\userContent.css" >nul
rem No --no-remote so external links reuse the running instance.
start "" "%~dp0firefox\firefox.exe" --profile "%PROFILE%" %*
