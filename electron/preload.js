const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  rendererReady: () => ipcRenderer.send('desktop:renderer-ready'),
  getWindowContext: () => ipcRenderer.invoke('desktop:get-window-context'),
  openNoteWindow: (noteId, initialNote) => ipcRenderer.invoke('desktop:open-note-window', noteId, initialNote || null),
  prewarmNoteWindow: () => ipcRenderer.send('desktop:prewarm-note-window'),
  updateNoteState: noteState => ipcRenderer.send('desktop:note-state-changed', noteState || null),
  updateThemeState: themeState => ipcRenderer.send('desktop:theme-state-changed', themeState || null),
  setDockNotificationCount: count => ipcRenderer.invoke('desktop:set-dock-notification-count', count),
  setWindowTitle: title => ipcRenderer.invoke('desktop:set-window-title', title),
  getMenuBarSettings: () => ipcRenderer.invoke('desktop:get-menubar-settings'),
  setMenuBarSettings: settings => ipcRenderer.invoke('desktop:set-menubar-settings', settings || null),
  updateMenuBarNotes: notes => ipcRenderer.send('desktop:menubar-notes-changed', Array.isArray(notes) ? notes : []),
  preloadMenuBarNote: note => ipcRenderer.send('desktop:menubar-note-preloaded', note || null),
  noteWindowReady: noteId => ipcRenderer.send('desktop:note-window-ready', noteId || ''),
  onWindowContextUpdated: callback => on('desktop:window-context-updated', callback),
  onNoteWindowPresenceChanged: callback => on('desktop:note-window-presence-changed', callback),
  onNoteStateChanged: callback => on('desktop:note-state-changed', callback),
  onThemeStateChanged: callback => on('desktop:theme-state-changed', callback),
  onWindowForegrounded: callback => on('desktop:window-foregrounded', callback),
  onOpenActiveNote: callback => on('desktop:open-active-note', callback),
  onNewNote: callback => on('desktop:new-note', callback),
  onMenuBarSettingsChanged: callback => on('desktop:menubar-settings-changed', callback),
  onMenuBarOpenNewNote: callback => on('desktop:menubar-open-new-note', callback),
  onMenuBarOpenNote: callback => on('desktop:menubar-open-note', callback)
});
