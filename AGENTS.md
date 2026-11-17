# Agent Rules

## Live server
- NEVER update the live server (`\\100.97.170.28\mtcstudio`) unless the user explicitly says so.
- Do not run `installs\deployment.bat`, `installs\deployment - script.bat`, robocopy, or anything that copies to the live server.
- Do not run `vite build` / `npm run build:client` unless asked: it writes to `server/public/client-build`, which the deployment scripts copy to live.
