/* Note CRUD and current-note loading. */
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
  activeId  = id;
  if (folderId) expandedFolders.add(folderId);
  renderSidebar();
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
  if (activeId === id && canEditNote(note)) syncActiveNoteFromEditor();
  const deletedAt = new Date();
  const trashExpiresAt = new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  note.deletedAt = deletedAt.toISOString();
  note.trashExpiresAt = trashExpiresAt.toISOString();
  note.pinnedAt = '';
  note.pinScope = '';
  if (activeId === id) {
    const ids = sortedIds();
    activeId = ids.length ? ids[0] : null;
  }
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
  delete notes[id];
  if (activeId === id) {
    const ids = sortedIds();
    activeId = ids.length ? ids[0] : null;
    activeId ? openNote(activeId) : showEditorView(false);
  }
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
    if (activeId === note.id) activeId = null;
  });
  if (!activeId) {
    const ids = sortedIds();
    activeId = ids.length ? ids[0] : null;
    activeId ? openNote(activeId) : showEditorView(false);
  }
  renderSidebar();
}

function openNote(id) {
  const note = notes[id];
  if (!note) return;
  const isOwned = !note.owner || note.owner === userId;
  const isEditable = canEditNote(note);
  activeId = id;
  activeFolderId = note.folderId || null;
  const titleEl = document.getElementById('doc-title');
  titleEl.value    = note.title;
  titleEl.readOnly = !isEditable;
  document.getElementById('toolbar').style.display   = isEditable ? '' : 'none';
  document.getElementById('share-btn').style.display = isOwned && !isTrashedNote(note) ? '' : 'none';
  const conversationToggleBtn = document.getElementById('conversation-toggle-btn');
  const canUseConversations = typeof canStartConversationOnNote === 'function' ? canStartConversationOnNote(note) : isEditable;
  if (conversationToggleBtn) {
    conversationToggleBtn.style.display = userId ? '' : 'none';
  }
  const ed = document.getElementById('editor');
  ed.contentEditable = isEditable ? 'true' : 'false';
  ed.innerHTML = renderMarkdownContent(note.content || '');
  normalizeCodeThemeStyles(ed);
  const linkified = linkifyTextNodes(ed);
  ensureLinkAttrs(ed);
  restoreChecklistState(ed);
  restoreAlarmMarks(ed);
  if (typeof restoreConversationAnchorMarks === 'function') restoreConversationAnchorMarks(ed);
  decorateTables(ed);
  decorateNoteImages(ed);
  restoreCollapsedState(id);
  const cleanContent = getCleanHTML();
  if (linkified || cleanContent !== (note.content || '')) note.content = cleanContent;
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
  _capitalizeNext = false;
  if (isEditable && !isMobile()) setTimeout(() => placeCursorAtEnd(ed), 40);
  if (isMobile()) closeDrawer();
  else if (!sidebarMinimized && window.matchMedia('(orientation: portrait)').matches) setSidebarMinimized(true);
  if (typeof recordAppNavigationState === 'function') recordAppNavigationState();
}
