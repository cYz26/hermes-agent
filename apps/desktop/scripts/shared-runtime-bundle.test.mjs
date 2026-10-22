import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { environmentDefaultsBanner } from './bundle-env.mjs'

test('release admission carries the same protocol-preserving bundle default', () => {
  const source = fileURLToPath(new URL('../../..', import.meta.url))
  const output = execFileSync(process.env.HERMES_TEST_PYTHON || 'python3', ['-c',
    'import json; from scripts.releases.bundle_env import parse_assignments; print(json.dumps(parse_assignments(["HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION=1"])))'
  ], { cwd: source, encoding: 'utf8' })
  expect(JSON.parse(output)).toEqual({ HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION: '1' })
})

test('a source custom shell shares the standard home without taking its protocol handler', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-shared-runtime-'))
  try {
    const banner = environmentDefaultsBanner(JSON.stringify({ HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION: '1' }))
    const paths = fileURLToPath(new URL('../electron/data-paths.mjs', import.meta.url))
    const protocol = fileURLToPath(new URL('../electron/deep-link-protocol.ts', import.meta.url))
    const entry = join(root, 'entry.mjs')
    writeFileSync(entry, `
      import { resolveDesktopHermesHome, resolveDesktopUserData } from ${JSON.stringify(paths)};
      import { registerDeepLinkProtocol } from ${JSON.stringify(protocol)};
      const registrations = [];
      registerDeepLinkProtocol({
        app: { setAsDefaultProtocolClient: (...args) => { registrations.push(args); return true; } },
        protocol: 'hermes', env: process.env, defaultApp: false, argv: ['/custom/app'],
        execPath: '/custom/app', resolve: value => value, log: () => {}
      });
      console.log(JSON.stringify({
        home: resolveDesktopHermesHome({ home: '/users/example', env: process.env, platform: 'darwin' }),
        userData: resolveDesktopUserData('/users/example/Library/Application Support/HermesCommitTest', process.env),
        registrations
      }));
    `)
    const outfile = join(root, 'bundle.mjs')
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, banner: { js: banner } })
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HERMES_')))
    const run = extra => JSON.parse(execFileSync(process.execPath, [outfile], { env: { ...env, ...extra }, encoding: 'utf8' }))
    expect(run({})).toEqual({
      home: '/users/example/.hermes',
      userData: '/users/example/Library/Application Support/HermesCommitTest',
      registrations: []
    })
    expect(run({ HERMES_HOME: '/isolated/profile-home' }).home).toBe('/isolated/profile-home')
    expect(run({ HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION: '0' }).registrations).toEqual([['hermes']])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
