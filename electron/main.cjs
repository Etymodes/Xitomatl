const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } = require('electron');
const { existsSync, statSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'xitomatl';
const APP_ORIGIN = `${SCHEME}://app`;
const DEV_URL = 'http://127.0.0.1:5173/';
const isDevelopment = !app.isPackaged && process.env.XITOMATL_DESKTOP_DEV === '1';
const appDirectory = path.resolve(__dirname, '..');
const distDirectory = path.join(appDirectory, 'dist');
const iconPath = path.join(appDirectory, 'build', 'icon.ico');
let mainWindow = null;

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

if (process.platform === 'win32') app.setAppUserModelId('com.etymodes.xitomatl');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function isAllowedOrigin(url) {
  try {
    const parsed = new URL(url);
    return isDevelopment
      ? parsed.origin === new URL(DEV_URL).origin
      : parsed.protocol === `${SCHEME}:` && parsed.hostname === 'app';
  } catch {
    return false;
  }
}

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

    let url;
    let requestedPath;
    try {
      url = new URL(request.url);
      if (url.host !== 'app') return new Response('Not found', { status: 404 });
      requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const filePath = path.resolve(distDirectory, requestedPath);
    const relativePath = path.relative(distDirectory, filePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return new Response('Not found', { status: 404 });
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return new Response('Not found', { status: 404 });
    }

    const result = await net.fetch(pathToFileURL(filePath).toString());
    if (relativePath !== 'index.html') return result;

    const headers = new Headers(result.headers);
    headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-src 'none'",
    ].join('; '));
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#FBF7F0',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = window;
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });

  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedOrigin(typeof targetUrl === 'string' ? targetUrl : event.url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const startUrl = isDevelopment ? DEV_URL : `${APP_ORIGIN}/index.html`;
  void window.loadURL(startUrl).catch((error) => {
    dialog.showErrorBox('无法启动时茄', String(error));
  });
  return window;
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });

  app.whenReady().then(() => {
    if (!isDevelopment) registerAppProtocol();
    ipcMain.handle('xitomatl:set-reminder-fullscreen', (event, enabled) => {
      if (typeof enabled !== 'boolean' || !mainWindow || event.sender !== mainWindow.webContents ||
          event.senderFrame !== mainWindow.webContents.mainFrame || !isAllowedOrigin(event.senderFrame.url)) {
        throw new Error('Rejected fullscreen request');
      }
      if (enabled && mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.setFullScreen(enabled);
      if (enabled) {
        mainWindow.show();
        mainWindow.focus();
      }
      return mainWindow.isFullScreen();
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write' && isAllowedOrigin(contents.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
      return permission === 'clipboard-sanitized-write' && isAllowedOrigin(requestingOrigin);
    });
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
