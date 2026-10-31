@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 goto bundled
node "%~dp0scripts\start-preview.mjs"
goto done
:bundled
if not exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" goto missing
"%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "%~dp0scripts\start-preview.mjs"
goto done
:missing
echo Node.js is required. Open the execution guide.
:done
if errorlevel 1 pause
endlocal
