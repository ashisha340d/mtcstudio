@echo off

set DEST=\\192.168.1.5\mtcstudio
set SRC=D:\mtcstudio

net use \\192.168.1.5 /delete /y >nul 2>&1
net use \\192.168.1.5\mtcstudio /user:"192.168.1.5\munch cafe" admin

if errorlevel 1 (
    echo Failed to connect to %DEST%
    pause
    exit /b 1
)

robocopy "%SRC%" "%DEST%" /E /Z /R:2 /W:5 ^
  /XD "%SRC%\.git" "%SRC%\.claude" "%SRC%\.vscode" "%SRC%\.agents" ^
      "%SRC%\node_modules" "%SRC%\client\node_modules" "%SRC%\client\cake-production\node_modules" ^
      "%SRC%\server\node_modules" ^
      "%SRC%\server\logs" "%SRC%\server\backups" "%SRC%\server\certs" ^
  /XF "*.log" "*.pem"
