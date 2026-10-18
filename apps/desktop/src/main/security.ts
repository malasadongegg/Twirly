import { app, session } from 'electron'

/** App-wide hardening: no navigation, no popups, no permission grants, no remote content. */
export function applySecurityPolicy(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL

  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (devUrl && url.startsWith(devUrl)) return
      event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}
