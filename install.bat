@echo off
rem 安装桌面界面依赖的 Electron 运行时。
rem 源码运行时执行一次；便携包已经包含运行依赖。

setlocal
chcp 65001 >nul
set "DIR=%~dp0"

set "NODE=%DIR%tools\node\node.exe"
set "NPM=%DIR%tools\node\npm.cmd"
if not exist "%NODE%" set "NODE=node"
if not exist "%NPM%" set "NPM=npm"

echo Installing Electron into webapp\ ...
pushd "%DIR%webapp"
set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
set "npm_config_registry=https://registry.npmmirror.com/"
call "%NPM%" ci --no-audit --no-fund
set "RC=%ERRORLEVEL%"
popd

if not "%RC%"=="0" (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)
rem Electron 44 的 npm 包需要显式准备桌面运行时。
"%NODE%" "%DIR%webapp\node_modules\electron\install.js"
if errorlevel 1 (
    echo [ERROR] Electron runtime installation failed.
    pause
    exit /b 1
)
echo Done. Double-click 投影预览.exe in the project root to start the app.
pause
endlocal
