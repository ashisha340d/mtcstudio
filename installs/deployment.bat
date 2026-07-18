@echo off

set DEST=\\100.97.170.28\mtcstudio
set SRC=D:\mtcstudio

net use \\100.97.170.28 /delete /y >nul 2>&1
net use \\100.97.170.28\mtcstudio /user:"100.97.170.28\munch cafe" admin

if errorlevel 1 (
    echo Failed to connect to %DEST%
    pause
    exit /b 1
)


robocopy "%SRC%" "%DEST%" /E /Z /R:2 /W:5 ^
  /XD "%SRC%\.git" "%SRC%\.claude" "%SRC%\.vscode" "%SRC%\.agents" ^
      "%SRC%\client" "%SRC%\node_modules" "%SRC%\server\node_modules" ^
      "%SRC%\server\logs" "%SRC%\server\backups" "%SRC%\server\certs" ^
  /XF "*.log" "*.pem" ".env" ".env.local" ".env.live" ".env.production" ^
      "*.bat" ".gitattributes" ^
      "%SRC%\server\routes\ocr.js"