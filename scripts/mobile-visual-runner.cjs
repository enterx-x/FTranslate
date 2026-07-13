const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-gpu');
if (process.env.FTRANSLATE_MOBILE_VISUAL_USER_DATA) {
  app.setPath('userData', process.env.FTRANSLATE_MOBILE_VISUAL_USER_DATA);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 430,
    height: 932,
    show: true,
    backgroundColor: '#f7f9fc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  await window.loadFile(path.join(root, 'dist-mobile', 'index.html'));
});

app.on('window-all-closed', () => app.quit());
