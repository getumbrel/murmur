// npm run desktop:dist [-- electron-builder options]: packages desktop/app
// (npm run desktop:build) for this computer, or for what the options name
// (--mac --arm64, --win, --linux, --dir …). Installers land in desktop/release.
//
// Signing happens only with a certificate in the environment (CSC_LINK, or
// WIN_CSC_LINK for Windows), and a signed Mac build is notarized when APPLE_ID,
// APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are set too. Otherwise the
// build is unsigned (ad hoc on Apple silicon) and runs on this computer. Only
// a build made with MURMUR_UPDATES=1 looks for updates (docs/DESKTOP.md).
// Nothing is published unless the options say --publish.

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const env = { ...process.env }
// CI passes secrets that may not exist as empty variables: treat those as unset.
for (const [key, value] of Object.entries(env)) if (/^(CSC_|WIN_CSC_|APPLE_)/.test(key) && !value) delete env[key]
const args = process.argv.slice(2)
if (!args.some((arg) => arg === '-p' || arg.startsWith('--publish'))) args.push('--publish', 'never')

if (!env.CSC_LINK && !env.CSC_NAME && !env.WIN_CSC_LINK) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  // Nothing to notarize without a Developer ID signature.
  for (const key of Object.keys(env)) if (key.startsWith('APPLE_')) delete env[key]
  // Apple silicon only runs signed code: sign ad hoc, which needs the hardened runtime off.
  if (process.platform === 'darwin') args.push('-c.mac.identity=-', '-c.mac.hardenedRuntime=false')
}

const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js')
const { status } = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env })
process.exit(status ?? 1)
