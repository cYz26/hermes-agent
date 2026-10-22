/** Protocol registration is a host-wide effect, not isolated by Electron userData. */
export interface DeepLinkProtocolOptions {
  app: { setAsDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean }
  protocol: string
  env: NodeJS.ProcessEnv
  defaultApp: boolean
  argv: string[]
  execPath: string
  resolve: (entry: string) => string
  log: (line: string) => void
}

export function registerDeepLinkProtocol(options: DeepLinkProtocolOptions): void {
  const { app, protocol, env, defaultApp, argv, execPath, resolve, log } = options

  if (env.HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION === '1') {
    log(`[deeplink] ${protocol}:// registration skipped (HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION)`)

    return
  }

  try {
    if (defaultApp && argv.length >= 2) {
      app.setAsDefaultProtocolClient(protocol, execPath, [resolve(argv[1])])
    } else {
      app.setAsDefaultProtocolClient(protocol)
    }

    log(`[deeplink] registered ${protocol}:// handler`)
  } catch (error) {
    log(`[deeplink] protocol registration failed: ${(error as Error).message}`)
  }
}
