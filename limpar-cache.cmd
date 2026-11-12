@echo off
setlocal
cd /d "%~dp0"

echo Fechando instancias do Onda Desktop em desenvolvimento...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\desktop\node_modules\electron\dist\electron.exe' }; if ($p) { $p | Stop-Process -Force }" >nul 2>&1

echo Removendo caches antigos...
rmdir /s /q ".userdata" 2>nul
rmdir /s /q "%APPDATA%\onda-desktop\GPUPersistentCache" 2>nul
rmdir /s /q "%APPDATA%\onda-desktop\Cache" 2>nul
rmdir /s /q "%APPDATA%\onda-desktop\Code Cache" 2>nul
rmdir /s /q "%APPDATA%\onda-desktop\DawnGraphiteCache" 2>nul

echo.
echo Cache do Onda limpo. Execute iniciar-onda.cmd novamente.
pause
