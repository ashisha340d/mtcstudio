@echo off
title MTC Studio - Local
set ROOT=%~dp0..

start "MTC Server (local)" cmd /k "cd /d %ROOT% && npm run dev:server:local"
start "MTC Client (vite)" cmd /k "cd /d %ROOT% && npm run dev:client"

timeout /t 6 /nobreak >nul
start "" http://localhost:5173
