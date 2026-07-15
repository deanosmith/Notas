/* Firestore listeners, writes, migration, and offline persistence. */
const NOTE_BODY_COLLECTION = 'noteBodies';

function noteBodyDocRef(noteId) {
  return doc(fsDb, NOTE_BODY_COLLECTION, noteId);
}

function noteContentMetadataPayload(content, options = {}) {
  const metadata = buildNoteContentMetadata(content || '', options);
  return {
    previewText: metadata.previewText,
    searchText: metadata.searchText,
    inlineAlarms: metadata.inlineAlarms,
    bodyStorage: NOTE_BODY_COLLECTION,
    bodyModified: serverTimestamp()
  };
}

function noteBodyPayload(note, content) {
  return {
    noteId: note.id,
    owner: note.owner || userId,
    updatedBy: userId,
    content: String(content || ''),
    modified: serverTimestamp()
  };
}

async function writeNoteBodyDoc(note, content = note?.content || '') {
  if (!note?.id || !userId) return false;
  try {
    await setDoc(noteBodyDocRef(note.id), noteBodyPayload(note, content), { merge: true });
    return true;
  } catch (err) {
    console.warn('write note body:', err);
    return false;
  }
}

function clearActiveNoteBodyListener() {
  if (activeNoteBodyUnsub) {
    try { activeNoteBodyUnsub(); } catch (_) {}
  }
  activeNoteBodyUnsub = null;
  activeNoteBodyListeningId = null;
}

function releaseInactiveNoteBodies(keepId = '') {
  Object.keys(notes || {}).forEach(id => {
    if (id === keepId) return;
    const note = notes[id];
    if (!note?._bodyLoaded) return;
    note.content = '';
    note._bodyLoaded = false;
  });
}

async function readNoteBodyContent(noteId) {
  if (!noteId) return '';
  let bodyError = null;
  try {
    const bodySnap = await getDoc(noteBodyDocRef(noteId));
    if (bodySnap.exists()) return String(bodySnap.data()?.content || '');
  } catch (err) {
    bodyError = err;
    console.warn('read note body:', err);
  }

  const noteSnap = await getDoc(doc(fsDb, 'notes', noteId));
  if (noteSnap.exists()) {
    const legacyContent = noteSnap.data()?.content;
    if (typeof legacyContent === 'string') return legacyContent;
  }
  if (bodyError) throw bodyError;
  return '';
}

async function loadNoteBody(noteId, options = {}) {
  const note = notes?.[noteId];
  if (!note) return '';
  if (note._bodyLoaded && options.force !== true) return note.content || '';
  const seq = ++activeNoteBodyRequestSeq;
  const content = await readNoteBodyContent(noteId);
  if (options.activeOnly && (activeId !== noteId || seq !== activeNoteBodyRequestSeq)) return content;
  applyNoteBodyContent(noteId, content);
  return content;
}

function listenToActiveNoteBody(noteId) {
  if (activeNoteBodyListeningId === noteId) return;
  clearActiveNoteBodyListener();
  if (!noteId || !userId) return;
  activeNoteBodyListeningId = noteId;
  activeNoteBodyUnsub = onSnapshot(noteBodyDocRef(noteId), snap => {
    if (!snap.exists()) return;
    const content = String(snap.data()?.content || '');
    const note = notes[noteId];
    const previous = note?.content || '';
    const ed = getEd();
    const titleEl = document.getElementById('doc-title');
    if (activeId === noteId && (document.activeElement === ed || document.activeElement === titleEl)) return;
    const modified = normalizeNoteTimestamp(snap.data()?.modified);
    applyNoteBodyContent(noteId, content, modified ? { modified } : {});
    if (activeId === noteId && previous !== content && typeof applyRemoteNoteBodyContent === 'function') {
      applyRemoteNoteBodyContent(noteId, content);
    }
    renderAlarmButton();
    refreshOpenSidebarPage('alarms');
  }, err => {
    console.warn('active note body listener:', err);
    const note = notes[noteId];
    if (note) note._bodyError = true;
  });
}

function migrateLegacyNoteBody(id, data = {}) {
  if (!id || typeof data.content !== 'string' || legacyBodyMigrationIds.has(id)) return;
  legacyBodyMigrationIds.add(id);
  const note = notes[id] || noteFromFirestoreData(id, data);
  const content = data.content || '';
  writeNoteBodyDoc(note, content)
    .then(async bodyStored => {
      if (!bodyStored) return;
      await setDoc(doc(fsDb, 'notes', id), {
        ...noteContentMetadataPayload(content),
        content: deleteField()
      }, { merge: true });
    })
    .catch(err => console.warn('legacy note body migration:', err))
    .finally(() => legacyBodyMigrationIds.delete(id));
}

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
      if (ch.type === 'removed') {
        if (id === activeId) clearActiveNoteBodyListener();
        delete notes[id];
        return;
      }
      const d = ch.doc.data();
      const legacyContent = typeof d.content === 'string' ? d.content : null;
      const prevContent = notes[id]?._bodyLoaded ? notes[id].content : undefined;
      notes[id] = noteFromFirestoreData(id, d);
      if (legacyContent !== null) migrateLegacyNoteBody(id, d);
      // If this note is open and the content changed (e.g. a collaborator saved),
      // sync the editor as long as the user isn't actively typing.
      if (id === activeId && legacyContent !== null && prevContent !== undefined && prevContent !== legacyContent) {
        const ed = getEd();
        const titleEl = document.getElementById('doc-title');
        if (document.activeElement !== ed && document.activeElement !== titleEl) {
          titleEl.value = d.title || 'Untitled Note';
          if (typeof applyRemoteNoteBodyContent === 'function') applyRemoteNoteBodyContent(id, legacyContent);
        }
      }
    });
    releaseInactiveNoteBodies(activeId || '');
    purgeExpiredTrashNotes();
    renderSidebar();
    window.dispatchEvent(new CustomEvent('notas:notes-updated'));
    if (typeof renderConversationsSidebar === 'function') renderConversationsSidebar();
    if ((conversationsOpen || sidebarView === 'conversations') && typeof scheduleConversationOverviewRefresh === 'function') scheduleConversationOverviewRefresh();
    const restoredRememberedNote = !activeId && typeof openRememberedNoteWhenAvailable === 'function' && openRememberedNoteWhenAvailable();
    if (!restoredRememberedNote && (!activeId || !notes[activeId] || (isTrashedNote(notes[activeId]) && sidebarView !== 'trash'))) {
      if (typeof shouldDeferInitialNoteFallback === 'function' && shouldDeferInitialNoteFallback()) {
        showEditorView(false);
      } else {
        const ids = sortedIds();
        if (ids.length) openNote(ids[0]);
        else            showEditorView(false);
      }
    }
    setSaveState('saved');
    settleInitial();
  }, err => {
    console.error('onSnapshot:', err);
    if (err.code === 'permission-denied')
      showToast('Firestore Permission Denied — Check Security Rules', 'error');
    renderSidebar();
    if (typeof renderConversationsSidebar === 'function') renderConversationsSidebar();
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
    if (typeof renderConversationsSidebar === 'function') renderConversationsSidebar();
    if (sidebarView === 'conversations' && typeof scheduleConversationOverviewRefresh === 'function') scheduleConversationOverviewRefresh();
    settleInitial();
  }, err => {
    console.error('onSnapshot folders:', err);
    if (typeof renderConversationsSidebar === 'function') renderConversationsSidebar();
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
    const contentLoaded = !!note._bodyLoaded;
    const content = contentLoaded ? String(note.content || '') : '';
    const bodyStored = contentLoaded ? await writeNoteBodyDoc(note, content) : true;
    // Shared users only update title/content; owner fields stay untouched (merge preserves sharedWith)
    const payload = {
      title:    note.title,
      modified: serverTimestamp()
    };
    if (contentLoaded) {
      Object.assign(payload, noteContentMetadataPayload(content));
      payload.content = bodyStored ? deleteField() : content;
      if (!bodyStored) payload.bodyStorage = 'notes';
    }
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
    if (contentLoaded) applyNoteBodyContent(note.id, content);
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
  try { await deleteDoc(noteBodyDocRef(id)); }
  catch (err) { console.warn('delete note body:', err); }
  try { await deleteDoc(doc(fsDb, 'notes', id)); }
  catch (err) { console.error('deleteDoc:', err); }
}

async function trashDocNote(note, deletedAt, trashExpiresAt) {
  if (!userId || !note) return;
  const bodyStored = note._bodyLoaded ? await writeNoteBodyDoc(note, note.content || '') : true;
  const payload = {
    owner: userId,
    title: note.title || 'Untitled Note',
    ...(note._bodyLoaded ? noteContentMetadataPayload(note.content || '') : {}),
    modified: serverTimestamp(),
    deletedAt: Timestamp.fromDate(deletedAt),
    trashExpiresAt: Timestamp.fromDate(trashExpiresAt),
    pinnedAt: deleteField(),
    pinScope: deleteField()
  };
  if (note._bodyLoaded) payload.content = bodyStored ? deleteField() : (note.content || '');
  await setDoc(doc(fsDb, 'notes', note.id), payload, { merge: true });
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
      const created = Timestamp.fromDate(new Date(n.created));
      const modified = Timestamp.fromDate(new Date(n.modified));
      batch.set(doc(fsDb, 'notes', n.id), {
        owner:    userId,
        title:    n.title,
        ...noteContentMetadataPayload(html),
        created,
        modified
      });
      batch.set(noteBodyDocRef(n.id), {
        noteId: n.id,
        owner: userId,
        updatedBy: userId,
        content: html,
        created,
        modified
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
          applyNoteBodyContent(id, edit.content || '');
          notes[id].modified = edit.modified;
          saveDoc(notes[id]);
        }
      } else {
        // Note might not be loaded yet. Never claim ownership of a known shared note.
        const bodyNote = { id, owner: edit.owner || userId };
        const bodyStored = false; // metadata fallback keeps offline recovery independent of note-body rules
        const payload = {
          title: edit.title,
          ...noteContentMetadataPayload(edit.content || ''),
          content: bodyStored ? deleteField() : (edit.content || ''),
          modified: serverTimestamp()
        };
        const knownShared = edit.shared || (edit.owner && edit.owner !== userId) || sharedLibraryMeta[id];
        if (!knownShared) payload.owner = userId;
        writeNoteBodyDoc(bodyNote, edit.content || '').catch(err => console.warn('offline note body:', err));
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
