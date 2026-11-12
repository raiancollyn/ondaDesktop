@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "ONDA_ALLOW_SANDBOX="

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js nao encontrado. Instale o Node.js 22.12 ou superior.
    pause
    exit /b 1
)

where dotnet >nul 2>nul
if errorlevel 1 (
    echo .NET SDK 10 nao encontrado. Instale o .NET SDK 10.
    pause
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Instalando dependencias do Electron...
    call npm install
    if errorlevel 1 goto :falha
)

echo Compilando o componente nativo de audio...
call npm run native:build
if errorlevel 1 goto :falha

echo Abrindo o Onda...
call node scripts\start-electron.cjs
set "CODIGO=%ERRORLEVEL%"

echo.
if not "%CODIGO%"=="0" (
    echo O Onda fechou com codigo %CODIGO%.
) else (
    echo O Onda foi encerrado.
)
echo Se a janela abriu e fechou sozinha, copie as mensagens acima para diagnostico.
pause

exit /b %CODIGO%

:falha
echo.
echo Nao foi possivel preparar o Onda. Veja as mensagens acima.
pause
exit /b 1
