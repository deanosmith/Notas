/* Firestore listeners, writes, migration, and offline persistence - extracted from index.original.html. */
function listenToNotes() {
  if (unsubscribe) unsubscribe();
  let initialSettled = false;
  let resolveInitial;
  const initialLoad = new Promise(resolve => { resolveInitial = resolve; });
  const settleInitial = () => {
    if (initialSettled) return;
    initialSettled = true;
    resolveInitial();
  };

  // Owned notes
  const q = query(collection(fsDb, 'notes'), where('owner', '==', userId));
  unsubscribe = onSnapshot(q, snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') { delete notes[id]; return; }
      const d = ch.doc.data();
      const prevContent = notes[id]?.content;
      notes[id] = hydrateNoteShareState(d, {
        id,
        owner:    d.owner,
        title:    d.title    || 'Untitled Note',
        content:  d.content  || '',
        folderId: d.folderId || null,
        created:  d.created?.toDate?.()?.toISOString()  || new Date().toISOString(),
        modified: d.modified?.toDate?.()?.toISOString() || new Date().toISOString()
      });
      // If this note is open and the content changed (e.g. a collaborator saved),
      // sync the editor as long as the user isn't actively typing.
      if (id === activeId && prevContent !== undefined && prevContent !== d.content) {
        const ed = getEd();
        const titleEl = document.getElementById('doc-title');
        if (document.activeElement !== ed && document.activeElement !== titleEl) {
          titleEl.value = d.title || 'Untitled Note';
          ed.innerHTML  = renderMarkdownContent(d.content || '');
          linkifyTextNodes(ed); ensureLinkAttrs(ed);
          restoreChecklistState(ed); restoreAlarmMarks(ed);
          if (typeof restoreConversationAnchorMarks === 'function') restoreConversationAnchorMarks(ed);
          decorateTables(ed); refreshEmpty(ed); updateCounts();
        }
      }
    });
    purgeExpiredTrashNotes();
    renderSidebar();
    if (!activeId || !notes[activeId] || (isTrashedNote(notes[activeId]) && sidebarView !== 'trash')) {
      const ids = sortedIds();
      if (ids.length) openNote(ids[0]);
      else            showEditorView(false);
    }
    setSaveState('saved');
    settleInitial();
  }, err => {
    console.error('onSnapshot:', err);
    if (err.code === 'permission-denied')
      showToast('Firestore Permission Denied — Check Security Rules', 'error');
    renderSidebar();
    if (!activeId || !notes[activeId]) showEditorView(false);
    setSaveState('error');
    settleInitial();
  });
  return initialLoad;
}

/* Folder Listener */
function listenToFolders() {
  if (unsubFolders) unsubFolders();
  let initialSettled = false;
  let resolveInitial;
  const initialLoad = new Promise(resolve => { resolveInitial = resolve; });
  const settleInitial = () => {
    if (initialSettled) return;
    initialSettled = true;
    resolveInitial();
  };
  const q = query(collection(fsDb, 'folders'), where('owner', '==', userId));
  unsubFolders = onSnapshot(q, snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') { delete folders[id]; return; }
      const d = ch.doc.data();
      const iconColor = normalizeFolderIconColor(d.iconColor, d.iconColorMode) || DEFAULT_FOLDER_ICON_COLOR;
      const iconColorMode = iconColor === FOLDER_ICON_THEME ? 'theme' : 'manual';
      folders[id] = {
        id,
        title:    d.title   || 'Untitled Folder',
        public:   d.public  || false,
        shared:   !!d.shared,
        sharedWith: normalizeSharedWith(d.sharedWith),
        sharedAccessKeys: normalizeSharedAccessKeys(d.sharedAccessKeys),
        iconColor,
        iconColorMode,
        sourceFolderId: d.sourceFolderId || '',
        sourceOwnerUid: d.sourceOwnerUid || '',
        sourceOwnerName: d.sourceOwnerName || '',
        sourceOwnerPhotoURL: d.sourceOwnerPhotoURL || '',
        sourceOwnerPhotoURLCandidates: Array.isArray(d.sourceOwnerPhotoURLCandidates) ? d.sourceOwnerPhotoURLCandidates : [],
        order:    Number.isFinite(Number(d.order)) ? Number(d.order) : null,
        created:  d.created?.toDate?.()?.toISOString()  || new Date().toISOString(),
        modified: d.modified?.toDate?.()?.toISOString() || new Date().toISOString()
      };
      if (d.iconColor !== iconColor || d.iconColorMode !== iconColorMode) {
        setDoc(doc(fsDb, 'folders', id), { iconColor, iconColorMode }, { merge: true })
          .catch(err => console.error('persist default folder colour:', err));
      }
    });
    renderSidebar();
    settleInitial();
  }, err => {
    console.error('onSnapshot folders:', err);
    settleInitial();
  });
  return initialLoad;
}

/* Write / Delete */
async function saveDoc(note) {
  if (!userId) return false;
  if (!canEditNote(note)) {
    setSaveState('readonly');
    return false;
  }
  setSaveState('saving');
  try {
    const isOwner = !note.owner || note.owner === userId;
    // Shared users only update title/content; owner fields stay untouched (merge preserves sharedWith)
    const payload = {
      title:    note.title,
      content:  note.content,
      modified: serverTimestamp()
    };
    if (isOwner) {
      payload.owner   = userId;
      payload.public  = computeEffectiveNotePublic(note);
      payload.linkPublic = !!note.linkPublic;
      payload.publicFolderIds = normalizePublicFolderIds(note.publicFolderIds);
      payload.created = Timestamp.fromDate(new Date(note.created));
      payload.pinnedAt = note.pinnedAt ? Timestamp.fromDate(new Date(note.pinnedAt)) : deleteField();
      payload.pinScope = note.pinnedAt ? (note.pinScope === 'minor' ? 'minor' : 'major') : deleteField();
      if (Array.isArray(note.mentionedUids)) payload.mentionedUids = note.mentionedUids;
      if (note.folderId) payload.folderId = note.folderId;
    }
    await setDoc(doc(fsDb, 'notes', note.id), payload, { merge: true });
    setSaveState('saved');
    return true;
  } catch (err) {
    console.error('setDoc:', err);
    setSaveState('error');
    showToast('Failed To Save — Check Connection', 'error');
    _persistOffline(note);
    return false;
  }
}

async function saveFolderDoc(folder) {
  if (!userId) return;
  try {
    await setDoc(doc(fsDb, 'folders', folder.id), {
      owner:    userId,
      public:   folder.public || false,
      title:    folder.title,
      iconColor: normalizeFolderIconColor(folder.iconColor, folder.iconColorMode) || DEFAULT_FOLDER_ICON_COLOR,
      iconColorMode: (normalizeFolderIconColor(folder.iconColor, folder.iconColorMode) || DEFAULT_FOLDER_ICON_COLOR) === FOLDER_ICON_THEME ? 'theme' : 'manual',
      sharedWith: normalizeSharedWith(folder.sharedWith),
      sharedAccessKeys: normalizeSharedAccessKeys(folder.sharedAccessKeys),
      order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : nextFolderOrderValue(),
      created:  Timestamp.fromDate(new Date(folder.created)),
      modified: serverTimestamp()
    });
  } catch (err) {
    console.error('setDoc folder:', err);
    showToast('Failed To Save Folder', 'error');
  }
}

async function deleteDocNote(id) {
  if (!userId) return;
  try { await deleteDoc(doc(fsDb, 'notes', id)); }
  catch (err) { console.error('deleteDoc:', err); }
}

async function trashDocNote(note, deletedAt, trashExpiresAt) {
  if (!userId || !note) return;
  await setDoc(doc(fsDb, 'notes', note.id), {
    owner: userId,
    title: note.title || 'Untitled Note',
    content: note.content || '',
    modified: serverTimestamp(),
    deletedAt: Timestamp.fromDate(deletedAt),
    trashExpiresAt: Timestamp.fromDate(trashExpiresAt),
    pinnedAt: deleteField(),
    pinScope: deleteField()
  }, { merge: true });
}

async function restoreDocNote(id) {
  if (!userId) return;
  await setDoc(doc(fsDb, 'notes', id), {
    deletedAt: deleteField(),
    trashExpiresAt: deleteField(),
    modified: serverTimestamp()
  }, { merge: true });
}

/* Migration */
async function migrateFromLocalStorage() {
  if (localStorage.getItem('notas_migrated_v2')) return;
  const raw = localStorage.getItem('notas_v1');
  if (!raw) { localStorage.setItem('notas_migrated_v2', '1'); return; }
  try {
    const parsed = JSON.parse(raw);
    const list   = Object.values(parsed.lists || {});
    if (!list.length) { localStorage.setItem('notas_migrated_v2', '1'); return; }
    const batch = writeBatch(fsDb);
    list.forEach(n => {
      const html = renderMarkdownContent(n.content || '');
      batch.set(doc(fsDb, 'notes', n.id), {
        owner:    userId,
        title:    n.title,
        content:  html,
        created:  Timestamp.fromDate(new Date(n.created)),
        modified: Timestamp.fromDate(new Date(n.modified))
      });
    });
    await batch.commit();
    localStorage.setItem('notas_migrated_v2', '1');
    showToast(list.length + ' Local Note' + (list.length !== 1 ? 's' : '') + ' Migrated', 'success');
  } catch (err) { console.error('Migration error:', err); }
}

/* Scheduled save */
function scheduleSave() {
  setSaveState('unsaved');
  clearTimeout(saveTimer);
  const noteId = activeId;
  saveTimer = setTimeout(() => {
    if (noteId && notes[noteId]) saveDoc(notes[noteId]);
  }, 900);
}

/* ── Offline Persistence ────────────────────────────── */
const OFFLINE_KEY = 'notas_offline_edits';

function _persistOffline(note) {
  try {
    const pending = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '{}');
    pending[note.id] = {
      title: note.title,
      content: note.content,
      modified: note.modified,
      owner: note.owner || userId,
      shared: !!(note.owner && note.owner !== userId)
    };
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(pending));
  } catch (err) { console.error('_persistOffline:', err); }
}

function _flushOfflineEdits() {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw);
    const ids = Object.keys(pending);
    if (!ids.length) return;
    localStorage.removeItem(OFFLINE_KEY);
    ids.forEach(id => {
      const edit = pending[id];
      if (notes[id]) {
        // Only apply if offline edit is newer
        if (new Date(edit.modified) > new Date(notes[id].modified)) {
          notes[id].title   = edit.title;
          notes[id].content = edit.content;
          notes[id].modified = edit.modified;
          saveDoc(notes[id]);
        }
      } else {
        // Note might not be loaded yet. Never claim ownership of a known shared note.
        const payload = { title: edit.title, content: edit.content, modified: serverTimestamp() };
        const knownShared = edit.shared || (edit.owner && edit.owner !== userId) || sharedLibraryMeta[id];
        if (!knownShared) payload.owner = userId;
        setDoc(doc(fsDb, 'notes', id), payload, { merge: true }).catch(err => console.error('flush offline:', err));
      }
    });
    if (ids.length) showToast('Offline edits synced', 'success');
  } catch (err) { console.error('_flushOfflineEdits:', err); }
}

window.addEventListener('beforeunload', () => {
  // Persist any unsaved active note to localStorage as a safety net
  if (activeId && notes[activeId]) {
    const dot = document.getElementById('save-dot');
    if (dot && (dot.classList.contains('unsaved') || dot.classList.contains('saving'))) {
      _persistOffline(notes[activeId]);
    }
  }
});

/* CRUD */
