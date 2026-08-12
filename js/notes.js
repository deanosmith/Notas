/* Note CRUD and current-note loading. */
function noteCanAppearInSplit(note) {
  return !!note && !isTrashedNote(note);
}

function reconcileNoteSplit() {
  const splitPeerId = typeof getNoteSplitPeerId === 'function' ? getNoteSplitPeerId() : '';
  if (splitPeerId && !noteCanAppearInSplit(notes[splitPeerId]) && typeof clearNoteSplitView === 'function') {
    clearNoteSplitView();
  }
  if (typeof tryRestorePersistedNoteSplit === 'function') tryRestorePersistedNoteSplit();
}

window.addEventListener('notas:notes-updated', reconcileNoteSplit);

function flushActiveNoteBeforeSwitch(nextNoteId = '') {
  const outgoingId = activeId;
  const outgoing = outgoingId ? notes[outgoingId] : null;
  if (!outgoing || outgoingId === nextNoteId || !canEditNote(outgoing)) return;
  const hadPendingSave = !!saveTimer;
  clearTimeout(saveTimer);
  saveTimer = null;
  const ed = getEd();
  const contentChanged = outgoing._bodyLoaded && !ed?.classList.contains('is-loading')
    ? syncActiveNoteFromEditor()
    : false;
  // Persist when body content changed, or when a pending save (e.g. title edit) was waiting.
  if (contentChanged || hadPendingSave) void saveDoc(outgoing);
}

function readLastOpenNoteId() {
  try {
    return String(localStorage.getItem(LAST_OPEN_NOTE_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function rememberLastOpenNote(id) {
  if (!id) return;
  try {
    localStorage.setItem(LAST_OPEN_NOTE_STORAGE_KEY, id);
  } catch {}
}

function beginInitialNoteRestore() {
  initialNoteRestoreId = readLastOpenNoteId();
  initialNoteRestorePending = !!initialNoteRestoreId;
}

function shouldDeferInitialNoteFallback() {
  const params = new URLSearchParams(location.search);
  const isDesktopNoteWindow = !!window.desktop?.isElectron && params.get('desktopWindow') === 'note';
  return isDesktopNoteWindow || !!(initialNoteRestorePending && initialNoteRestoreId && !notes[initialNoteRestoreId]);
}

function openFirstAvailableNote() {
  const ids = sortedIds();
  if (ids.length) openNote(ids[0]);
  else showEditorView(false);
}

function openRememberedNoteWhenAvailable() {
  const targetId = initialNoteRestoreId;
  const note = targetId ? notes[targetId] : null;
  if (!note || isTrashedNote(note)) return false;
  initialNoteRestorePending = false;
  initialNoteRestoreId = '';
  if (activeId !== targetId) openNote(targetId);
  return true;
}

function openInitialNoteOrFirst() {
  if (openRememberedNoteWhenAvailable()) {
    if (typeof tryRestorePersistedNoteSplit === 'function') tryRestorePersistedNoteSplit();
    return;
  }
  initialNoteRestorePending = false;
  initialNoteRestoreId = '';

  if (!activeId || !notes[activeId] || (isTrashedNote(notes[activeId]) && sidebarView !== 'trash')) {
    openFirstAvailableNote();
  }
  if (typeof tryRestorePersistedNoteSplit === 'function') tryRestorePersistedNoteSplit();
}

async function createNote(title, folderId) {
  if (folderId && !isOwnedFolder(folders[folderId])) folderId = null;
  const id  = 'note_' + Date.now();
  const now = new Date().toISOString();
  const folder = folderId ? folders[folderId] : null;
  const publicFolderIds = folder?.public ? [folderId] : [];
  const note = {
    id,
    title: title.trim() || 'Untitled Note',
    content: '',
    public: !!publicFolderIds.length,
    linkPublic: false,
    publicFolderIds,
    sharedWith: {},
    sharedAccessKeys: [],
    mentionedUids: [],
    folderId: folderId || null,
    pinnedAt: '',
    pinScope: '',
    created: now,
    modified: now
  };
  notes[id] = note;
  applyNoteBodyContent(id, '');
  if (folderId) expandedFolders.add(folderId);
  openNote(id);
  try {
    await saveDoc(note);
    if (folderId) {
      await inheritFolderSharingForNote(note, folderId);
      renderSidebar();
    }
  } catch (err) {
    console.error('inherit folder sharing for new note:', err);
    showToast('Note created, but folder sharing could not be applied', 'error');
  }
}


function deleteNote(id) {
  if (!notes[id]) return;
  openDeleteModal('note', id);
}

async function _execDeleteNote(id) {
  const note = notes[id];
  if (!note) return;
  if (!isOwnedNote(note)) { await removeFromLibrary(id); return; }
  await moveNoteToTrash(id);
}

async function moveNoteToTrash(id) {
  const note = notes[id];
  if (!note || !isOwnedNote(note)) return;
  if ((activeId === id || (typeof getNoteSplitPeerId === 'function' && getNoteSplitPeerId() === id)) && typeof clearNoteSplitView === 'function') {
    clearNoteSplitView();
  }
  if (activeId === id && canEditNote(note)) flushActiveNoteBeforeSwitch('__trash__');
  const deletedAt = new Date();
  const trashExpiresAt = new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  note.deletedAt = deletedAt.toISOString();
  note.trashExpiresAt = trashExpiresAt.toISOString();
  note.pinnedAt = '';
  note.pinScope = '';
  if (activeId === id) {
    clearActiveNoteBodyListener();
    const ids = sortedIds();
    activeId = ids.length ? ids[0] : null;
  }
  reconcileNoteSplit();
  renderSidebar();
  activeId ? openNote(activeId) : showEditorView(false);
  try {
    await trashDocNote(note, deletedAt, trashExpiresAt);
    showToast('Moved To Trash', 'success');
  } catch (err) {
    console.error('move note to trash:', err);
    showToast('Could Not Move Note To Trash', 'error');
  }
}

async function restoreTrashedNote(id) {
  const note = notes[id];
  if (!note || !isOwnedNote(note) || !isTrashedNote(note)) return;
  note.deletedAt = '';
  note.trashExpiresAt = '';
  try {
    await restoreDocNote(id);
    setSidebarView('notes');
    openNote(id);
    showToast('Note Restored', 'success');
  } catch (err) {
    console.error('restore note:', err);
    showToast('Could Not Restore Note', 'error');
    renderSidebar();
  }
}

function permanentlyDeleteTrashedNote(id) {
  const note = notes[id];
  if (!note || !isOwnedNote(note)) return;
  if ((activeId === id || (typeof getNoteSplitPeerId === 'function' && getNoteSplitPeerId() === id)) && typeof clearNoteSplitView === 'function') {
    clearNoteSplitView();
  }
  delete notes[id];
  if (activeId === id) {
    clearActiveNoteBodyListener();
    const ids = sortedIds();
    activeId = ids.length ? ids[0] : null;
    activeId ? openNote(activeId) : showEditorView(false);
  }
  reconcileNoteSplit();
  renderSidebar();
  deleteDocNote(id);
  showToast('Note Permanently Deleted', 'success');
}

function purgeExpiredTrashNotes() {
  const expired = Object.values(notes).filter(note => isOwnedNote(note) && isTrashExpired(note));
  if (!expired.length) return;
  expired.forEach(note => {
    delete notes[note.id];
    deleteDocNote(note.id);
    if (activeId === note.id) { clearActiveNoteBodyListener(); activeId = null; }
  });
  if (!activeId) {
    const ids = sortedIds();
    activeId = ids.length ? ids[0] : null;
    activeId ? openNote(activeId) : showEditorView(false);
  }
  reconcileNoteSplit();
  renderSidebar();
}

function applyNoteEditorChrome(note) {
  const isOwned = !note.owner || note.owner === userId;
  const isEditable = canEditNote(note);
  const titleEl = document.getElementById('doc-title');
  titleEl.value    = note.title;
  titleEl.readOnly = !isEditable;
  document.getElementById('toolbar').style.display   = isEditable ? '' : 'none';
  document.getElementById('share-btn').style.display = isOwned && !isTrashedNote(note) ? '' : 'none';
  const conversationToggleBtn = document.getElementById('conversation-toggle-btn');
  if (conversationToggleBtn) conversationToggleBtn.style.display = userId ? '' : 'none';
  const ed = document.getElementById('editor');
  ed.contentEditable = isEditable ? 'true' : 'false';
  return { ed, titleEl, isOwned, isEditable };
}

function renderNoteBodyIntoEditor(note, content) {
  const ed = document.getElementById('editor');
  setEditorBodyLoading(ed, false, canEditNote(note));
  ed.innerHTML = renderMarkdownContent(content || '');
  normalizeThemeTextStyles(ed);
  normalizeCodeThemeStyles(ed);
  const linkified = linkifyTextNodes(ed);
  ensureLinkAttrs(ed);
  restoreChecklistState(ed);
  restoreAlarmMarks(ed);
  if (typeof restoreConversationAnchorMarks === 'function') restoreConversationAnchorMarks(ed);
  decorateTables(ed);
  decorateNoteImages(ed);
  restoreCollapsedState(note.id);
  const cleanContent = getCleanHTML();
  applyNoteBodyContent(note.id, cleanContent);
  refreshEmpty(ed);
  updateCounts();
  return linkified || cleanContent !== (content || '');
}

function setEditorBodyLoading(ed, loading, isEditable) {
  if (!ed) return;
  ed.classList.toggle('is-loading', !!loading);
  if (loading) {
    ed.setAttribute('aria-busy', 'true');
    ed.contentEditable = 'false';
    ed.innerHTML = '';
    refreshEmpty(ed);
    return;
  }
  ed.removeAttribute('aria-busy');
  ed.contentEditable = isEditable ? 'true' : 'false';
}

function applyRemoteNoteBodyContent(noteId, content) {
  const note = notes[noteId];
  if (!note) return;
  const ed = getEd();
  const titleEl = document.getElementById('doc-title');
  if (activeId === noteId && (document.activeElement === ed || document.activeElement === titleEl)) return;
  applyNoteBodyContent(noteId, content);
  if (activeId !== noteId) return;
  applyNoteEditorChrome(note);
  renderNoteBodyIntoEditor(note, content);
  updateActiveNoteAccessAvatars();
  setSaveState(canEditNote(note) ? 'saved' : 'readonly');
}

async function openNote(id, options = {}) {
  const note = notes[id];
  if (!note) return;
  if (options?.source === 'sidebar' && typeof routeSidebarNoteOpenInSplit === 'function' && routeSidebarNoteOpenInSplit(id)) return;
  if (activeId && activeId !== id) flushActiveNoteBeforeSwitch(id);
  if (activeId !== id && typeof beforeOpenNoteSplit === 'function') beforeOpenNoteSplit(id);
  const preserveSidebarState = options?.preserveSidebarState === true;
  activeId = id;
  activeFolderId = note.folderId || null;
  if (activeNoteBodyListeningId && activeNoteBodyListeningId !== id) clearActiveNoteBodyListener();
  releaseInactiveNoteBodies(id);
  const { ed, isEditable } = applyNoteEditorChrome(note);
  const canUseConversations = typeof canStartConversationOnNote === 'function' ? canStartConversationOnNote(note) : isEditable;
  if (!note._bodyLoaded) {
    setEditorBodyLoading(ed, true, isEditable);
    showEditorView(true);
    renderSidebar();
    updateActiveNoteAccessAvatars();
    setSaveState('loading');
  }
  let body = note._bodyLoaded ? note.content || '' : '';
  let bodyLoadFailed = false;
  try {
    body = await loadNoteBody(id, { activeOnly: true });
  } catch (err) {
    console.error('load note body:', err);
    note._bodyError = true;
    bodyLoadFailed = true;
    showToast('Could Not Load Note Body', 'error');
  }
  if (activeId !== id) return;
  if (bodyLoadFailed && !note._bodyLoaded) {
    setEditorBodyLoading(ed, false, isEditable);
    refreshEmpty(ed);
    showEditorView(true);
    renderSidebar();
    updateActiveNoteAccessAvatars();
    setSaveState('error');
    if (typeof afterOpenNoteSplit === 'function') afterOpenNoteSplit(id);
    return;
  }
  renderNoteBodyIntoEditor(note, body);
  if (typeof afterOpenNoteSplit === 'function') afterOpenNoteSplit(id);
  refreshEmpty(ed);
  showEditorView(true);
  renderSidebar();
  updateActiveNoteAccessAvatars();
  updateCounts();
  setSaveState(isEditable ? 'saved' : 'readonly');
  initUndoSnapshot();
  if (typeof listenToConversationsForNote === 'function') {
    listenToConversationsForNote(canUseConversations ? id : null);
  }
  listenToActiveNoteBody(id);
  _capitalizeNext = false;
  if (isEditable && !isMobile()) setTimeout(() => placeCursorAtEnd(ed), 40);
  if (!preserveSidebarState && isMobile()) closeDrawer();
  rememberLastOpenNote(id);
  if (typeof recordAppNavigationState === 'function') recordAppNavigationState();
}
