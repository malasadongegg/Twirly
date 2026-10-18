// Minimal Electron host for rendering the trailer composition frame by frame.
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    useContentSize: true,
    frame: false,
    show: true,
    x: 0,
    y: 0,
    backgroundColor: '#0b0f14',
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  })
  win.loadFile(join(__dirname, 'composition', 'dist', 'index.html'))
})
