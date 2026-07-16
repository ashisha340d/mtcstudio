@echo off
cd /d D:\mtclaucher

echo Building MTC Studio...
go build -ldflags="-H=windowsgui" -o MTC-Studio.exe .

if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo Copying executable...
copy /Y MTC-Studio.exe D:\mtcstudio\MTC-Studio.exe

if errorlevel 1 (
    echo Copy failed.
    pause
    exit /b 1
)

echo Build successful.
start "" D:\mtcstudio\MTC-Studio.exe