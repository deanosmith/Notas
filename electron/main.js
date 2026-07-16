const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron');
const { createReadStream, readFileSync, writeFileSync } = require('node:fs');
const { stat } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');

const APP_NAME = 'Notas';
const ELECTRON_URL_ENV = 'NOTAS_ELECTRON_URL';
const serveRoot = path.resolve(__dirname, '..');
const preloadPath = path.join(__dirname, 'preload.js');
const iconPath = path.join(serveRoot, 'notas.icns');
const menuBarIconPath = path.join(serveRoot, 'notas-menubar-icon.png');

let appBaseUrl = '';
let staticServer = null;
let mainWindow = null;
let menuBarTray = null;
let menuBarSettingsPath = '';
let menuBarSettings = { mode: 'new', noteId: '', noteTitle: '' };
let mainRendererReadyWindowId = 0;
const pendingMainRendererMessages = [];
let prewarmedNoteWindow = null;
let noteWindowPrewarmTimer = null;
let noteWindowPrewarmIdleTimer = null;
let suppressNextNoteWindowPrewarm = false;
let isQuitting = false;
let lastThemeState = null;

const windowContexts = new Map();
const noteWindows = new Map();
const windowNotificationCounts = new Map();
const menuBarNotes = new Map();

const keepMainWindowWarm = process.platform === 'darwin';
const NOTE_WINDOW_PREWARM_DELAY_MS = 160;
const NOTE_WINDOW_PREWARM_IDLE_MS = 10 * 60 * 1000;
const enableNoteWindowPrewarm = true;
const LOCAL_SERVER_PORT_MIN = 49152;
const LOCAL_SERVER_PORT_MAX = 65535;
const LOCAL_SERVER_PORT_ATTEMPTS = 16;

const allowedTopLevelFiles = new Set([
  'index.html',
  'styles.css',
  'firebase-config.local.js',
  'notas.png',
  'notas-icon.png',
  'notas.icns'
]);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.icns': 'image/x-icns',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png'
};

function isAllowedAsset(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0')) return false;
  if (normalized.split('/').some(part => !part || part === '..' || part.startsWith('.'))) return false;
  if (allowedTopLevelFiles.has(normalized)) return true;
  return normalized.startsWith('js/') && normalized.endsWith('.js');
}

function resolveStaticPath(requestUrl) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(requestUrl || '/', 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }

  const normalized = path.posix.normalize(pathname);
  const relativePath = normalized === '/' ? 'index.html' : normalized.replace(/^\/+/, '');
  if (!isAllowedAsset(relativePath)) return null;

  const filePath = path.resolve(serveRoot, relativePath);
  if (!filePath.startsWith(serveRoot + path.sep)) return null;
  return filePath;
}

function isUsableLocalServerPort(port) {
  const normalized = Math.trunc(Number(port));
  return Number.isInteger(normalized) && normalized >= LOCAL_SERVER_PORT_MIN && normalized <= LOCAL_SERVER_PORT_MAX;
}

function localServerPortSettingsPath() {
  return path.join(app.getPath('userData'), 'local-server-port.json');
}

function loadLocalServerPort() {
  try {
    const port = JSON.parse(readFileSync(localServerPortSettingsPath(), 'utf8'))?.port;
    return isUsableLocalServerPort(port) ? Math.trunc(Number(port)) : 0;
  } catch {
    return 0;
  }
}

function saveLocalServerPort(port) {
  if (!isUsableLocalServerPort(port)) return;
  try {
    writeFileSync(localServerPortSettingsPath(), JSON.stringify({ port }, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn('save local server port:', err);
  }
}

function localServerPortCandidates() {
  const portRange = LOCAL_SERVER_PORT_MAX - LOCAL_SERVER_PORT_MIN + 1;
  const savedPort = loadLocalServerPort();
  const firstPort = savedPort || LOCAL_SERVER_PORT_MIN + Math.floor(Math.random() * portRange);
  const candidates = [];
  for (let offset = 0; offset < LOCAL_SERVER_PORT_ATTEMPTS; offset += 1) {
    candidates.push(LOCAL_SERVER_PORT_MIN + ((firstPort - LOCAL_SERVER_PORT_MIN + offset) % portRange));
  }
  return candidates;
}

function listenOnLoopbackPort(server, port) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    const onError = err => {
      cleanup();
      reject(err);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function startStaticServer() {
  const server = createServer(async (req, res) => {
    const filePath = resolveStaticPath(req.url);
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('Not a file');

      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream'
      });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  });

  return (async () => {
    let lastPortError = null;
    for (const port of localServerPortCandidates()) {
      try {
        await listenOnLoopbackPort(server, port);
        saveLocalServerPort(port);
        return { server, url: `http://localhost:${port}/` };
      } catch (err) {
        lastPortError = err;
        if (err?.code !== 'EADDRINUSE') throw err;
      }
    }
    await listenOnLoopbackPort(server, 0);
    const address = server.address();
    if (!address || typeof address !== 'object') {
      throw lastPortError || new Error('Could not start local app server');
    }
    return { server, url: `http://localhost:${address.port}/` };
  })();
}

function appUrl(params = {}) {
  const url = new URL(appBaseUrl);
  url.searchParams.set('desktop', '1');
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function normalizeNoteId(noteId) {
  const normalized = String(noteId || '').trim();
  if (!normalized || normalized.length > 180) return '';
  if (normalized.includes('/') || /[\x00-\x1F\x7F]/.test(normalized)) return '';
  return normalized;
}

function noteSnapshotString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function noteSnapshotArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 120) : [];
}

function noteSnapshotObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNoteSnapshot(noteId, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const normalizedId = normalizeNoteId(snapshot.id || noteId);
  if (normalizedId !== noteId) return null;
  const now = new Date().toISOString();
  return {
    id: noteId,
    title: noteSnapshotString(snapshot.title, 'Untitled Note').slice(0, 300),
    content: typeof snapshot.content === 'string' ? snapshot.content : '',
    owner: noteSnapshotString(snapshot.owner),
    folderId: noteSnapshotString(snapshot.folderId) || null,
    public: !!snapshot.public,
    linkPublic: !!snapshot.linkPublic,
    publicFolderIds: noteSnapshotArray(snapshot.publicFolderIds),
    sharedWith: noteSnapshotObject(snapshot.sharedWith),
    sharedAccessKeys: noteSnapshotArray(snapshot.sharedAccessKeys),
    mentionedUids: noteSnapshotArray(snapshot.mentionedUids),
    bodyLoaded: snapshot.bodyLoaded === true,
    pinnedAt: noteSnapshotString(snapshot.pinnedAt),
    pinScope: snapshot.pinScope === 'minor' ? 'minor' : (snapshot.pinScope === 'major' ? 'major' : ''),
    deletedAt: noteSnapshotString(snapshot.deletedAt),
    trashExpiresAt: noteSnapshotString(snapshot.trashExpiresAt),
    directAccessRole: noteSnapshotString(snapshot.directAccessRole),
    directAccess: noteSnapshotObject(snapshot.directAccess),
    created: noteSnapshotString(snapshot.created, now),
    modified: noteSnapshotString(snapshot.modified, now)
  };
}

function normalizeNoteState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const noteId = normalizeNoteId(snapshot.id || snapshot.noteId);
  if (!noteId) return null;
  return normalizeNoteSnapshot(noteId, { ...snapshot, id: noteId });
}

function normalizeMenuBarSettings(settings) {
  const noteId = normalizeNoteId(settings?.noteId);
  const mode = settings?.mode === 'note' && noteId ? 'note' : 'new';
  return {
    mode,
    noteId: mode === 'note' ? noteId : '',
    noteTitle: mode === 'note'
      ? noteSnapshotString(settings?.noteTitle, 'Untitled Note').slice(0, 300)
      : ''
  };
}

function loadMenuBarSettings() {
  menuBarSettingsPath = path.join(app.getPath('userData'), 'menubar-settings.json');
  try {
    menuBarSettings = normalizeMenuBarSettings(JSON.parse(readFileSync(menuBarSettingsPath, 'utf8')));
  } catch {
    menuBarSettings = normalizeMenuBarSettings(null);
  }
}

function saveMenuBarSettings(settings) {
  menuBarSettings = normalizeMenuBarSettings(settings);
  try {
    writeFileSync(menuBarSettingsPath, JSON.stringify(menuBarSettings, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('save menu bar settings:', err);
  }
  sendRendererMessage(mainWindow, 'desktop:menubar-settings-changed', menuBarSettings);
  return menuBarSettings;
}

function normalizeThemeState(state) {
  if (!state || typeof state !== 'object') return null;
  const mode = ['light', 'dark', 'system'].includes(state.mode) ? state.mode : '';
  const accent = String(state.accent || '').trim();
  const fontSize = Math.trunc(Number(state.fontSize) || 0);
  const lineHeight = Number(state.lineHeight);
  if (!mode || !/^#[0-9a-f]{6}$/i.test(accent) || fontSize < 10 || fontSize > 26) return null;
  return {
    mode,
    accent: accent.toLowerCase(),
    fontSize,
    lineHeight: Number.isFinite(lineHeight)
      ? Math.max(1.2, Math.min(2.2, Math.round(lineHeight * 100) / 100))
      : 1.66
  };
}

function isAppUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    const base = new URL(appBaseUrl);
    return target.origin === base.origin;
  } catch {
    return false;
  }
}

function isLikelyAuthPopupUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    if (target.protocol !== 'https:') return false;
    const host = target.hostname.toLowerCase();
    return host === 'accounts.google.com' ||
      host === 'apis.google.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.firebaseapp.com') ||
      host.endsWith('.web.app');
  } catch {
    return false;
  }
}

function secureWebPreferences(includePreload = true) {
  const preferences = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: true
  };
  if (includePreload) preferences.preload = preloadPath;
  return preferences;
}

function configureWindowSecurity(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const template = [];
    const hasSelection = !!String(params.selectionText || '').trim();
    const isEditable = !!params.isEditable;

    if (isEditable) {
      template.push(
        { label: 'Undo', role: 'undo' },
        { label: 'Redo', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy', enabled: hasSelection },
        { label: 'Paste', role: 'paste' },
        { label: 'Select All', role: 'selectAll' }
      );
    } else {
      template.push(
        { label: 'Copy', role: 'copy', enabled: hasSelection },
        { label: 'Select All', role: 'selectAll' }
      );
    }

    if (app.isPackaged === false) {
      template.push(
        { type: 'separator' },
        { label: 'Inspect Element', click: () => win.webContents.inspectElement(params.x, params.y) }
      );
    }

    Menu.buildFromTemplate(template).popup({ window: win });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLikelyAuthPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'Sign In',
          width: 520,
          height: 720,
          parent: win,
          webPreferences: secureWebPreferences(false)
        }
      };
    }

    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(err => console.error('open external url:', err));
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(err => console.error('open external navigation:', err));
    }
  });
}

function showAndFocusWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'darwin') {
    if (app.isHidden()) app.show();
    if (!app.isActive()) app.focus({ steal: true });
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function hideWarmWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  win.hide();
  buildApplicationMenu();
}

function showWindowWhenReady(win) {
  let didShow = false;
  const show = () => {
    if (didShow || win.isDestroyed()) return;
    didShow = true;
    win.show();
  };
  win.once('ready-to-show', show);
  win.webContents.once('did-finish-load', show);
  win.webContents.once('did-fail-load', show);
}

function showAndFocusWhenReady(win) {
  if (!win || win.isDestroyed()) return;
  if (!win.webContents.isLoading()) {
    showAndFocusWindow(win);
    return;
  }
  let didShow = false;
  const show = () => {
    if (didShow) return;
    didShow = true;
    showAndFocusWindow(win);
  };
  win.once('ready-to-show', show);
  win.webContents.once('did-finish-load', show);
  win.webContents.once('did-fail-load', show);
}

function rendererWindowContext(win, context = windowContext(win)) {
  return {
    windowId: win?.id || 0,
    type: context?.type === 'note' ? 'note' : 'main',
    noteId: context?.noteId || null,
    initialNote: context?.initialNote || null,
    themeState: lastThemeState,
    isAlwaysOnTop: !!context?.alwaysOnTop,
    hasVisibleNoteWindow: context?.type === 'main' && hasVisibleNoteWindow()
  };
}

function sendRendererMessage(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  const send = () => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function sendWindowContext(win) {
  sendRendererMessage(win, 'desktop:window-context-updated', rendererWindowContext(win));
}

function createWindow(options, behavior = {}) {
  const win = new BrowserWindow({
    backgroundColor: '#050a12',
    icon: iconPath,
    show: false,
    skipTaskbar: false,
    focusable: true,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 13, y: 15 }
    } : {}),
    webPreferences: secureWebPreferences(true),
    ...options
  });

  configureWindowSecurity(win);
  if (behavior.showImmediately) win.show();
  else if (behavior.showOnReady !== false) showWindowWhenReady(win);
  win.on('close', event => {
    const context = windowContexts.get(win.id);
    if (!keepMainWindowWarm || isQuitting || context?.type !== 'main') return;
    event.preventDefault();
    hideWarmWindow(win);
  });
  win.on('focus', buildApplicationMenu);
  win.on('blur', buildApplicationMenu);
  win.on('show', () => {
    if (windowContext(win)?.type === 'note') notifyMainNoteWindowPresence();
  });
  win.on('hide', () => {
    if (windowContext(win)?.type === 'note') notifyMainNoteWindowPresence();
  });
  win.on('closed', () => {
    const context = windowContexts.get(win.id);
    const shouldSuppressPrewarm = suppressNextNoteWindowPrewarm;
    suppressNextNoteWindowPrewarm = false;
    if (context?.type === 'main' && mainWindow === win) {
      mainWindow = null;
      if (!isQuitting && process.platform !== 'darwin') app.quit();
    }
    if (context?.type === 'note' && context.noteId) noteWindows.delete(context.noteId);
    if (prewarmedNoteWindow === win) {
      prewarmedNoteWindow = null;
      clearNoteWindowPrewarmIdleTimer();
    }
    windowContexts.delete(win.id);
    windowNotificationCounts.delete(win.id);
    updateDockNotificationBadge();
    if (!isQuitting && context?.type === 'note' && !shouldSuppressPrewarm) scheduleNoteWindowPrewarm();
    if (context?.type === 'note') notifyMainNoteWindowPresence();
    buildApplicationMenu();
  });

  return win;
}

function createMainWindow(behavior = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (behavior.showExisting !== false) showAndFocusWindow(mainWindow);
    return mainWindow;
  }

  mainWindow = createWindow({
    width: 1280,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    title: APP_NAME
  }, behavior);
  windowContexts.set(mainWindow.id, { type: 'main', alwaysOnTop: false });
  mainRendererReadyWindowId = 0;
  mainWindow.webContents.on('did-start-loading', () => {
    if (mainWindow && mainWindow.id === mainRendererReadyWindowId) mainRendererReadyWindowId = 0;
  });
  mainWindow.loadURL(appUrl({ desktopWindow: 'main' }));
  return mainWindow;
}

function createNoteBrowserWindow(behavior = {}) {
  const noteWindow = createWindow({
    width: 760,
    height: 760,
    title: 'Notas Note',
    alwaysOnTop: true
  }, behavior);
  applyNoteWindowFloatingBehavior(noteWindow);
  return noteWindow;
}

function positionNoteWindowOnCursorDisplay(win) {
  if (!win || win.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display?.workArea;
  if (!workArea) return;

  const bounds = win.getBounds();
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  win.setBounds({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  });
}

function applyNoteWindowFloatingBehavior(win) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin' && typeof win.setVisibleOnAllWorkspaces === 'function') {
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (err) {
      console.error('set pop-out visible on all workspaces:', err);
    }
  }
}

function setNoteWindowContext(noteWindow, noteId, initialNote, options = {}) {
  const previousContext = windowContext(noteWindow);
  if (previousContext?.type === 'note' && previousContext.noteId && previousContext.noteId !== noteId) {
    if (noteWindows.get(previousContext.noteId) === noteWindow) noteWindows.delete(previousContext.noteId);
  }

  const context = {
    type: 'note',
    noteId,
    initialNote,
    alwaysOnTop: true,
    pendingShow: options.deferReveal === true
  };
  windowContexts.set(noteWindow.id, context);
  if (noteId) noteWindows.set(noteId, noteWindow);
  noteWindow.setTitle(initialNote?.title ? `${initialNote.title} - ${APP_NAME}` : 'Notas Note');
  applyNoteWindowFloatingBehavior(noteWindow);
  sendWindowContext(noteWindow);
  buildApplicationMenu();
}

function usablePrewarmedNoteWindow() {
  if (!enableNoteWindowPrewarm) return null;
  if (!prewarmedNoteWindow || prewarmedNoteWindow.isDestroyed() || prewarmedNoteWindow.isVisible()) return null;
  return prewarmedNoteWindow;
}

function clearNoteWindowPrewarmIdleTimer() {
  if (!noteWindowPrewarmIdleTimer) return;
  clearTimeout(noteWindowPrewarmIdleTimer);
  noteWindowPrewarmIdleTimer = null;
}

function armNoteWindowPrewarmIdleTimer() {
  clearNoteWindowPrewarmIdleTimer();
  if (!enableNoteWindowPrewarm || !usablePrewarmedNoteWindow()) return;
  noteWindowPrewarmIdleTimer = setTimeout(() => {
    noteWindowPrewarmIdleTimer = null;
    const warmWindow = usablePrewarmedNoteWindow();
    if (!warmWindow) return;
    suppressNextNoteWindowPrewarm = true;
    warmWindow.close();
  }, NOTE_WINDOW_PREWARM_IDLE_MS);
}

function scheduleNoteWindowPrewarm(delay = NOTE_WINDOW_PREWARM_DELAY_MS) {
  if (!enableNoteWindowPrewarm) return;
  if (isQuitting || noteWindowPrewarmTimer || usablePrewarmedNoteWindow()) return;
  noteWindowPrewarmTimer = setTimeout(() => {
    noteWindowPrewarmTimer = null;
    createPrewarmedNoteWindow();
  }, delay);
}

function createPrewarmedNoteWindow() {
  if (!enableNoteWindowPrewarm) return null;
  if (isQuitting || usablePrewarmedNoteWindow()) return null;
  const noteWindow = createNoteBrowserWindow({ showOnReady: false });
  prewarmedNoteWindow = noteWindow;
  windowContexts.set(noteWindow.id, {
    type: 'note',
    noteId: '',
    initialNote: null,
    alwaysOnTop: true
  });
  noteWindow.loadURL(appUrl({ desktopWindow: 'note', desktopWarm: '1' }));
  armNoteWindowPrewarmIdleTimer();
  return noteWindow;
}

function toggleNoteWindow(noteId, noteSnapshot) {
  const normalizedNoteId = normalizeNoteId(noteId);
  if (!normalizedNoteId) return { ok: false, error: 'Missing Note' };

  const existing = noteWindows.get(normalizedNoteId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isVisible()) {
      existing.close();
      return { ok: true, windowId: existing.id, closed: true };
    }
    const initialNote = normalizeNoteSnapshot(normalizedNoteId, noteSnapshot);
    if (!initialNote) return { ok: false, error: 'Missing Note Snapshot' };
    setNoteWindowContext(existing, normalizedNoteId, initialNote, { deferReveal: true });
    positionNoteWindowOnCursorDisplay(existing);
    return { ok: true, windowId: existing.id, reused: true, pending: true };
  }

  const initialNote = normalizeNoteSnapshot(normalizedNoteId, noteSnapshot);
  if (!initialNote) return { ok: false, error: 'Missing Note Snapshot' };
  const warmedWindow = usablePrewarmedNoteWindow();
  const existingNoteWindow = [...noteWindows.values()].find(win => win && !win.isDestroyed());
  const noteWindow = warmedWindow || existingNoteWindow || createNoteBrowserWindow({ showOnReady: false });
  const reused = !!warmedWindow || !!existingNoteWindow;
  if (reused) {
    if (warmedWindow) {
      prewarmedNoteWindow = null;
      clearNoteWindowPrewarmIdleTimer();
    }
  }

  if (existingNoteWindow?.isVisible()) hideWarmWindow(existingNoteWindow);
  setNoteWindowContext(noteWindow, normalizedNoteId, initialNote, { deferReveal: true });
  positionNoteWindowOnCursorDisplay(noteWindow);
  if (reused) {
    if (warmedWindow) scheduleNoteWindowPrewarm();
  } else {
    noteWindow.loadURL(appUrl({
      desktopWindow: 'note',
      desktopNote: normalizedNoteId
    }));
  }
  return { ok: true, windowId: noteWindow.id, reused };
}

function openNoteWindow(noteId, noteSnapshot) {
  const normalizedNoteId = normalizeNoteId(noteId);
  if (!normalizedNoteId) return { ok: false, error: 'Missing Note' };
  const existing = noteWindows.get(normalizedNoteId);
  if (existing && !existing.isDestroyed()) {
    applyNoteWindowFloatingBehavior(existing);
    if (!existing.isVisible() || existing.isMinimized()) positionNoteWindowOnCursorDisplay(existing);
    showAndFocusWhenReady(existing);
    return { ok: true, windowId: existing.id, reused: true };
  }
  return toggleNoteWindow(normalizedNoteId, noteSnapshot);
}

function windowContext(win) {
  if (!win || win.isDestroyed()) return null;
  return windowContexts.get(win.id) || null;
}

function hasVisibleApplicationWindow() {
  return BrowserWindow.getAllWindows().some(win =>
    !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  );
}

function hasVisibleNoteWindow() {
  return [...noteWindows.values()].some(win =>
    !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  );
}

function notifyMainNoteWindowPresence() {
  if (!mainWindow || mainWindow.isDestroyed() || windowContext(mainWindow)?.type !== 'main') return;
  sendRendererMessage(mainWindow, 'desktop:note-window-presence-changed', {
    hasVisibleNoteWindow: hasVisibleNoteWindow()
  });
}

function focusedWindowContext() {
  return windowContext(BrowserWindow.getFocusedWindow());
}

function sendToFocusedWindow(channel, payload) {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const win = focusedWindow || mainWindow;
  if (!win || win.isDestroyed()) return;
  if (!focusedWindow && win === mainWindow) showAndFocusWindow(win);
  win.webContents.send(channel, payload);
}

function broadcastNoteState(senderWin, state) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed() || win === senderWin) continue;
    const context = windowContext(win);
    if (!context) continue;
    if (context.type !== 'main' && context.noteId !== state.id) continue;
    sendRendererMessage(win, 'desktop:note-state-changed', state);
  }
}

function broadcastThemeState(senderWin, state) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed() || win === senderWin) continue;
    if (!windowContext(win)) continue;
    sendRendererMessage(win, 'desktop:theme-state-changed', state);
  }
}

function updateDockNotificationBadge() {
  const count = Math.max(0, ...windowNotificationCounts.values());
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(count ? (count > 99 ? '99+' : String(count)) : '');
  } else {
    app.setBadgeCount(count);
  }
}

function menuBarNoteItems() {
  return [...menuBarNotes.values()].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
  );
}

function updateMenuBarNotes(snapshots) {
  const previousNotes = new Map(menuBarNotes);
  const nextNotes = new Map();
  if (!Array.isArray(snapshots)) return;
  snapshots.slice(0, 2000).forEach(snapshot => {
    const noteId = normalizeNoteId(snapshot?.id || snapshot?.noteId);
    if (!noteId) return;
    const normalized = normalizeNoteSnapshot(noteId, snapshot);
    if (!normalized || normalized.deletedAt) return;
    const preloaded = previousNotes.get(noteId);
    if (noteId === menuBarSettings.noteId && preloaded?.bodyLoaded && !normalized.bodyLoaded) {
      normalized.content = preloaded.content;
      normalized.bodyLoaded = true;
    }
    nextNotes.set(noteId, normalized);
  });
  menuBarNotes.clear();
  nextNotes.forEach((note, noteId) => menuBarNotes.set(noteId, note));
}

function updatePreloadedMenuBarNote(snapshot) {
  const noteId = normalizeNoteId(snapshot?.id || snapshot?.noteId);
  if (!noteId || menuBarSettings.mode !== 'note' || menuBarSettings.noteId !== noteId) return;
  const normalized = normalizeNoteSnapshot(noteId, snapshot);
  if (!normalized || normalized.deletedAt || !normalized.bodyLoaded) return;
  menuBarNotes.set(noteId, normalized);
}

function revealMainWindow() {
  if (!appBaseUrl) return null;
  const win = createMainWindow({ showOnReady: false, showExisting: false });
  showAndFocusWhenReady(win);
  return win;
}

function flushPendingMainRendererMessages() {
  const win = mainWindow;
  if (!win || win.isDestroyed() || mainRendererReadyWindowId !== win.id) return;
  const messages = pendingMainRendererMessages.splice(0);
  messages.forEach(({ channel, payload }) => win.webContents.send(channel, payload));
}

function requestMainRenderer(channel, payload) {
  const win = revealMainWindow();
  if (!win) return;
  pendingMainRendererMessages.push({ channel, payload });
  flushPendingMainRendererMessages();
}

function isVisibleWindow(win) {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
}

function hideMenuBarTargetIfVisible() {
  const targetWindow = menuBarSettings.mode === 'note' && menuBarSettings.noteId
    ? noteWindows.get(menuBarSettings.noteId)
    : mainWindow;
  if (!isVisibleWindow(targetWindow)) return false;
  hideWarmWindow(targetWindow);
  return true;
}

function toggleMenuBarTarget() {
  if (hideMenuBarTargetIfVisible()) return;
  if (menuBarSettings.mode === 'note' && menuBarSettings.noteId) {
    const snapshot = menuBarNotes.get(menuBarSettings.noteId);
    if (snapshot) {
      openNoteWindow(menuBarSettings.noteId, snapshot);
      return;
    }
    requestMainRenderer('desktop:menubar-open-note', { noteId: menuBarSettings.noteId });
    return;
  }
  requestMainRenderer('desktop:menubar-open-new-note');
}

function selectMenuBarNote(note) {
  saveMenuBarSettings({ mode: 'note', noteId: note.id, noteTitle: note.title });
}

function buildMenuBarContextMenu() {
  const notes = menuBarNoteItems();
  const noteSubmenu = notes.length
    ? notes.map(note => ({
        label: note.title.slice(0, 70),
        type: 'radio',
        checked: menuBarSettings.mode === 'note' && menuBarSettings.noteId === note.id,
        click: () => selectMenuBarNote(note)
      }))
    : [{ label: 'No Notes Available', enabled: false }];

  return Menu.buildFromTemplate([
    {
      label: 'New Note',
      type: 'radio',
      checked: menuBarSettings.mode === 'new',
      click: () => saveMenuBarSettings({ mode: 'new' })
    },
    { label: 'Specific Note', submenu: noteSubmenu },
    { type: 'separator' },
    { label: 'Open Notas', click: revealMainWindow },
    { label: 'Quit Notas', role: 'quit' }
  ]);
}

function createMenuBarTray() {
  if (menuBarTray) return menuBarTray;
  let trayImage = nativeImage.createFromPath(menuBarIconPath);
  if (!trayImage.isEmpty()) trayImage = trayImage.resize({ width: 18, height: 18 });
  menuBarTray = new Tray(trayImage);
  menuBarTray.setToolTip(APP_NAME);
  menuBarTray.on('click', toggleMenuBarTarget);
  menuBarTray.on('right-click', () => menuBarTray?.popUpContextMenu(buildMenuBarContextMenu()));
  return menuBarTray;
}

function toggleFocusedNoteWindow() {
  const win = BrowserWindow.getFocusedWindow();
  const context = windowContext(win);
  if (win && context?.type === 'note') {
    win.close();
    return;
  }
  sendToFocusedWindow('desktop:open-active-note');
}

function buildApplicationMenu() {
  const template = [];

  if (process.platform === 'darwin') {
    template.push({
      label: APP_NAME,
      submenu: [
        { label: 'About Notas', role: 'about' },
        { type: 'separator' },
        { label: 'Services', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: 'Hide Notas', role: 'hide' },
        { label: 'Hide Others', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit Notas', role: 'quit' }
      ]
    });
  }

  template.push(
    {
      label: 'File',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToFocusedWindow('desktop:new-note')
        },
        {
          label: 'Toggle Pop Out Note',
          accelerator: 'CmdOrCtrl+P',
          click: toggleFocusedNoteWindow
        },
        { type: 'separator' },
        { label: 'Close Window', role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', role: 'undo' },
        { label: 'Redo', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
        { label: 'Select All', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', role: 'reload' },
        {
          label: 'Toggle Developer Tools',
          role: 'toggleDevTools',
          visible: !app.isPackaged
        },
        { type: 'separator' },
        { label: 'Actual Size', role: 'resetZoom' },
        { label: 'Zoom In', role: 'zoomIn' },
        { label: 'Zoom Out', role: 'zoomOut' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', role: 'minimize' },
        { label: 'Zoom', role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' },
              { label: 'Bring All To Front', role: 'front' }
            ]
          : [])
      ]
    }
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  ipcMain.on('desktop:renderer-ready', event => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || senderWin !== mainWindow || windowContext(senderWin)?.type !== 'main') return;
    mainRendererReadyWindowId = senderWin.id;
    flushPendingMainRendererMessages();
  });

  ipcMain.on('desktop:prewarm-note-window', event => {
    if (!enableNoteWindowPrewarm) return;
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const senderContext = windowContext(senderWin);
    if (!senderWin || senderContext?.type !== 'main') return;
    scheduleNoteWindowPrewarm(0);
  });

  ipcMain.on('desktop:note-state-changed', (event, payload) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const senderContext = windowContext(senderWin);
    if (!senderWin || !senderContext) return;
    const state = normalizeNoteState(payload);
    if (!state) return;
    if (senderContext.type === 'note' && senderContext.noteId !== state.id) return;
    if (senderContext.type === 'note') {
      senderWin.setTitle(`${state.title} - ${APP_NAME}`);
    }
    broadcastNoteState(senderWin, state);
  });

  ipcMain.on('desktop:theme-state-changed', (event, payload) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || !windowContext(senderWin)) return;
    const state = normalizeThemeState(payload);
    if (!state) return;
    lastThemeState = state;
    broadcastThemeState(senderWin, state);
  });

  ipcMain.on('desktop:menubar-notes-changed', (event, snapshots) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || windowContext(senderWin)?.type !== 'main') return;
    updateMenuBarNotes(snapshots);
  });

  ipcMain.on('desktop:menubar-note-preloaded', (event, snapshot) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || windowContext(senderWin)?.type !== 'main') return;
    updatePreloadedMenuBarNote(snapshot);
  });

  ipcMain.on('desktop:note-window-ready', (event, noteId) => {
    const noteWindow = BrowserWindow.fromWebContents(event.sender);
    const context = windowContext(noteWindow);
    const normalizedNoteId = normalizeNoteId(noteId);
    if (!noteWindow || context?.type !== 'note' || !context.pendingShow || !normalizedNoteId || context.noteId !== normalizedNoteId) return;
    context.pendingShow = false;
    applyNoteWindowFloatingBehavior(noteWindow);
    showAndFocusWindow(noteWindow);
  });

  ipcMain.handle('desktop:get-window-context', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const context = windowContext(win) || { type: 'main', alwaysOnTop: false };
    return rendererWindowContext(win, context);
  });

  ipcMain.handle('desktop:open-note-window', (_event, noteId, noteSnapshot) => toggleNoteWindow(noteId, noteSnapshot));

  ipcMain.handle('desktop:get-menubar-settings', () => menuBarSettings);

  ipcMain.handle('desktop:set-menubar-settings', (event, settings) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || windowContext(senderWin)?.type !== 'main') return menuBarSettings;
    return saveMenuBarSettings(settings);
  });

  ipcMain.handle('desktop:set-window-title', (event, title) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const context = windowContext(win);
    if (!win || context?.type !== 'note') return false;
    const normalizedTitle = String(title || '').trim() || 'Untitled Note';
    win.setTitle(`${normalizedTitle} - ${APP_NAME}`);
    return true;
  });

  ipcMain.handle('desktop:set-dock-notification-count', (event, count) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    const normalized = Math.max(0, Math.min(999, Math.trunc(Number(count) || 0)));
    windowNotificationCounts.set(win.id, normalized);
    updateDockNotificationBadge();
    return true;
  });
}

app.setName(APP_NAME);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

function configureMacDesktopApp() {
  if (process.platform !== 'darwin') return;
  app.setActivationPolicy('regular');
}

async function showMacDesktopApp() {
  if (process.platform !== 'darwin') return;
  app.setActivationPolicy('regular');
  await app.dock.show();
}

function restoreMainWindowIfNeeded() {
  if (!appBaseUrl || hasVisibleApplicationWindow()) return;
  revealMainWindow();
}

if (hasSingleInstanceLock) {
  configureMacDesktopApp();

  app.on('second-instance', () => {
    revealMainWindow();
  });

  if (process.platform === 'darwin') {
    app.on('activate', restoreMainWindowIfNeeded);
    app.on('did-become-active', restoreMainWindowIfNeeded);
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => {
    event.preventDefault();
  });
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  await showMacDesktopApp();
  registerIpcHandlers();
  loadMenuBarSettings();

  const externalUrl = process.env[ELECTRON_URL_ENV];
  if (externalUrl) {
    appBaseUrl = externalUrl;
  } else {
    const localServer = await startStaticServer();
    staticServer = localServer.server;
    appBaseUrl = localServer.url;
  }

  createMainWindow();
  createMenuBarTray();
  buildApplicationMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (menuBarTray) {
    menuBarTray.destroy();
    menuBarTray = null;
  }
  if (noteWindowPrewarmTimer) {
    clearTimeout(noteWindowPrewarmTimer);
    noteWindowPrewarmTimer = null;
  }
  clearNoteWindowPrewarmIdleTimer();
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
});
