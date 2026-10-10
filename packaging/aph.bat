@echo off
rem Aph Windows launcher — mirrors packaging/seed-profile.sh line-for-line
rem (scripts/dev.py is the Python equivalent): seed first-run prefs once,
rem never overwrite user edits (chrome CSS migrates with a .bak backup when
rem the bundled aph-seed-version stamp is newer), then run the bundled
rem Firefox with Aph's profile.
setlocal
set "PROFILE=%APH_PROFILE%"
if "%PROFILE%"=="" set "PROFILE=%APPDATA%\Aph\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
rem Seed-once defaults: never overwrite an existing user.js (user edits persist).
if not exist "%PROFILE%\user.js" copy /Y "%~dp0config\user.js" "%PROFILE%\user.js" >nul
rem Versioned chrome seeds: copy once, migrate with .bak when bundled is newer.
if not exist "%PROFILE%\chrome" mkdir "%PROFILE%\chrome"
call :seed_chrome "%~dp0config\userChrome.css" "%PROFILE%\chrome\userChrome.css"
call :seed_chrome "%~dp0config\userContent.css" "%PROFILE%\chrome\userContent.css"
rem No --no-remote so external links reuse the running instance.
start "" "%~dp0firefox\firefox.exe" --profile "%PROFILE%" %*
goto :eof

:seed_chrome
rem %1 source, %2 destination — copy once; back up to .bak and re-copy
rem when the bundled aph-seed-version stamp is newer than the profile copy.
rem Same version never overwrites user edits.
set "src=%~1"
set "dst=%~2"
if not exist "%src%" exit /b 0
if not exist "%dst%" (copy /Y "%src%" "%dst%" >nul & exit /b 0)
call :seed_ver "%src%" srcver
call :seed_ver "%dst%" dstver
if %srcver% GTR %dstver% (
  copy /Y "%dst%" "%dst%.bak" >nul
  copy /Y "%src%" "%dst%" >nul
)
exit /b 0

:seed_ver
rem %1 file, %2 var — set %2 to the aph-seed-version stamp, or 0 when absent.
set "%~2=0"
for /f "tokens=3" %%v in ('findstr /r /c:"aph-seed-version: [0-9][0-9]*" "%~1" 2^>nul') do set "%~2=%%v"
exit /b 0
