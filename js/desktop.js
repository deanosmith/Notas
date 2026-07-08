(function initDesktopBridge() {
  if (!window.desktop?.isElectron) return;

  const params = new URLSearchParams(location.search);
  let desktopContext = {
    type: params.get('desktopWindow') === 'note' ? 'note' : 'main',
    noteId: params.get('desktopNote') || '',
    initialNote: null,
    isAlwaysOnTop: false
  };
  let popoutButton = null;
  let alwaysOnTopButton = null;
  let requestedNoteOpened = false;
  let lastDockNotificationCount = -1;
  let dockNotificationFrame = 0;
  let noteStateFrame = 0;
  let themeStateFrame = 0;
  let applyingRemoteNoteState = false;
  let applyingRemoteThemeState = false;

  document.body.classList.add('desktop-app');
  if (desktopContext.type === 'note') document.body.classList.add('desktop-note-window');

  function activeNote() {
    return activeId && notes[activeId] ? notes[activeId] : null;
  }

  function shallowObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  }

  function shallowArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function activeNoteSnapshot() {
    const note = activeNote();
    if (!note) return null;
    const canEdit = typeof canEditNote === 'function' ? canEditNote(note) : true;
    const directAccess = typeof directAccessForNote === 'function' ? directAccessForNote(note.id) : null;
    return {
      id: note.id,
      title: note.title || 'Untitled Note',
      content: typeof note.content === 'string' ? note.content : '',
      owner: note.owner || '',
      folderId: note.folderId || null,
      public: !!note.public,
      linkPublic: !!note.linkPublic,
      publicFolderIds: shallowArray(note.publicFolderIds),
      sharedWith: shallowObject(note.sharedWith),
      sharedAccessKeys: shallowArray(note.sharedAccessKeys),
      mentionedUids: shallowArray(note.mentionedUids),
      pinnedAt: note.pinnedAt || '',
      pinScope: note.pinScope || '',
      deletedAt: note.deletedAt || '',
      trashExpiresAt: note.trashExpiresAt || '',
      directAccessRole: note.directAccessRole || directAccess?.role || (canEdit ? 'editor' : ''),
      directAccess: note.directAccess || directAccess || null,
      created: note.created || new Date().toISOString(),
      modified: note.modified || new Date().toISOString()
    };
  }

  function currentDesktopThemeState() {
    const mode = ['light', 'dark', 'system'].includes(themeMode) ? themeMode : 'dark';
    const accent = typeof normalizeAccentColor === 'function' ? normalizeAccentColor(accentColor) : '#08c1ff';
    const fontSize = Math.max(12, Math.min(24, Math.trunc(Number(editorFontSize) || 15)));
    return { mode, accent: accent.toLowerCase(), fontSize };
  }

  function scheduleDesktopThemeStateBroadcast() {
    if (applyingRemoteThemeState || themeStateFrame || !window.desktop?.updateThemeState) return;
    themeStateFrame = requestAnimationFrame(() => {
      themeStateFrame = 0;
      if (!applyingRemoteThemeState) window.desktop.updateThemeState(currentDesktopThemeState());
    });
  }

  window.notifyDesktopThemeStateChanged = scheduleDesktopThemeStateBroadcast;

  function scheduleDesktopNoteStateBroadcast() {
    if (applyingRemoteNoteState || noteStateFrame || !window.desktop?.updateNoteState) return;
    noteStateFrame = requestAnimationFrame(() => {
      noteStateFrame = 0;
      if (applyingRemoteNoteState) return;
      const snapshot = activeNoteSnapshot();
      if (snapshot) window.desktop.updateNoteState(snapshot);
    });
  }

  function applyRemoteThemeState(state) {
    if (!state || typeof state !== 'object') return;
    const nextMode = ['light', 'dark', 'system'].includes(state.mode) ? state.mode : '';
    const nextAccent = typeof normalizeAccentColor === 'function' ? normalizeAccentColor(state.accent) : '';
    const nextFontSize = Math.max(12, Math.min(24, Math.trunc(Number(state.fontSize) || editorFontSize || 15)));
    if (!nextMode || !nextAccent) return;

    applyingRemoteThemeState = true;
    try {
      let themeChanged = false;
      let fontChanged = false;
      if (themeMode !== nextMode) {
        themeMode = nextMode;
        localStorage.setItem('notas_theme', themeMode);
        themeChanged = true;
      }
      if (normalizeAccentColor(accentColor) !== nextAccent) {
        accentColor = nextAccent;
        localStorage.setItem('notas_accent', accentColor);
        themeChanged = true;
      }
      if (editorFontSize !== nextFontSize) {
        editorFontSize = nextFontSize;
        localStorage.setItem('notas_font_size', String(editorFontSize));
        fontChanged = true;
      }
      if (themeChanged && typeof applyTheme === 'function') applyTheme();
      else if (themeChanged && typeof applyAccentColor === 'function') applyAccentColor(accentColor);
      if (fontChanged && typeof applyFontSize === 'function') applyFontSize();
      if (typeof updateColorPickerUI === 'function') updateColorPickerUI(accentColor);
      if (typeof updateThemeToggleUI === 'function') updateThemeToggleUI();
    } finally {
      applyingRemoteThemeState = false;
    }
  }

  function unreadNotificationCountForDock() {
    if (typeof getNotificationItems !== 'function') return 0;
    return getNotificationItems().filter(item => !item.read).length;
  }

  function dueReminderCountForDock() {
    if (typeof getAlarmItems !== 'function') return 0;
    return getAlarmItems().filter(item =>
      item.due &&
      item.direction !== 'sent' &&
      (item.kind !== 'received' || item.read)
    ).length;
  }

  function syncDockNotificationBadge() {
    if (!window.desktop?.setDockNotificationCount) return;
    const count = unreadNotificationCountForDock() + dueReminderCountForDock();
    if (count === lastDockNotificationCount) return;
    lastDockNotificationCount = count;
    window.desktop.setDockNotificationCount(count).catch(err => console.error('dock notification badge:', err));
  }

  function scheduleDockNotificationBadgeSync() {
    if (dockNotificationFrame) return;
    dockNotificationFrame = requestAnimationFrame(() => {
      dockNotificationFrame = 0;
      syncDockNotificationBadge();
    });
  }

  window.refreshDesktopNotificationBadge = scheduleDockNotificationBadgeSync;

  function canPopOutActiveNote() {
    const note = activeNote();
    return !!(note && !(typeof isTrashedNote === 'function' && isTrashedNote(note)));
  }

  function createDesktopButton(id, label, iconClass) {
    const btn = document.createElement('button');
    btn.className = 'new-note-btn desktop-window-btn';
    btn.id = id;
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = '<i class="' + iconClass + '"></i>';
    return btn;
  }

  function ensureDesktopControls() {
    const actions = document.getElementById('header-actions');
    const shareBtn = document.getElementById('share-btn');
    if (!actions || !shareBtn) return;

    if (!popoutButton) {
      popoutButton = createDesktopButton('desktop-popout-note-btn', 'Toggle Pop Out Note', 'fa-solid fa-up-right-from-square');
      popoutButton.addEventListener('click', openActiveNoteWindow);
      actions.appendChild(popoutButton);
    }

    if (!alwaysOnTopButton) {
      alwaysOnTopButton = createDesktopButton('desktop-always-on-top-btn', 'Always On Top', 'fa-solid fa-thumbtack');
      alwaysOnTopButton.setAttribute('aria-pressed', 'false');
      alwaysOnTopButton.addEventListener('click', toggleAlwaysOnTop);
      actions.appendChild(alwaysOnTopButton);
    }
  }

  function refreshWindowTitle() {
    if (desktopContext.type !== 'note') return;
    const note = activeNote();
    window.desktop.setWindowTitle(note?.title || document.getElementById('doc-title')?.value || 'Untitled Note');
  }

  function refreshDesktopControls() {
    ensureDesktopControls();
    const hasNote = canPopOutActiveNote();

    if (popoutButton) {
      popoutButton.hidden = desktopContext.type === 'note' || !hasNote;
      popoutButton.disabled = !hasNote;
    }

    if (alwaysOnTopButton) {
      alwaysOnTopButton.hidden = desktopContext.type !== 'note';
      alwaysOnTopButton.classList.toggle('active', !!desktopContext.isAlwaysOnTop);
      alwaysOnTopButton.setAttribute('aria-pressed', desktopContext.isAlwaysOnTop ? 'true' : 'false');
      alwaysOnTopButton.title = desktopContext.isAlwaysOnTop ? 'Turn Off Always On Top' : 'Always On Top';
      alwaysOnTopButton.setAttribute('aria-label', alwaysOnTopButton.title);
    }

    refreshWindowTitle();
  }

  async function openActiveNoteWindow() {
    if (!canPopOutActiveNote()) {
      if (typeof showToast === 'function') showToast('Select A Note First', 'error');
      return;
    }

    if (typeof syncActiveNoteFromEditor === 'function') syncActiveNoteFromEditor();
    const result = await window.desktop.openNoteWindow(activeId, activeNoteSnapshot());
    if (!result?.ok && typeof showToast === 'function') {
      showToast('Could Not Open Note Window', 'error');
    }
  }

  async function toggleAlwaysOnTop() {
    if (desktopContext.type !== 'note') return;
    const result = await window.desktop.setAlwaysOnTop(!desktopContext.isAlwaysOnTop);
    if (result?.ok) {
      desktopContext.isAlwaysOnTop = !!result.enabled;
      refreshDesktopControls();
    }
  }

  function normalizeInitialNoteSnapshot(snapshot) {
    if (desktopContext.type !== 'note' || !desktopContext.noteId) return null;
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (String(snapshot.id || desktopContext.noteId) !== desktopContext.noteId) return null;
    const now = new Date().toISOString();
    const note = {
      ...snapshot,
      id: desktopContext.noteId,
      title: String(snapshot.title || '').trim() || 'Untitled Note',
      content: typeof snapshot.content === 'string' ? snapshot.content : '',
      folderId: snapshot.folderId || null,
      sharedWith: shallowObject(snapshot.sharedWith),
      sharedAccessKeys: shallowArray(snapshot.sharedAccessKeys),
      publicFolderIds: shallowArray(snapshot.publicFolderIds),
      mentionedUids: shallowArray(snapshot.mentionedUids),
      created: snapshot.created || now,
      modified: snapshot.modified || now
    };
    return typeof hydrateNoteShareState === 'function' ? hydrateNoteShareState(note, note) : note;
  }

  function seedInitialNoteSnapshot() {
    const note = normalizeInitialNoteSnapshot(desktopContext.initialNote);
    if (!note) return false;
    notes[note.id] = notes[note.id] ? { ...notes[note.id], ...note } : note;
    return true;
  }

  function requestedNoteIsVisible() {
    const editorView = document.getElementById('editorView');
    return !!(activeId === desktopContext.noteId && notes[desktopContext.noteId] && editorView?.style.display !== 'none');
  }

  function openRequestedDesktopNote(attempt = 0) {
    if (desktopContext.type !== 'note' || !desktopContext.noteId) return;
    if (requestedNoteOpened && requestedNoteIsVisible()) return;

    seedInitialNoteSnapshot();

    if (notes[desktopContext.noteId]) {
      requestedNoteOpened = true;
      openNote(desktopContext.noteId);
      refreshDesktopControls();
      return;
    }

    const userIsLoaded = !!userId;
    if (userIsLoaded && attempt > 1200) {
      if (typeof showToast === 'function') showToast('Could Not Find Note', 'error');
      return;
    }
    setTimeout(() => openRequestedDesktopNote(userIsLoaded ? attempt + 1 : 0), userIsLoaded ? 50 : 250);
  }

  function applyRemoteNoteState(state) {
    if (!state || typeof state !== 'object') return;
    const noteId = String(state.id || state.noteId || '').trim();
    if (!noteId) return;
    if (desktopContext.type === 'note' && desktopContext.noteId && noteId !== desktopContext.noteId) return;

    const now = new Date().toISOString();
    const existing = notes[noteId] || {};
    const incomingContent = typeof state.content === 'string' ? state.content : '';
    const shouldKeepBody = activeId === noteId || (desktopContext.type === 'note' && desktopContext.noteId === noteId);
    const bodyMetadata = buildNoteContentMetadata(incomingContent);
    const incoming = {
      ...existing,
      ...state,
      id: noteId,
      title: String(state.title || '').trim() || 'Untitled Note',
      content: shouldKeepBody ? incomingContent : '',
      _bodyLoaded: shouldKeepBody,
      previewText: bodyMetadata.previewText,
      searchText: bodyMetadata.searchText,
      inlineAlarms: bodyMetadata.inlineAlarms,
      folderId: state.folderId || existing.folderId || null,
      sharedWith: shallowObject(state.sharedWith || existing.sharedWith),
      sharedAccessKeys: shallowArray(state.sharedAccessKeys || existing.sharedAccessKeys),
      publicFolderIds: shallowArray(state.publicFolderIds || existing.publicFolderIds),
      mentionedUids: shallowArray(state.mentionedUids || existing.mentionedUids),
      created: state.created || existing.created || now,
      modified: state.modified || existing.modified || now
    };
    notes[noteId] = typeof hydrateNoteShareState === 'function' ? hydrateNoteShareState(incoming, incoming) : incoming;
    if (!shouldKeepBody && existing._bodyLoaded) {
      notes[noteId].content = '';
      notes[noteId]._bodyLoaded = false;
    }

    const titleEl = document.getElementById('doc-title');
    const ed = document.getElementById('editor');
    const noteIsOpen = activeId === noteId;
    const localEditing = document.hasFocus() && (document.activeElement === ed || document.activeElement === titleEl);

    applyingRemoteNoteState = true;
    try {
      if (noteIsOpen && titleEl && ed && !localEditing) {
        const note = notes[noteId];
        const isOwned = !note.owner || note.owner === userId;
        const isEditable = typeof canEditNote === 'function' ? canEditNote(note) : true;
        const canUseConversations = typeof canStartConversationOnNote === 'function' ? canStartConversationOnNote(note) : isEditable;
        titleEl.value = note.title;
        titleEl.readOnly = !isEditable;
        document.getElementById('toolbar').style.display = isEditable ? '' : 'none';
        document.getElementById('share-btn').style.display = isOwned && !(typeof isTrashedNote === 'function' && isTrashedNote(note)) ? '' : 'none';
        ed.contentEditable = isEditable ? 'true' : 'false';
        ed.innerHTML = renderMarkdownContent(note.content || '');
        normalizeThemeTextStyles(ed);
        normalizeCodeThemeStyles(ed);
        linkifyTextNodes(ed);
        ensureLinkAttrs(ed);
        restoreChecklistState(ed);
        restoreAlarmMarks(ed);
        if (typeof restoreConversationAnchorMarks === 'function') restoreConversationAnchorMarks(ed);
        decorateTables(ed);
        decorateNoteImages(ed);
        if (typeof recomputeCollapsedSections === 'function') recomputeCollapsedSections();
        refreshEmpty(ed);
        updateCounts();
        updateActiveNoteAccessAvatars();
        setSaveState(isEditable ? 'unsaved' : 'readonly');
        if (typeof listenToConversationsForNote === 'function') {
          listenToConversationsForNote(canUseConversations ? noteId : null);
        }
      }
      renderSidebar();
      renderAlarmButton();
      refreshWindowTitle();
    } finally {
      applyingRemoteNoteState = false;
    }
  }

  function applyDesktopContext(context) {
    if (!context || typeof context !== 'object') return;
    const previousNoteId = desktopContext.noteId || '';
    const nextType = context.type === 'note' ? 'note' : 'main';
    const nextNoteId = context.noteId || '';

    if (desktopContext.type === 'note' && previousNoteId && previousNoteId !== nextNoteId && typeof syncActiveNoteFromEditor === 'function') {
      syncActiveNoteFromEditor();
    }

    desktopContext = {
      ...desktopContext,
      ...context,
      type: nextType,
      noteId: nextNoteId,
      initialNote: context.initialNote || null,
      isAlwaysOnTop: !!context.isAlwaysOnTop
    };
    if (context.themeState) applyRemoteThemeState(context.themeState);
    if (previousNoteId !== nextNoteId) requestedNoteOpened = false;
    document.body.classList.toggle('desktop-note-window', desktopContext.type === 'note');
    refreshDesktopControls();
    openRequestedDesktopNote();
  }

  function wrapOpenNote() {
    if (typeof openNote !== 'function' || openNote.desktopWrapped) return;
    const originalOpenNote = openNote;
    openNote = function desktopOpenNoteWrapper() {
      const result = originalOpenNote.apply(this, arguments);
      refreshDesktopControls();
      scheduleDesktopNoteStateBroadcast();
      return result;
    };
    openNote.desktopWrapped = true;
  }

  function wrapSyncActiveNoteFromEditor() {
    if (typeof syncActiveNoteFromEditor !== 'function' || syncActiveNoteFromEditor.desktopWrapped) return;
    const originalSyncActiveNoteFromEditor = syncActiveNoteFromEditor;
    syncActiveNoteFromEditor = function desktopSyncActiveNoteFromEditorWrapper() {
      const result = originalSyncActiveNoteFromEditor.apply(this, arguments);
      if (result) scheduleDesktopNoteStateBroadcast();
      return result;
    };
    syncActiveNoteFromEditor.desktopWrapped = true;
  }

  function bindDesktopEvents() {
    window.openActiveDesktopNoteWindow = openActiveNoteWindow;
    window.desktop.onOpenActiveNote(openActiveNoteWindow);
    window.desktop.onNewNote(() => {
      if (typeof openModal === 'function') openModal('note');
    });
    window.desktop.onWindowContextUpdated?.(applyDesktopContext);
    window.desktop.onNoteStateChanged?.(applyRemoteNoteState);
    window.desktop.onThemeStateChanged?.(applyRemoteThemeState);
    window.desktop.onAlwaysOnTopChanged(enabled => {
      desktopContext.isAlwaysOnTop = !!enabled;
      refreshDesktopControls();
    });

    document.getElementById('doc-title')?.addEventListener('input', () => {
      refreshWindowTitle();
      scheduleDesktopNoteStateBroadcast();
    });
    document.getElementById('doc-title')?.addEventListener('blur', () => {
      refreshWindowTitle();
      scheduleDesktopNoteStateBroadcast();
    });
    window.addEventListener('focus', refreshDesktopControls);
    window.addEventListener('notas:home-prepared', () => {
      if (desktopContext.type === 'main') window.desktop.prewarmNoteWindow?.();
      openRequestedDesktopNote();
    });
    window.addEventListener('notas:notes-updated', () => openRequestedDesktopNote());
    window.addEventListener('notas:notifications-updated', scheduleDockNotificationBadgeSync);
  }

  window.desktop.getWindowContext()
    .then(applyDesktopContext)
    .catch(err => console.error('desktop context:', err));

  wrapOpenNote();
  wrapSyncActiveNoteFromEditor();
  bindDesktopEvents();
  refreshDesktopControls();
  if (desktopContext.type === 'main') scheduleDesktopThemeStateBroadcast();
  scheduleDockNotificationBadgeSync();
  openRequestedDesktopNote();
})();
