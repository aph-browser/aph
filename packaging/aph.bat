@echo off
rem Aph Windows launcher: run bundled Firefox with Aph's profile.
setlocal
set "PROFILE=%APH_PROFILE%"
if "%PROFILE%"=="" set "PROFILE=%APPDATA%\Aph\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"

set "EXTRA="
set "OMNI=%~dp0firefox\browser\omni.ja"
set "STAMP_FILE=%PROFILE%\.aph-omni-stamp"
if exist "%OMNI%" (
  for %%A in ("%OMNI%") do set "CUR_STAMP=%%~tA-%%~zA"
  set "PREV_STAMP="
  if exist "%STAMP_FILE%" set /p PREV_STAMP=<"%STAMP_FILE%"
  if not "%CUR_STAMP%"=="%PREV_STAMP%" (
    set "EXTRA=-purgecaches"
    >"%STAMP_FILE%" echo %CUR_STAMP%
  )
)

rem No --no-remote so external links reuse the running instance.
start "" "%~dp0firefox\firefox.exe" --profile "%PROFILE%" %EXTRA% %*
goto :eof
