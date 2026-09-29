const { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, nativeImage, nativeTheme, screen, shell } = require('electron');
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
const menuBarTemplateIconPath = path.join(serveRoot, 'notas-menubar-iconTemplate.png');

let appBaseUrl = '';
let staticServer = null;
let mainWindow = null;
let menuBarTray = null;
let menuBarSettingsPath = '';
let menuBarSettings = { mode: 'new', noteId: '', noteTitle: '' };
let mainRendererReadyWindowId = 0;
const pendingMainRendererMessages = [];
let isQuitting = false;
let lastThemeState = null;

const windowContexts = new Map();
const noteWindows = new Map();
const windowNotificationCounts = new Map();
const menuBarNotes = new Map();

const keepMainWindowWarm = process.platform === 'darwin';
const MAIN_WINDOW_OPTIONS = {
  width: 1280,
  height: 880,
  minWidth: 900,
  minHeight: 620,
  title: APP_NAME
};
const SECONDARY_WINDOW_OFFSET = 28;
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
  sendToMainWindows('desktop:menubar-settings-changed', menuBarSettings);
  warmDefaultNoteWindow();
  return menuBarSettings;
}

function normalizeThemeState(state) {
  if (!state || typeof state !== 'object') return null;
  const mode = ['light', 'dark', 'system'].includes(state.mode) ? state.mode : '';
  const accent = String(state.accent || '').trim();
  const accentMode = ['notas', 'bg', 'custom'].includes(state.accentMode) ? state.accentMode : 'custom';
  const fontSize = Math.trunc(Number(state.fontSize) || 0);
  const lineHeight = Number(state.lineHeight);
  if (!mode || !/^#[0-9a-f]{6}$/i.test(accent) || fontSize < 10 || fontSize > 26) return null;
  return {
    mode,
    accent: accent.toLowerCase(),
    accentMode,
    fontSize,
    lineHeight: Number.isFinite(lineHeight)
      ? Math.max(1.2, Math.min(2.2, Math.round(lineHeight * 100) / 100))
      : 1.66,
    textStylingVisible: state.textStylingVisible !== false
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
    backgroundThrottling: false
  };
  if (includePreload) preferences.preload = preloadPath;
  return preferences;
}

function contextMenuFrame(win, params = {}) {
  return params.frame || win?.webContents?.focusedFrame || win?.webContents?.mainFrame || undefined;
}

function lookupLabel(selectionText) {
  const snippet = String(selectionText || '').trim().replace(/\s+/g, ' ');
  if (!snippet) return '';
  const clipped = snippet.length > 32 ? `${snippet.slice(0, 32)}…` : snippet;
  return `Look Up “${clipped}”`;
}

function buildNativeContextMenuTemplate(win, params = {}, { editable } = {}) {
  const isEditable = editable ?? !!params.isEditable;
  const selectionText = String(params.selectionText || '').trim();
  const hasSelection = !!selectionText;
  const editFlags = params.editFlags || {};
  const misspelledWord = String(params.misspelledWord || '').trim();
  const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : [];
  const template = [];

  if (misspelledWord) {
    const validSuggestions = suggestions.map(suggestion => String(suggestion || '').trim()).filter(Boolean);
    validSuggestions.forEach(label => {
      template.push({
        label,
        click: () => win.webContents.replaceMisspelling(label)
      });
    });
    if (validSuggestions.length) template.push({ type: 'separator' });
    template.push({
      label: 'Learn Spelling',
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(misspelledWord)
    });
    template.push({ type: 'separator' });
  }

  if (process.platform === 'darwin' && hasSelection) {
    template.push({
      label: lookupLabel(selectionText),
      click: () => win.webContents.showDefinitionForSelection()
    });
    template.push({ type: 'separator' });
  }

  if (isEditable) {
    template.push(
      { role: 'undo', enabled: editFlags.canUndo !== false },
      { role: 'redo', enabled: editFlags.canRedo !== false },
      { type: 'separator' },
      { role: 'cut', enabled: editFlags.canCut !== false },
      { role: 'copy', enabled: editFlags.canCopy !== false },
      { role: 'paste', enabled: editFlags.canPaste !== false },
      { role: 'pasteAndMatchStyle', enabled: editFlags.canPaste !== false },
      { role: 'delete', enabled: editFlags.canDelete !== false },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll !== false }
    );
  } else {
    template.push(
      { role: 'copy', enabled: hasSelection || editFlags.canCopy === true },
      { role: 'selectAll', enabled: editFlags.canSelectAll !== false }
    );
  }

  if (process.platform === 'darwin') {
    const sharingItems = {};
    if (hasSelection) sharingItems.texts = [selectionText];
    if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) sharingItems.urls = [params.linkURL];
    template.push({ type: 'separator' });
    if (Object.keys(sharingItems).length) {
      template.push({ role: 'shareMenu', sharingItems });
      template.push({ type: 'separator' });
    }
    template.push({
      label: 'Speech',
      submenu: [
        { role: 'startSpeaking' },
        { role: 'stopSpeaking' }
      ]
    });
  }

  if (app.isPackaged === false) {
    template.push(
      { type: 'separator' },
      { label: 'Inspect Element', click: () => win.webContents.inspectElement(params.x || 0, params.y || 0) }
    );
  }

  return template;
}

function popupNativeContextMenu(win, params = {}, options = {}) {
  if (!win || win.isDestroyed()) return;
  const template = buildNativeContextMenuTemplate(win, params, options);
  const popupOptions = { window: win };
  const frame = contextMenuFrame(win, params);
  if (frame) popupOptions.frame = frame;
  if (Number.isFinite(params?.x) && Number.isFinite(params?.y)) {
    popupOptions.x = Math.max(0, Math.trunc(params.x));
    popupOptions.y = Math.max(0, Math.trunc(params.y));
  }
  try {
    Menu.buildFromTemplate(template).popup(popupOptions);
  } catch (err) {
    console.error('context menu:', err);
    delete popupOptions.frame;
    Menu.buildFromTemplate(template).popup(popupOptions);
  }
}

function showEditorImageContextMenu(win, payload = {}) {
  popupNativeContextMenu(win, payload, { editable: payload?.editable === true });
}

function configureWindowSecurity(win) {
  win.webContents.on('context-menu', (_event, params) => {
    if (params.mediaType === 'image' && isAppUrl(params.pageURL || win.webContents.getURL())) return;
    popupNativeContextMenu(win, params);
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
    ensureMacDesktopAppVisible();
    if (app.isHidden()) app.show();
    if (!app.isActive()) app.focus({ steal: true });
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  refreshWindowAfterForegrounding(win);
}

function windowBackgroundForTheme(state = lastThemeState) {
  const systemLight = nativeTheme.shouldUseDarkColors === false;
  const light = state?.mode === 'light' || (state?.mode === 'system' && systemLight);
  if (state?.accentMode === 'bg') return light ? '#e6e6e6' : '#070707';
  if (state?.accentMode === 'custom') return light ? '#d7e4f0' : '#050a12';
  return light ? '#d7e4f0' : '#02070f';
}

function applyWindowBackgroundColor(win, state = lastThemeState) {
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(windowBackgroundForTheme(state));
}

function applyWindowBackgrounds(state = lastThemeState) {
  BrowserWindow.getAllWindows().forEach(win => applyWindowBackgroundColor(win, state));
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

function repaintWindow(win) {
  if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible()) return;
  sendRendererMessage(win, 'desktop:window-foregrounded');
}

function refreshWindowAfterForegrounding(win) {
  if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible()) return;
  if (win._notasForegroundFrame) return;
  win._notasForegroundFrame = setTimeout(() => {
    win._notasForegroundFrame = 0;
    repaintWindow(win);
  }, 0);
}

function refreshApplicationWindowsAfterForegrounding() {
  BrowserWindow.getAllWindows().forEach(refreshWindowAfterForegrounding);
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
  const { webPreferences: webPreferencesOverrides, ...windowOptions } = options;
  const win = new BrowserWindow({
    backgroundColor: windowBackgroundForTheme(),
    icon: iconPath,
    show: false,
    paintWhenInitiallyHidden: true,
    skipTaskbar: false,
    focusable: true,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 13, y: 15 }
    } : {}),
    ...windowOptions,
    webPreferences: {
      ...secureWebPreferences(true),
      ...webPreferencesOverrides
    }
  });

  configureWindowSecurity(win);
  win.webContents.on('before-input-event', (event, input) => {
    if (!input || input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    if ((input.meta || input.control) && !input.alt && !input.shift && key === 'w') {
      event.preventDefault();
    }
  });
  if (behavior.showImmediately) win.show();
  else if (behavior.showOnReady !== false) showWindowWhenReady(win);
  win.on('close', event => {
    const context = windowContexts.get(win.id);
    if (isQuitting) return;
    if (context?.type === 'note' && defaultNoteWindowNoteId()) {
      event.preventDefault();
      hideWarmWindow(win);
      warmDefaultNoteWindow();
      return;
    }
    if (!keepMainWindowWarm || context?.type !== 'main' || win !== mainWindow) return;
    event.preventDefault();
    hideWarmWindow(win);
  });
  win.on('focus', () => {
    buildApplicationMenu();
    refreshWindowAfterForegrounding(win);
  });
  win.on('blur', buildApplicationMenu);
  win.on('show', () => {
    refreshWindowAfterForegrounding(win);
    if (windowContext(win)?.type === 'note') notifyMainNoteWindowPresence();
  });
  win.on('restore', () => refreshWindowAfterForegrounding(win));
  win.on('hide', () => {
    if (windowContext(win)?.type === 'note') notifyMainNoteWindowPresence();
  });
  win.webContents.on('did-finish-load', () => refreshWindowAfterForegrounding(win));
  win.on('closed', () => {
    const context = windowContexts.get(win.id);
    if (context?.type === 'main' && mainWindow === win) {
      mainWindow = null;
      if (!isQuitting && process.platform !== 'darwin') app.quit();
    }
    if (context?.type === 'note' && context.noteId) noteWindows.delete(context.noteId);
    windowContexts.delete(win.id);
    windowNotificationCounts.delete(win.id);
    updateDockNotificationBadge();
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

  mainWindow = createWindow(MAIN_WINDOW_OPTIONS, behavior);
  windowContexts.set(mainWindow.id, { type: 'main', alwaysOnTop: false });
  mainRendererReadyWindowId = 0;
  mainWindow.webContents.on('did-start-loading', () => {
    if (mainWindow && mainWindow.id === mainRendererReadyWindowId) mainRendererReadyWindowId = 0;
  });
  mainWindow.loadURL(appUrl({ desktopWindow: 'main' }));
  return mainWindow;
}

// Dock "New Window" allows at most two main windows: the warm primary plus one secondary.
function openNewMainWindow() {
  if (!appBaseUrl) return;
  if (!mainWindow || mainWindow.isDestroyed() || !(mainWindow.isVisible() || mainWindow.isMinimized())) {
    revealMainWindow();
    return;
  }
  const secondaryWindow = BrowserWindow.getAllWindows().find(win =>
    win !== mainWindow && windowContext(win)?.type === 'main'
  );
  if (secondaryWindow) {
    showAndFocusWindow(secondaryWindow);
    return;
  }
  const { x, y } = mainWindow.getBounds();
  const win = createWindow({
    ...MAIN_WINDOW_OPTIONS,
    x: x + SECONDARY_WINDOW_OFFSET,
    y: y + SECONDARY_WINDOW_OFFSET
  });
  windowContexts.set(win.id, { type: 'main', alwaysOnTop: false });
  win.loadURL(appUrl({ desktopWindow: 'main' }));
}

function createNoteBrowserWindow(behavior = {}) {
  const noteWindow = createWindow({
    width: 760,
    height: 760,
    title: 'Notas Note',
    alwaysOnTop: true,
    fullscreenable: false
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
  // Skipping the process transform avoids the Dock icon briefly hiding on every call.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
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
    ready: false,
    pendingShow: options.deferReveal === true
  };
  windowContexts.set(noteWindow.id, context);
  if (noteId) noteWindows.set(noteId, noteWindow);
  noteWindow.setTitle(initialNote?.title ? `${initialNote.title} - ${APP_NAME}` : 'Notas Note');
  applyNoteWindowFloatingBehavior(noteWindow);
  sendWindowContext(noteWindow);
  buildApplicationMenu();
}

function defaultNoteWindowNoteId() {
  return menuBarSettings.mode === 'note' ? menuBarSettings.noteId : '';
}

// Only one pop out window exists; it is retargeted between notes rather than duplicated.
function currentNoteWindow() {
  return [...noteWindows.values()].find(win => !win.isDestroyed()) || null;
}

function noteWindowInUse(win) {
  return !!win && (win.isVisible() || win.isMinimized() || !!windowContext(win)?.pendingShow);
}

// Keeps one hidden pop out preloaded with the menu bar default note so it opens instantly.
function warmDefaultNoteWindow() {
  if (isQuitting || !appBaseUrl) return;
  const noteWindow = currentNoteWindow();
  if (noteWindowInUse(noteWindow)) return;
  const noteId = defaultNoteWindowNoteId();
  if (!noteId) {
    noteWindow?.close();
    return;
  }
  const snapshot = menuBarNotes.get(noteId);
  if (!snapshot?.bodyLoaded || windowContext(noteWindow)?.noteId === noteId) return;
  const warmWindow = noteWindow || createNoteBrowserWindow({ showOnReady: false });
  setNoteWindowContext(warmWindow, noteId, snapshot);
  if (!noteWindow) warmWindow.loadURL(appUrl({ desktopWindow: 'note', desktopNote: noteId }));
}

function revealNoteWindow(win) {
  const context = windowContext(win);
  if (!context) return;
  if (!win.isVisible() || win.isMinimized()) positionNoteWindowOnCursorDisplay(win);
  if (!context.ready) {
    context.pendingShow = true;
    return;
  }
  applyNoteWindowFloatingBehavior(win);
  showAndFocusWindow(win);
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
    // A hidden pop out may have missed edits made in the sender window.
    const latestNote = normalizeNoteSnapshot(normalizedNoteId, noteSnapshot);
    if (latestNote?.bodyLoaded) sendRendererMessage(existing, 'desktop:note-state-changed', latestNote);
    revealNoteWindow(existing);
    return { ok: true, windowId: existing.id, reused: true };
  }

  const initialNote = normalizeNoteSnapshot(normalizedNoteId, noteSnapshot);
  if (!initialNote) return { ok: false, error: 'Missing Note Snapshot' };
  const existingNoteWindow = currentNoteWindow();
  const noteWindow = existingNoteWindow || createNoteBrowserWindow({ showOnReady: false });

  if (existingNoteWindow?.isVisible()) hideWarmWindow(existingNoteWindow);
  setNoteWindowContext(noteWindow, normalizedNoteId, initialNote, { deferReveal: true });
  positionNoteWindowOnCursorDisplay(noteWindow);
  if (!existingNoteWindow) {
    noteWindow.loadURL(appUrl({
      desktopWindow: 'note',
      desktopNote: normalizedNoteId
    }));
  }
  return { ok: true, windowId: noteWindow.id, reused: !!existingNoteWindow };
}

function openNoteWindow(noteId, noteSnapshot) {
  const normalizedNoteId = normalizeNoteId(noteId);
  if (!normalizedNoteId) return { ok: false, error: 'Missing Note' };
  const existing = noteWindows.get(normalizedNoteId);
  if (existing && !existing.isDestroyed()) {
    revealNoteWindow(existing);
    return { ok: true, windowId: existing.id, reused: true };
  }
  return toggleNoteWindow(normalizedNoteId, noteSnapshot);
}

function windowContext(win) {
  if (!win || win.isDestroyed()) return null;
  return windowContexts.get(win.id) || null;
}

function hasVisibleNoteWindow() {
  return [...noteWindows.values()].some(win =>
    !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  );
}

function notifyMainNoteWindowPresence() {
  sendToMainWindows('desktop:note-window-presence-changed', { hasVisibleNoteWindow: hasVisibleNoteWindow() });
}

function sendToMainWindows(channel, payload) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (windowContext(win)?.type === 'main') sendRendererMessage(win, channel, payload);
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
  warmDefaultNoteWindow();
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

function loadMenuBarTrayImage() {
  const template2xPath = path.join(serveRoot, 'notas-menubar-iconTemplate@2x.png');
  let trayImage = nativeImage.createEmpty();
  try {
    trayImage.addRepresentation({ scaleFactor: 1, buffer: readFileSync(menuBarTemplateIconPath) });
    trayImage.addRepresentation({ scaleFactor: 2, buffer: readFileSync(template2xPath) });
  } catch {
    trayImage = nativeImage.createFromPath(menuBarTemplateIconPath);
  }
  if (trayImage.isEmpty()) {
    trayImage = nativeImage.createFromPath(menuBarIconPath);
    if (!trayImage.isEmpty()) trayImage = trayImage.resize({ width: 18, height: 18 });
  }
  if (!trayImage.isEmpty() && process.platform === 'darwin') trayImage.setTemplateImage(true);
  return trayImage;
}

function createMenuBarTray() {
  if (menuBarTray) return menuBarTray;
  menuBarTray = new Tray(loadMenuBarTrayImage());
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
        { label: 'Close Window', enabled: false }
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
    applyWindowBackgrounds(state);
    broadcastThemeState(senderWin, state);
  });

  ipcMain.on('desktop:editor-image-context-menu', (event, payload) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || !windowContext(senderWin) || !isAppUrl(event.sender.getURL())) return;
    showEditorImageContextMenu(senderWin, payload);
  });

  ipcMain.handle('desktop:write-editor-image-to-clipboard', (event, payload) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || !windowContext(senderWin) || !isAppUrl(event.sender.getURL())) return false;
    const dataUrl = String(payload?.dataUrl || '').trim();
    if (dataUrl.length > 16 * 1024 * 1024 || !/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(dataUrl)) return false;
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return false;
    const text = String(payload?.text || 'Image').slice(0, 512);
    const html = String(payload?.html || '').slice(0, 2 * 1024 * 1024);
    clipboard.write({ image, text, html });
    return true;
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
    if (!noteWindow || context?.type !== 'note' || !normalizedNoteId || context.noteId !== normalizedNoteId) return;
    context.ready = true;
    if (!context.pendingShow) return;
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

function ensureMacDesktopAppVisible() {
  if (process.platform !== 'darwin') return;
  configureMacDesktopApp();
  if (!app.dock || app.dock.isVisible()) return;
  app.dock.show().catch(err => console.warn('show Dock icon:', err));
}

async function showMacDesktopApp() {
  if (process.platform !== 'darwin') return;
  configureMacDesktopApp();
  if (app.dock && !app.dock.isVisible()) await app.dock.show();
}

function restoreMainWindowIfNeeded(_event, hasVisibleWindows) {
  ensureMacDesktopAppVisible();
  if (!appBaseUrl) return;
  if (hasVisibleWindows) {
    refreshApplicationWindowsAfterForegrounding();
    return;
  }
  revealMainWindow();
}

function refreshMacApplicationAfterActivation() {
  ensureMacDesktopAppVisible();
  refreshApplicationWindowsAfterForegrounding();
}

if (hasSingleInstanceLock) {
  configureMacDesktopApp();

  app.on('second-instance', () => {
    revealMainWindow();
  });

  if (process.platform === 'darwin') {
    app.on('activate', restoreMainWindowIfNeeded);
    app.on('did-become-active', refreshMacApplicationAfterActivation);
  }
  nativeTheme.on('updated', () => applyWindowBackgrounds());
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
  if (process.platform === 'darwin') {
    app.dock?.setMenu(Menu.buildFromTemplate([{ label: 'New Window', click: openNewMainWindow }]));
  }
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
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
});
