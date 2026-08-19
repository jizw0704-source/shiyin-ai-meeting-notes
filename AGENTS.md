# Repository commands

- Requires Node.js 22.13 or newer and uses the committed npm lockfile.
- Install: `npm ci`
- Configure: copy `.env.example` to `.env.local`, then add local API keys without committing them.
- Run the desktop app: `npm run desktop:dev`
- Run the browser UI and local backend: `npm run dev`
- Check: `npm run lint`, `npm run typecheck`, and `npm test`
- Verify native ASR and speaker models: `npm run test:native-models`
- Build: `npm run build`
- Package the current platform installer: `npm run desktop:dist`
- Package Apple Silicon DMG and ZIP from a Mac: `npm run desktop:dist:mac`
- Package Windows x64 from Windows: `npm run desktop:dist:win`
- macOS CI: `.github/workflows/macos-build.yml` builds DMG and ZIP on an arm64 runner, launches the installed app with isolated user data, verifies local models and HTTP health, and confirms data survives upgrade and app removal.
- Windows CI: `.github/workflows/windows-build.yml` downloads the pinned ASR model bundle, runs checks, installs the NSIS package twice, launches it, verifies local models and HTTP health, then confirms user data survives upgrade and uninstall.
- Draft release: `.github/workflows/draft-release.yml` requires manual `CREATE_DRAFT` confirmation, calls both verified platform workflows, and creates an unpublished prerelease draft only after both succeed.
