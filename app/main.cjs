const { app, BrowserWindow, net, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const smokeTest = process.argv.includes('--smoke-test');
const { resolveAppPaths } = require('./paths.cjs');
const paths = resolveAppPaths({
  isPackaged: app.isPackaged, projectRoot: root, appData: app.getPath('appData'), localAppData: process.env.LOCALAPPDATA,
  testDataDirectory: smokeTest ? process.env.MAJ_STATS_TEST_DATA_DIR : undefined,
});
fs.mkdirSync(paths.profile, { recursive: true });
app.setPath('userData', paths.profile);
app.setPath('sessionData', paths.profile);
app.setName('雀赛统计');
if (process.platform === 'win32') app.setAppUserModelId('cn.majstats.desktop');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let mainWindow;
  let officialSession;
  let server;
  let poll;
  let quitting = false;
  app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  app.on('window-all-closed', () => { if (!quitting) app.quit(); });
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(poll);
    officialSession?.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    server?.closeAllConnections();
    server?.close();
  });
  app.whenReady().then(async () => {
    const { pathToFileURL } = require('node:url');
    const { loadProtocol } = await import('../src/protocol.mjs');
    const { OfficialSession } = await import('../src/electron-session.mjs');
    const { TournamentManager } = await import('../src/tournament-manager.mjs');
    const { createServer } = await import('../src/server.mjs');
    const fetcher = (url, options) => net.fetch(String(url), options);
    const protocol = await loadProtocol(pathToFileURL(paths.cache + path.sep), fetcher, {
      bundledDirectory: app.isPackaged ? pathToFileURL(path.join(process.resourcesPath, 'protocol') + path.sep) : undefined,
    });
    officialSession = new OfficialSession(BrowserWindow);
    const store = new TournamentManager({
      protocol, session: officialSession, fetcher, requestIntervalMs: 1500, defaultContestId: 196077,
      directory: pathToFileURL(paths.contests + path.sep),
      legacyDirectory: paths.legacy ? pathToFileURL(paths.legacy + path.sep) : undefined,
      settingsFile: pathToFileURL(paths.settings),
    });
    await store.initialize();
    const application = { version: app.getVersion(), packaged: app.isPackaged, storageRoot: paths.storageRoot, contestsPath: paths.contests, profilePath: paths.profile };
    const localServer = await createServer({ session: officialSession, store, application, onOpenReplay: (url) => officialSession.openReplay(url), onQuit: () => setImmediate(() => app.quit()), onOpenData: async () => {
      const error = await shell.openPath(paths.storageRoot);
      if (error) throw new Error('无法打开数据目录，请在资源管理器中手动打开');
    } });
    server = localServer.server;
    mainWindow = new BrowserWindow({
      title: '雀赛统计', width: 1250, height: 900, minWidth: 880, minHeight: 650, show: !smokeTest,
      autoHideMenuBar: true, backgroundColor: '#f5f7f5',
      icon: path.join(__dirname, 'icon.ico'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.on('closed', () => { if (!quitting) app.quit(); });
    mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== localServer.origin) event.preventDefault(); });
    await mainWindow.loadURL(localServer.origin);
    if (quitting) return;
    poll = setInterval(async () => {
      await officialSession.poll();
    }, 1500);
    // Keep the official client in the background until explicitly requested.
    if (!smokeTest) await officialSession.open({ show: false });
    if (quitting) return;
    // Publish readiness only after the local window has finished loading.
    // Otherwise a test can close it during navigation and trigger ERR_ABORTED.
    fs.writeFileSync(paths.runtime, JSON.stringify({ pid: process.pid, url: localServer.origin }));
    console.log(`Local app ready: ${localServer.origin}`);
  }).catch((error) => {
    if (quitting) return; // Closing during startup is not a startup failure.
    // Startup errors do not contain login request or response bodies.
    console.error('应用启动失败:', error.message);
    if (!smokeTest) dialog.showErrorBox('雀赛统计启动失败', error.message);
    app.quit();
  });
}
