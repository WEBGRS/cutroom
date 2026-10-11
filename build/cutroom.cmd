@echo off
rem Cutroom's command line, installed next to Cutroom.exe: cutroom <project> <command> [args]
setlocal
if not defined CUTROOM_DATA for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "CUTROOM_DATA=%%d\Cutroom"
set "VS_DATA=%CUTROOM_DATA%"
set ELECTRON_RUN_AS_NODE=1
"%~dp0Cutroom.exe" "%~dp0resources\app\editor\dist\cli.mjs" %*
