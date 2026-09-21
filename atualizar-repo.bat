@echo off
cd /d "%~dp0"
echo Atualizando repo...
git fetch origin
for /f "tokens=*" %%b in ('git branch --show-current') do set BRANCH=%%b
git pull --ff-only origin %BRANCH%
echo.
echo Pronto. Branch atual: %BRANCH%
pause
