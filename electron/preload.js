const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  getWindowContext: () => ipcRenderer.invoke('desktop:get-window-context'),
  openNoteWindow: (noteId, initialNote) => ipcRenderer.invoke('desktop:open-note-window', noteId, initialNote || null),
  prewarmNoteWindow: () => ipcRenderer.send('desktop:prewarm-note-window'),
  updateNoteState: noteState => ipcRenderer.send('desktop:note-state-changed', noteState || null),
  updateThemeState: themeState => ipcRenderer.send('desktop:theme-state-changed', themeState || null),
  setAlwaysOnTop: enabled => ipcRenderer.invoke('desktop:set-always-on-top', !!enabled),
  setDockNotificationCount: count => ipcRenderer.invoke('desktop:set-dock-notification-count', count),
  setWindowTitle: title => ipcRenderer.invoke('desktop:set-window-title', title),
  onWindowContextUpdated: callback => on('desktop:window-context-updated', callback),
  onNoteStateChanged: callback => on('desktop:note-state-changed', callback),
  onThemeStateChanged: callback => on('desktop:theme-state-changed', callback),
  onOpenActiveNote: callback => on('desktop:open-active-note', callback),
  onNewNote: callback => on('desktop:new-note', callback),
  onAlwaysOnTopChanged: callback => on('desktop:always-on-top-changed', callback)
});
