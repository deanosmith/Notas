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
  let requestedNoteOpened = false;
  let lastDockNotificationCount = -1;
  let dockNotificationFrame = 0;
  let noteStateFrame = 0;
  let themeStateFrame = 0;
  let menuBarCatalogFrame = 0;
  let menuBarSettings = { mode: 'new', noteId: '', noteTitle: '' };
  let menuBarPreloadedNoteKey = '';
  let menuBarNotePreloadInFlightKey = '';
  let pendingMenuBarAction = null;
  let processingMenuBarAction = false;
  let menuBarNotesReady = false;
  let hasVisibleNoteWindow = desktopContext.type === 'note';
  let applyingRemoteNoteState = false;
  let applyingRemoteThemeState = false;
  let foregroundRefreshFrame = 0;

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

  function desktopNoteSnapshot(note, includeContent = true) {
    if (!note) return null;
    const canEdit = typeof canEditNote === 'function' ? canEditNote(note) : true;
    const directAccess = typeof directAccessForNote === 'function' ? directAccessForNote(note.id) : null;
    return {
      id: note.id,
      title: note.title || 'Untitled Note',
      content: includeContent && typeof note.content === 'string' ? note.content : '',
      bodyLoaded: includeContent && !!note._bodyLoaded,
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

  function activeNoteSnapshot() {
    return desktopNoteSnapshot(activeNote());
  }

  function currentDesktopThemeState() {
    const mode = ['light', 'dark', 'system'].includes(themeMode) ? themeMode : 'dark';
    const accent = typeof normalizeAccentColor === 'function' ? normalizeAccentColor(accentColor) : '#08c1ff';
    const fontSize = Math.max(12, Math.min(24, Math.trunc(Number(editorFontSize) || 15)));
    const lineHeight = typeof normalizeEditorLineHeight === 'function'
      ? normalizeEditorLineHeight(editorLineHeight)
      : Math.max(1.2, Math.min(2.2, Number(editorLineHeight) || 1.66));
    return {
      mode,
      accent: accent.toLowerCase(),
      accentMode: typeof accentMode === 'string' ? accentMode : 'custom',
      fontSize,
      lineHeight,
      textStylingVisible: textStylingVisible !== false
    };
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
    if (desktopContext.type === 'main' && !hasVisibleNoteWindow) return;
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
    const nextAccentMode = ['notas', 'custom'].includes(state.accentMode) ? state.accentMode : '';
    const nextFontSize = Math.max(12, Math.min(24, Math.trunc(Number(state.fontSize) || editorFontSize || 15)));
    const nextLineHeight = typeof normalizeEditorLineHeight === 'function'
      ? normalizeEditorLineHeight(state.lineHeight || editorLineHeight || 1.66)
      : Math.max(1.2, Math.min(2.2, Number(state.lineHeight) || editorLineHeight || 1.66));
    const nextTextStylingVisible = state.textStylingVisible !== false;
    if (!nextMode || !nextAccent) return;

    applyingRemoteThemeState = true;
    try {
      let themeChanged = false;
      let fontChanged = false;
      let lineHeightChanged = false;
      let textStylingChanged = false;
      if (themeMode !== nextMode) {
        themeMode = nextMode;
        localStorage.setItem('notas_theme', themeMode);
        themeChanged = true;
      }
      if (nextAccentMode && accentMode !== nextAccentMode) {
        accentMode = nextAccentMode;
        themeChanged = true;
      }
      if (nextAccentMode === 'custom' && customAccentColor !== nextAccent) {
        customAccentColor = nextAccent;
        localStorage.setItem('notas_custom_accent', customAccentColor);
        themeChanged = true;
      }
      if (normalizeAccentColor(accentColor) !== nextAccent || nextAccentMode === 'notas') {
        accentColor = nextAccent;
        if (nextAccentMode !== 'notas') localStorage.setItem('notas_accent', accentColor);
        themeChanged = true;
      }
      if (nextAccentMode) localStorage.setItem('notas_accent_mode', nextAccentMode);
      if (editorFontSize !== nextFontSize) {
        editorFontSize = nextFontSize;
        localStorage.setItem('notas_font_size', String(editorFontSize));
        fontChanged = true;
      }
      if (editorLineHeight !== nextLineHeight) {
        editorLineHeight = nextLineHeight;
        localStorage.setItem('notas_line_height', typeof formatEditorLineHeight === 'function' ? formatEditorLineHeight(editorLineHeight) : String(editorLineHeight));
        lineHeightChanged = true;
      }
      if (textStylingVisible !== nextTextStylingVisible) {
        textStylingVisible = nextTextStylingVisible;
        localStorage.setItem('notas_text_styling_visible', textStylingVisible ? 'true' : 'false');
        textStylingChanged = true;
      }
      if (themeChanged && typeof applyTheme === 'function') applyTheme();
      else if (themeChanged && typeof applyAccentColor === 'function') applyAccentColor(accentColor);
      if (fontChanged && typeof applyFontSize === 'function') applyFontSize();
      if (lineHeightChanged && typeof applyLineHeight === 'function') applyLineHeight();
      if (textStylingChanged && typeof applyTextStylingVisibility === 'function') applyTextStylingVisibility();
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

  function availableMenuBarNotes() {
    return Object.values(notes || {})
      .filter(note => note?.id && !(typeof isTrashedNote === 'function' && isTrashedNote(note)))
      .sort((a, b) =>
        String(a.title || 'Untitled Note').localeCompare(String(b.title || 'Untitled Note'), undefined, { sensitivity: 'base' }) ||
        String(a.id).localeCompare(String(b.id))
      );
  }

  function applyMenuBarSettings(settings) {
    const noteId = String(settings?.noteId || '').trim();
    menuBarSettings = {
      mode: settings?.mode === 'note' && noteId ? 'note' : 'new',
      noteId,
      noteTitle: String(settings?.noteTitle || '').trim() || 'Untitled Note'
    };
    refreshMenuBarSettingsControls();
    preloadMenuBarSelectedNote();
  }

  function refreshMenuBarSettingsControls() {
    if (desktopContext.type !== 'main') return;
    const actionSelect = document.getElementById('menubar-action-select');
    const noteSelect = document.getElementById('menubar-note-select');
    if (!actionSelect || !noteSelect) return;

    actionSelect.value = menuBarSettings.mode;
    noteSelect.textContent = '';
    const availableNotes = availableMenuBarNotes();
    availableNotes.forEach(note => {
      const option = document.createElement('option');
      option.value = note.id;
      option.textContent = note.title || 'Untitled Note';
      noteSelect.appendChild(option);
    });
    if (menuBarSettings.noteId && !availableNotes.some(note => note.id === menuBarSettings.noteId)) {
      const option = document.createElement('option');
      option.value = menuBarSettings.noteId;
      option.textContent = menuBarSettings.noteTitle;
      noteSelect.prepend(option);
    }
    if (!noteSelect.options.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No Notes Available';
      noteSelect.appendChild(option);
    }
    noteSelect.value = menuBarSettings.noteId || noteSelect.options[0].value;
    noteSelect.hidden = menuBarSettings.mode !== 'note';
  }

  function scheduleMenuBarNoteSync() {
    if (desktopContext.type !== 'main' || menuBarCatalogFrame || !window.desktop?.updateMenuBarNotes) return;
    menuBarCatalogFrame = requestAnimationFrame(() => {
      menuBarCatalogFrame = 0;
      window.desktop.updateMenuBarNotes(availableMenuBarNotes().map(note =>
        desktopNoteSnapshot(note, note.id === menuBarSettings.noteId && !!note._bodyLoaded)
      ));
      refreshMenuBarSettingsControls();
      preloadMenuBarSelectedNote();
    });
  }

  function menuBarPreloadKey(note) {
    return String(note?.id || '') + ':' + String(note?.modified || '');
  }

  function preloadMenuBarSelectedNote() {
    if (desktopContext.type !== 'main' || menuBarSettings.mode !== 'note' || !menuBarSettings.noteId) {
      menuBarPreloadedNoteKey = '';
      menuBarNotePreloadInFlightKey = '';
      return;
    }

    const note = notes[menuBarSettings.noteId];
    if (!note || (typeof isTrashedNote === 'function' && isTrashedNote(note))) return;
    const preloadKey = menuBarPreloadKey(note);
    if (menuBarPreloadedNoteKey === preloadKey || menuBarNotePreloadInFlightKey === preloadKey) return;

    const sendPreloadedNote = snapshot => {
      if (menuBarSettings.mode !== 'note' || menuBarSettings.noteId !== note.id) return;
      window.desktop.preloadMenuBarNote?.(snapshot);
      menuBarPreloadedNoteKey = menuBarPreloadKey(notes[note.id] || note);
    };

    if (note._bodyLoaded) {
      sendPreloadedNote(desktopNoteSnapshot(note, true));
      return;
    }

    if (typeof readNoteBodyContent !== 'function') return;
    menuBarNotePreloadInFlightKey = preloadKey;
    readNoteBodyContent(note.id)
      .then(content => {
        const currentNote = notes[note.id];
        if (!currentNote || menuBarSettings.mode !== 'note' || menuBarSettings.noteId !== note.id) return;
        sendPreloadedNote(desktopNoteSnapshot({ ...currentNote, content, _bodyLoaded: true }, true));
      })
      .catch(err => console.error('preload menu bar note:', err))
      .finally(() => {
        if (menuBarNotePreloadInFlightKey === preloadKey) menuBarNotePreloadInFlightKey = '';
      });
  }

  async function persistMenuBarSettings(settings) {
    const saved = await window.desktop.setMenuBarSettings?.(settings);
    if (saved) applyMenuBarSettings(saved);
  }

  function initMenuBarSettingsControls() {
    if (desktopContext.type !== 'main') return;
    const actionSelect = document.getElementById('menubar-action-select');
    const noteSelect = document.getElementById('menubar-note-select');
    actionSelect?.addEventListener('change', () => {
      if (actionSelect.value === 'new') {
        persistMenuBarSettings({ mode: 'new' });
        return;
      }
      const selected = availableMenuBarNotes().find(note => note.id === noteSelect?.value) || activeNote() || availableMenuBarNotes()[0];
      persistMenuBarSettings(selected
        ? { mode: 'note', noteId: selected.id, noteTitle: selected.title || 'Untitled Note' }
        : { mode: 'new' });
    });
    noteSelect?.addEventListener('change', () => {
      const selected = availableMenuBarNotes().find(note => note.id === noteSelect.value);
      if (selected) persistMenuBarSettings({ mode: 'note', noteId: selected.id, noteTitle: selected.title || 'Untitled Note' });
    });
    window.desktop.getMenuBarSettings?.()
      .then(applyMenuBarSettings)
      .catch(err => console.error('menu bar settings:', err));
  }

  function queueMenuBarAction(action) {
    if (desktopContext.type !== 'main') return;
    pendingMenuBarAction = action;
    processMenuBarAction();
  }

  async function processMenuBarAction() {
    if (processingMenuBarAction || !pendingMenuBarAction || !menuBarNotesReady || !auth?.currentUser) return;
    const action = pendingMenuBarAction;
    const selectedNote = action.type === 'note' ? notes[action.noteId] : null;
    if (action.type === 'note' && (!selectedNote || (typeof isTrashedNote === 'function' && isTrashedNote(selectedNote)))) {
      pendingMenuBarAction = null;
      if (typeof showToast === 'function') showToast('Selected Menu Bar Note Is Unavailable', 'error');
      return;
    }
    pendingMenuBarAction = null;
    processingMenuBarAction = true;
    try {
      if (action.type === 'new') {
        await createNote('Untitled Note', null);
        await openActiveNoteWindow();
      } else {
        await openNoteWindowForNote(selectedNote);
      }
      scheduleMenuBarNoteSync();
    } catch (err) {
      console.error('menu bar note:', err);
      if (typeof showToast === 'function') showToast('Could Not Open Note Window', 'error');
    } finally {
      processingMenuBarAction = false;
      if (pendingMenuBarAction) processMenuBarAction();
    }
  }

  function requestNoteWindowPrewarm() {
    if (desktopContext.type !== 'main') return;
    window.desktop.prewarmNoteWindow?.();
  }

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

    refreshWindowTitle();
  }

  function refreshForegroundPresentation() {
    if (document.visibilityState === 'hidden' || foregroundRefreshFrame) return;
    foregroundRefreshFrame = requestAnimationFrame(() => {
      foregroundRefreshFrame = 0;
      if (document.visibilityState === 'hidden') return;
      refreshDesktopControls();
      if (desktopContext.type === 'main' && typeof updateSidebarWidthState === 'function') {
        updateSidebarWidthState();
      }
      if (typeof refreshTableResizeHandles === 'function') {
        refreshTableResizeHandles(document.getElementById('editor'));
      }
      if (typeof updateCounts === 'function') updateCounts();
      scheduleDockNotificationBadgeSync();
      scheduleMenuBarNoteSync();
    });
  }

  async function openNoteWindowForNote(note) {
    const snapshot = desktopNoteSnapshot(note);
    if (!snapshot) {
      if (typeof showToast === 'function') showToast('Select A Note First', 'error');
      return;
    }

    const result = await window.desktop.openNoteWindow(snapshot.id, snapshot);
    if (!result?.ok && typeof showToast === 'function') {
      showToast('Could Not Open Note Window', 'error');
    }
  }

  async function openActiveNoteWindow() {
    if (!canPopOutActiveNote()) {
      if (typeof showToast === 'function') showToast('Select A Note First', 'error');
      return;
    }

    if (typeof syncActiveNoteFromEditor === 'function') syncActiveNoteFromEditor();
    await openNoteWindowForNote(activeNote());
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
      _bodyLoaded: snapshot.bodyLoaded === true,
      _bodyError: false,
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

  async function openRequestedDesktopNote(attempt = 0) {
    if (desktopContext.type !== 'note' || !desktopContext.noteId) return;
    if (requestedNoteOpened && requestedNoteIsVisible()) return;

    seedInitialNoteSnapshot();

    if (notes[desktopContext.noteId]) {
      const requestedNoteId = desktopContext.noteId;
      requestedNoteOpened = true;
      try {
        await openNote(requestedNoteId);
      } finally {
        if (desktopContext.type === 'note' && desktopContext.noteId === requestedNoteId && activeId === requestedNoteId) {
          window.desktop.noteWindowReady?.(requestedNoteId);
          refreshDesktopControls();
        }
      }
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
        ed.classList.remove('is-loading');
        ed.removeAttribute('aria-busy');
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
    hasVisibleNoteWindow = desktopContext.type === 'note' || !!context.hasVisibleNoteWindow;
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
      requestNoteWindowPrewarm();
      return result;
    };
    openNote.desktopWrapped = true;
  }

  function wrapSyncActiveNoteFromEditor() {
    if (typeof syncActiveNoteFromEditor !== 'function' || syncActiveNoteFromEditor.desktopWrapped) return;
    const originalSyncActiveNoteFromEditor = syncActiveNoteFromEditor;
    syncActiveNoteFromEditor = function desktopSyncActiveNoteFromEditorWrapper() {
      const result = originalSyncActiveNoteFromEditor.apply(this, arguments);
      if (result) {
        scheduleDesktopNoteStateBroadcast();
        scheduleMenuBarNoteSync();
      }
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
    window.desktop.onMenuBarSettingsChanged?.(applyMenuBarSettings);
    window.desktop.onMenuBarOpenNewNote?.(() => queueMenuBarAction({ type: 'new' }));
    window.desktop.onMenuBarOpenNote?.(payload => {
      const noteId = String(payload?.noteId || '').trim();
      if (noteId) queueMenuBarAction({ type: 'note', noteId });
    });
    window.desktop.onWindowContextUpdated?.(applyDesktopContext);
    window.desktop.onNoteWindowPresenceChanged?.(payload => {
      hasVisibleNoteWindow = desktopContext.type === 'note' || !!payload?.hasVisibleNoteWindow;
    });
    window.desktop.onNoteStateChanged?.(applyRemoteNoteState);
    window.desktop.onThemeStateChanged?.(applyRemoteThemeState);
    window.desktop.onWindowForegrounded?.(refreshForegroundPresentation);

    document.getElementById('doc-title')?.addEventListener('input', () => {
      refreshWindowTitle();
      scheduleDesktopNoteStateBroadcast();
    });
    document.getElementById('doc-title')?.addEventListener('blur', () => {
      refreshWindowTitle();
      scheduleDesktopNoteStateBroadcast();
    });
    window.addEventListener('focus', () => {
      refreshForegroundPresentation();
      requestNoteWindowPrewarm();
      scheduleMenuBarNoteSync();
    });
    window.addEventListener('pageshow', refreshForegroundPresentation);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshForegroundPresentation();
    });
    window.addEventListener('notas:home-prepared', () => {
      menuBarNotesReady = false;
      requestNoteWindowPrewarm();
      openRequestedDesktopNote();
    });
    window.addEventListener('notas:notes-updated', () => {
      menuBarNotesReady = true;
      openRequestedDesktopNote();
      scheduleMenuBarNoteSync();
      processMenuBarAction();
    });
    window.addEventListener('notas:notifications-updated', scheduleDockNotificationBadgeSync);
  }

  window.desktop.getWindowContext()
    .then(applyDesktopContext)
    .catch(err => console.error('desktop context:', err));

  wrapOpenNote();
  wrapSyncActiveNoteFromEditor();
  bindDesktopEvents();
  initMenuBarSettingsControls();
  refreshDesktopControls();
  if (desktopContext.type === 'main') scheduleDesktopThemeStateBroadcast();
  scheduleDockNotificationBadgeSync();
  openRequestedDesktopNote();
  window.desktop.rendererReady?.();
})();
