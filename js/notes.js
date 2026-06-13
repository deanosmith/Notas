/* Note CRUD and current-note loading - extracted from index.original.html. */
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
  delete notes[id];
  if (activeId === id) {
    const ids = sortedIds();
    activeId = ids.length ? ids[0] : null;
  }
  renderSidebar();
  activeId ? openNote(activeId) : showEditorView(false);
  deleteDocNote(id);
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
  document.getElementById('share-btn').style.display = isOwned ? '' : 'none';
  const ed = document.getElementById('editor');
  ed.contentEditable = isEditable ? 'true' : 'false';
  ed.innerHTML = renderMarkdownContent(note.content || '');
  const linkified = linkifyTextNodes(ed);
  ensureLinkAttrs(ed);
  restoreChecklistState(ed);
  restoreAlarmMarks(ed);
  restoreCollapsedState(id);
  if (linkified || ed.innerHTML !== (note.content || '')) note.content = ed.innerHTML;
  refreshEmpty(ed);
  showEditorView(true);
  renderSidebar();
  updateActiveNoteAccessAvatars();
  updateCounts();
  setSaveState(isEditable ? 'saved' : 'readonly');
  initUndoSnapshot();
  _capitalizeNext = false;
  if (isEditable && !isMobile()) setTimeout(() => placeCursorAtEnd(ed), 40);
  if (isMobile()) closeDrawer();
  else if (!sidebarMinimized && window.matchMedia('(orientation: portrait)').matches) setSidebarMinimized(true);
}

