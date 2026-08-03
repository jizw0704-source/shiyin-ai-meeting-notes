# Repository commands

- Requires Node.js 22.13 or newer and uses the committed npm lockfile.
- Install: `npm ci`
- Configure: copy `.env.example` to `.env.local`, then add local API keys without committing them.
- Run the desktop app: `npm run desktop:dev`
- Run the browser UI and local backend: `npm run dev`
- Check: `npm run lint`, `npm run typecheck`, and `npm test`
- Build: `npm run build`
- Package the current platform installer: `npm run desktop:dist`
