(() => {
  const handler = window.webkit.messageHandlers.notas;
  const listeners = new Map();
  const request = (method, ...args) => handler.postMessage({ method, args });
  const notify = (method, ...args) => {
    request(method, ...args).catch(error => console.error(`Desktop ${method}:`, error));
  };
  const subscribe = (event, callback) => {
    if (typeof callback !== 'function') return () => {};
    if (!listeners.has(event)) listeners.set(event, new Set());
    const callbacks = listeners.get(event);
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  };

  Object.defineProperties(window, {
    notasDesktopReceive: { value: (event, payload) => {
      listeners.get(event)?.forEach(callback => callback(payload));
    } },
    desktop: { value: Object.freeze({
      isDesktop: true,
      isMacNative: true,
      rendererReady: () => notify('rendererReady'),
      getWindowContext: () => request('getWindowContext'),
      openNoteWindow: (id, note) => request('openNoteWindow', id, note || null),
      showEditorImageContextMenu: payload => notify('showEditorImageContextMenu', payload),
      writeEditorImageToClipboard: payload => request('writeEditorImageToClipboard', payload),
      updateNoteState: note => notify('updateNoteState', note),
      updateThemeState: theme => notify('updateThemeState', theme),
      setDockNotificationCount: count => request('setDockNotificationCount', count),
      setWindowTitle: title => request('setWindowTitle', title),
      getMenuBarSettings: () => request('getMenuBarSettings'),
      setMenuBarSettings: settings => request('setMenuBarSettings', settings),
      updateMenuBarNotes: notes => notify('updateMenuBarNotes', notes),
      preloadMenuBarNote: note => notify('preloadMenuBarNote', note),
      noteWindowReady: id => notify('noteWindowReady', id),
      setAccount: uid => notify('setAccount', uid),
      signInWithGoogle: projectId => request('signInWithGoogle', projectId),
      onWindowContextUpdated: callback => subscribe('windowContextUpdated', callback),
      onNoteWindowPresenceChanged: callback => subscribe('noteWindowPresenceChanged', callback),
      onNoteStateChanged: callback => subscribe('noteStateChanged', callback),
      onThemeStateChanged: callback => subscribe('themeStateChanged', callback),
      onWindowForegrounded: callback => subscribe('windowForegrounded', callback),
      onOpenActiveNote: callback => subscribe('openActiveNote', callback),
      onNewNote: callback => subscribe('newNote', callback),
      onOpenSettings: callback => subscribe('openSettings', callback),
      onMenuBarSettingsChanged: callback => subscribe('menuBarSettingsChanged', callback),
      onMenuBarOpenNewNote: callback => subscribe('menuBarOpenNewNote', callback),
      onMenuBarOpenNote: callback => subscribe('menuBarOpenNote', callback)
    }) }
  });
})();
