# Murmur for desktop

Murmur also ships as a desktop app for macOS, Windows and Linux, built with Electron. It's the same web app and the same server as the umbrelOS app, packaged together:

- The app starts Murmur's server inside itself on `127.0.0.1`, reusing the last port when it's free, and opens one window onto it. Every request except `/healthz` must carry a header that's new each launch, which the app adds to its own pages' requests to that port only, so nothing else on the computer can use it.
- You pick a Hermes in the app ("Connect to Hermes"). Murmur keeps it in `murmur.json` in the app's data folder, the way the server keeps `DATA_DIR/murmur.json` elsewhere. The server ignores the shell's environment, so a `HERMES_URL` or `MURMUR_PASSWORD` you have set doesn't leak in.
- The data folder is `~/Library/Application Support/Murmur` on macOS, `%APPDATA%\Murmur` on Windows and `~/.config/Murmur` on Linux. Development builds use `Murmur Dev` instead.

The code lives in `desktop/`:

| | |
|---|---|
| `main.ts` | The app: server, window, menu, links, permissions, badge |
| `preload.ts` | `window.murmurDesktop`, all the page can reach |
| `menu.ts`, `state.ts`, `updates.ts` | Menus, remembered window and port, self-updates |
| `scripts/` | `build.ts`, `dev.ts`, `dist.ts`, `smoke.ts`, `icons.ts`, and electron-builder's `before-build.cjs` |
| `resources/` | Icons and the macOS entitlements |

The electron-builder settings are under `"build"` in `package.json`.

## Develop

```sh
npm install
npm run desktop:dev
```

This runs the web app on Vite's dev server, so it hot-reloads as usual, inside Electron. Changes to `desktop/` or `server/` rebuild and restart the app. A local Hermes from `dev/docker-compose.yml` is at `http://localhost:18789`, and "Connect to Hermes" lists it under "Found nearby".

To work on the page without Electron, `npm run dev:web` still works. `src/lib/desktop.ts` is the page's side of the bridge, and `data-desktop` on `<html>` is set before first paint for desktop-only styles.

## Build

```sh
npm run desktop:dist                          # this computer's platform and architecture
npm run desktop:dist -- --mac --x64 --arm64   # both Mac architectures
npm run desktop:dist -- --win --x64 --arm64
npm run desktop:dist -- --linux --x64         # AppImage and .deb
npm run desktop:dist -- --dir                 # an unpacked app only, quicker
```

`desktop:dist` builds the web app, bundles `desktop/` into `desktop/app/`, then runs electron-builder. Results go in `desktop/release/`. Both folders are gitignored. Nothing is published unless you pass `--publish`.

What the build produces:

| | Installers | Updater files |
|---|---|---|
| macOS | `Murmur-<version>-<arch>.dmg` | `Murmur-<version>-<arch>.zip`, `latest-mac.yml` |
| Windows | `Murmur-<version>.exe` (x64 and arm64 in one), `Murmur-<version>-<arch>.exe` | `latest.yml` |
| Linux | `Murmur-<version>-x86_64.AppImage`, `Murmur-<version>-amd64.deb` | `latest-linux.yml` |

The `.blockmap` files next to them let updates download only what changed.

Without a certificate the build is unsigned. On a Mac it's signed ad hoc, which is what Apple silicon needs to run it. A copy downloaded from the internet is quarantined by Gatekeeper, so open it with right-click → Open, or run `xattr -dr com.apple.quarantine /Applications/Murmur.app`. Windows SmartScreen warns about an unsigned installer. Choose "More info", then "Run anyway".

Windows and Linux installers cross-build from a Mac, but CI builds each platform on its own runner.

## Test

```sh
npm run typecheck   # includes desktop/ (tsconfig.desktop.json)
npm test
```

There are two smoke tests for a packaged build. Neither connects to a Hermes, and both start on throwaway data:

```sh
# The app by itself: renders its first screen, prints murmur-smoke-ok and quits (exit 1 if it can't).
MURMUR_SMOKE=1 MURMUR_USER_DATA="$(mktemp -d)" desktop/release/mac-arm64/Murmur.app/Contents/MacOS/Murmur

# Through Playwright: waits for "Connect to Hermes", checks the desktop bridge, saves a screenshot.
node desktop/scripts/smoke.ts desktop/release/mac-arm64/Murmur.app/Contents/MacOS/Murmur shot.png
```

The unpacked apps are `desktop/release/mac/Murmur.app` for Intel Macs, `win-unpacked/Murmur.exe` and `linux-unpacked/murmur`. On Ubuntu 24.04, an unpacked build needs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` before Chromium's sandbox will start. The `.deb` and AppImage don't.

Playwright's `_electron` can't drive a release build because its fuses turn off the Node inspector. `smoke.ts` attaches over Chromium's DevTools protocol instead (`--remote-debugging-port`).

Other switches for a packaged app:

| Variable | |
|---|---|
| `MURMUR_USER_DATA=<folder>` | Run on other data, such as a test profile or a second copy |
| `MURMUR_DEVTOOLS=1` | Allow the developer tools in a packaged build |
| `MURMUR_SMOKE=1` | The smoke test above |

## CI

`.github/workflows/desktop.yml` runs on pull requests and pushes to `master` that touch the app (`desktop/`, `server/`, `src/`, `public/`, the HTML entry points, `package*.json`, Vite and TypeScript config), on every `v*` tag, and by hand (Actions → Desktop → Run workflow). Each job runs on its own platform:

| Job | Runner | Builds | Smoke-tested |
|---|---|---|---|
| macOS | `macos-latest` (Apple silicon) | arm64, x64 | Both (x64 under Rosetta), plus a screenshot |
| Windows | `windows-latest` (x64) | x64, arm64 | x64, plus a screenshot |
| Linux | `ubuntu-latest` (x64) | AppImage and `.deb`, x64 | Under `xvfb-run`, plus a screenshot |

Each job runs `npm ci`, the typecheck and the tests, then packages and smoke-tests. The installers and updater files are uploaded as `murmur-desktop-<platform>` and the screenshots and logs as `smoke-<platform>`, each kept for 7 days. Builds outside a tag are always unsigned and never update themselves.

`ci.yml` (typecheck, tests, web build, Docker smoke test) and `release.yml` (the Docker image) are unchanged by the desktop app and still run on their own.

## Signing and notarization

Tag builds are signed when these repository secrets exist (Settings → Secrets and variables → Actions). Without them the tag still builds and is released unsigned, with a warning in the run.

| Secret | |
|---|---|
| `MAC_CSC_LINK` | A **Developer ID Application** certificate and its key, exported from Keychain Access as `.p12`, then base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CSC_KEY_PASSWORD` | The `.p12` password |
| `APPLE_ID` | The Apple Account that notarizes |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for it, from account.apple.com |
| `APPLE_TEAM_ID` | The 10-character team ID |
| `WIN_CSC_LINK` | A Windows code-signing certificate as a base64 `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Its password |

A Mac build is notarized only when it's signed and all three `APPLE_*` secrets are set. If only some of them are set, electron-builder stops with an error.

Most new Windows certificates are issued on hardware tokens or in the cloud and can't be exported as a `.pfx`. [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) is the usual route for that. electron-builder supports it through `win.azureSignOptions` in `package.json` and the `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` environment variables. Add those to the Package step in `desktop.yml` in place of `WIN_CSC_*`.

To sign locally, set the same variables, without the `MAC_` prefix on a Mac (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_*`). `CSC_NAME` can also name a Developer ID identity already in your keychain. Then run `npm run desktop:dist`.

## Release

1. Bump `version` in `package.json` and `umbrel/murmur/umbrel-app.yml`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.

Two workflows run on the tag, and both check that it matches those versions:

- `release.yml` pushes the Docker image and writes its digest into the release notes.
- `desktop.yml` builds and signs the three platforms. Only if all of them succeed, it attaches the installers, zips, blockmaps and `latest*.yml` to the release.

The two workflows share one GitHub release. Whichever gets there first creates it, with generated notes. The other finds it, and neither replaces the other's notes. If both try to create it at the same moment, the loser retries and adds to the release the winner made. The desktop job uploads the installers before the `latest*.yml` files, so an app never sees update metadata for files that aren't there yet. Re-running the job replaces the files (`--clobber`).

## Updates

Release builds update themselves from GitHub Releases through electron-updater. A build does this only when it was bundled with `MURMUR_UPDATES=1`, which `desktop.yml` sets for tags, and only when it's packaged.

- It checks 15 seconds after launch and every 4 hours, and downloads quietly.
- When an update is ready, the app asks once ("Restart Now" or "Later") and adds "Restart to Update" to the menu. Otherwise the update installs the next time you quit. "Check for Updates…" in the menu checks on demand.
- **macOS** updates only a signed build. An unsigned tag build is released without self-updates, and the workflow warns about it.
- **Windows** updates through the NSIS installer, signed or not.
- **Linux** updates only the AppImage. The `.deb` is updated by reinstalling it.

The updater reads the newest non-draft, non-prerelease release of `getumbrel/murmur` (`build.publish` in `package.json`). The repository and its releases must be public, or the check fails quietly.

## Icons

`npm run desktop:icons` draws `desktop/resources/` from `design/icon/*.svg` with Playwright's Chromium. The results are committed, so packaging never needs a browser. Run it again after the mark changes.

## Known gaps

- **Windows is untested.** It was cross-built on a Mac, and CI builds it and smoke-tests the x64 build, but nobody has used it on Windows yet. Check the titlebar overlay, the taskbar badge, notifications, the installer, and updates. The arm64 build isn't launched anywhere.
- **Linux** is smoke-tested only under `xvfb` on Ubuntu, x64 only. There's no arm64 Linux build and no `.rpm`.
- **Signing and notarization** have never run, because there are no certificates yet, so the first signed tag is the real test. Until then, every build is unsigned.
- **Auto-update** hasn't run end to end. That needs two signed releases in a row.
- **One Windows installer for both architectures.** `Murmur-<version>.exe` holds x64 and arm64, so it's about twice the size of the per-arch ones next to it.
- **Release race.** The two release workflows coordinate only through the GitHub release itself. Concurrent edits to its notes are last-writer-wins, but only `release.yml` edits them.
