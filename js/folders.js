/* Folder CRUD, moving, and pinning - extracted from index.original.html. */
function createFolder(title) {
  const id  = 'folder_' + Date.now();
  const now = new Date().toISOString();
  const folder = { id, title: title.trim() || 'Untitled Folder', public: false, iconColor: FOLDER_ICON_THEME, iconColorMode: 'theme', sharedWith: {}, sharedAccessKeys: [], created: now, modified: now };
  folders[id] = folder;
  expandedFolders.add(id);
  activeFolderId = id;
  renderSidebar();
  saveFolderDoc(folder);
}

async function deleteFolder(id) {
  if (!folders[id]) return;
  openDeleteModal('folder', id);
}

async function removeSharedFolderFromLibrary(id) {
  const folder = folders[id];
  if (!folder) return;
  const batch = writeBatch(fsDb);
  const removedSharedIds = [];
  let activeWasRemoved = false;

  Object.values(notes).filter(n => n.folderId === id).forEach(n => {
    if (isOwnedNote(n)) {
      n.folderId = null;
      batch.update(doc(fsDb, 'notes', n.id), { folderId: null });
    } else {
      if (sharedNoteUnsubs[n.id]) { sharedNoteUnsubs[n.id](); delete sharedNoteUnsubs[n.id]; }
      delete notes[n.id];
      removedSharedIds.push(n.id);
      if (activeId === n.id) activeWasRemoved = true;
    }
  });

  batch.delete(doc(fsDb, 'folders', id));
  delete folders[id];
  expandedFolders.delete(id);
  if (activeFolderId === id) activeFolderId = null;
  if (activeWasRemoved) activeId = null;

  try {
    await batch.commit();
    await Promise.all(removedSharedIds.map(noteId => _removeSharedId(noteId, { removedByUser: true })));
    showToast('Removed From Library', 'success');
  } catch (err) {
    console.error('removeSharedFolderFromLibrary:', err);
    showToast('Failed To Remove From Library', 'error');
  }
  renderSidebar();
  if (!activeId) { const ids = sortedIds(); ids.length ? openNote(ids[0]) : showEditorView(false); }
}

async function _execDeleteFolder(id) {
  const folder = folders[id];
  if (!folder) return;
  if (!isOwnedFolder(folder)) { await removeSharedFolderFromLibrary(id); return; }
  const batch = writeBatch(fsDb);
  const sharedToMove = [];
  const folderAccessCleanupFns = [];
  const folderProfiles = folderSharedProfiles(folder);
  Object.values(notes).filter(n => n.folderId === id).forEach(n => {
    n.folderId = null;
    if (isOwnedNote(n)) {
      const publicFolderIds = new Set(normalizePublicFolderIds(n.publicFolderIds));
      publicFolderIds.delete(id);
      n.publicFolderIds = [...publicFolderIds];
      const nextSharedWith = {};
      Object.keys(normalizeSharedWith(n.sharedWith)).forEach(key => {
        const nextEntry = removeFolderScopeFromEntry(n.sharedWith[key], id);
        if (nextEntry) nextSharedWith[key] = nextEntry;
      });
      n.sharedWith = nextSharedWith;
      n.sharedAccessKeys = rebuildSharedAccessKeys(n.sharedWith);
      n.public = computeEffectiveNotePublic(n);
      folderProfiles.forEach(profile => {
        if (profile.uid) folderAccessCleanupFns.push(() => removeFolderScopeFromNoteAccess(n.id, id, profile.uid));
      });
      batch.update(doc(fsDb, 'notes', n.id), {
        folderId: null,
        public: n.public,
        publicFolderIds: n.publicFolderIds,
        sharedWith: Object.keys(n.sharedWith).length ? n.sharedWith : deleteField(),
        sharedAccessKeys: n.sharedAccessKeys.length ? n.sharedAccessKeys : deleteField()
      });
    } else {
      sharedToMove.push(n.id);
    }
  });
  batch.delete(doc(fsDb, 'folders', id));
  delete folders[id];
  expandedFolders.delete(id);
  if (activeFolderId === id) activeFolderId = null;
  try {
    await batch.commit();
    await Promise.all([
      ...sharedToMove.map(noteId => _setSharedNoteFolder(noteId, null)),
      ...folderAccessCleanupFns.map(fn => fn())
    ]);
  } catch (err) { console.error('deleteFolder:', err); showToast('Failed To Delete Folder', 'error'); }
  renderSidebar();
}

async function setFolderPublic(folderId, isPublic) {
  if (!folders[folderId]) return;
  const previousPublic = !!folders[folderId].public;
  folders[folderId].public = isPublic;
  try {
    await setDoc(doc(fsDb, 'folders', folderId), { public: isPublic }, { merge: true });
    const folderNotes = Object.values(notes).filter(n => n.folderId === folderId && isOwnedNote(n));
    await Promise.all(folderNotes.map(n => {
      const publicFolderIds = new Set(normalizePublicFolderIds(n.publicFolderIds));
      if (isPublic) publicFolderIds.add(folderId);
      else publicFolderIds.delete(folderId);
      n.publicFolderIds = [...publicFolderIds];
      n.public = computeEffectiveNotePublic(n);
      return setDoc(doc(fsDb, 'notes', n.id), {
        public: n.public,
        publicFolderIds: n.publicFolderIds
      }, { merge: true });
    }));
    return true;
  }
  catch (err) {
    console.error('setFolderPublic:', err);
    folders[folderId].public = previousPublic;
    renderSidebar();
    showToast('Failed To Update Folder Sharing', 'error');
    return false;
  }
}

async function setFolderIconColor(folderId, color) {
  const folder = folders[folderId];
  const iconColor = normalizeFolderIconColor(color, color === FOLDER_ICON_THEME ? 'theme' : 'manual');
  if (!folder || !iconColor) return;
  const previous = normalizeFolderIconColor(folder.iconColor, folder.iconColorMode) || FOLDER_ICON_THEME;
  const previousMode = folder.iconColorMode || (previous === FOLDER_ICON_THEME ? 'theme' : 'manual');
  folder.iconColor = iconColor;
  folder.iconColorMode = iconColor === FOLDER_ICON_THEME ? 'theme' : 'manual';
  renderSidebar();
  try {
    await setDoc(doc(fsDb, 'folders', folderId), { iconColor, iconColorMode: folder.iconColorMode, modified: serverTimestamp() }, { merge: true });
    showToast('Folder Colour Updated', 'success');
  } catch (err) {
    console.error('setFolderIconColor:', err);
    folder.iconColor = previous;
    folder.iconColorMode = previousMode;
    renderSidebar();
    showToast('Could Not Update Folder Colour', 'error');
  }
}


function openMoveModal(noteId) {
  if (!notes[noteId]) return;
  _moveNoteId = noteId;
  const note  = notes[noteId];
  document.getElementById('move-modal-note-name').textContent = note.title;
  const list  = document.getElementById('move-modal-list');
  list.innerHTML = '';

  const defaultFolderName = isOwnedNote(note) ? 'No Folder' : 'Shared Notes';
  const noFolderItem = document.createElement('div');
  const isNoFolder   = !hasVisibleFolder(note);
  noFolderItem.className = 'move-folder-item' + (isNoFolder ? ' is-current' : '');
  noFolderItem.innerHTML =
    '<i class="mfi fa-solid fa-inbox"></i><span>' + defaultFolderName + (isNoFolder ? ' (current)' : '') + '</span>';
  if (!isNoFolder) noFolderItem.addEventListener('click', () => { closeMoveModal(); moveNoteToFolder(noteId, null); });
  list.appendChild(noFolderItem);

  const moveFolders = Object.values(folders)
    .filter(folder => !isOwnedNote(note) || isOwnedFolder(folder));

  moveFolders
    .sort((a, b) => new Date(a.created) - new Date(b.created))
    .forEach(folder => {
      const isCurrent = note.folderId === folder.id;
      const item = document.createElement('div');
      item.className = 'move-folder-item' + (isCurrent ? ' is-current' : '');
      item.innerHTML =
        '<i class="mfi fa-solid fa-folder"></i><span>' + esc(folder.title) + (isCurrent ? ' (current)' : '') + '</span>';
      if (!isCurrent) item.addEventListener('click', () => { closeMoveModal(); moveNoteToFolder(noteId, folder.id); });
      list.appendChild(item);
    });

  if (!moveFolders.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:12px;color:var(--muted);font-size:12.5px;text-align:center;font-style:italic;';
    empty.textContent = 'No folders yet — create one first';
    list.appendChild(empty);
  }

  document.getElementById('move-modal').classList.add('open');
}
function closeMoveModal() {
  document.getElementById('move-modal').classList.remove('open');
  _moveNoteId = null;
}

async function moveNoteToFolder(noteId, folderId) {
  const note = notes[noteId];
  if (!note) return;
  folderId = folderId && folders[folderId] ? folderId : null;
  if (folderId && isOwnedNote(note) && !isOwnedFolder(folders[folderId])) folderId = null;
  const prev = note.folderId;
  if ((folderId || null) === (prev || null)) return;
  note.folderId = folderId || null;
  note.modified = new Date().toISOString();
  if (folderId) expandedFolders.add(folderId);
  renderSidebar();
  try {
    let cloudSynced = true;
    if (isOwnedNote(note)) {
      if (prev && prev !== folderId) {
        const previousFolder = folders[prev];
        await removeFolderScopeFromNote(noteId, prev);
        if (previousFolder) {
          await Promise.all(folderSharedProfiles(previousFolder)
            .filter(profile => profile.uid)
            .map(profile => removeFolderScopeFromNoteAccess(noteId, prev, profile.uid)));
        }
      }
      if (folderId) {
        const publicFolderIds = new Set(normalizePublicFolderIds(note.publicFolderIds));
        if (folders[folderId]?.public) publicFolderIds.add(folderId);
        else publicFolderIds.delete(folderId);
        note.publicFolderIds = [...publicFolderIds];
        await inheritFolderSharingForNote(note, folderId);
      }
      note.public = computeEffectiveNotePublic(note);
      const payload = { modified: serverTimestamp() };
      payload.folderId = folderId || deleteField();
      payload.public = note.public;
      payload.publicFolderIds = normalizePublicFolderIds(note.publicFolderIds);
      await setDoc(doc(fsDb, 'notes', noteId), payload, { merge: true });
    } else {
      cloudSynced = await _setSharedNoteFolder(noteId, folderId);
    }
    showToast(cloudSynced ? 'Note Moved' : 'Note moved locally; cloud sync failed', cloudSynced ? 'success' : 'error');
  } catch (err) {
    console.error('moveNoteToFolder:', err);
    note.folderId = prev;
    renderSidebar();
    showToast('Failed To Move Note', 'error');
  }
}

async function setNotePinned(noteId, pinned, scope = 'major') {
  const note = notes[noteId];
  if (!note) return;
  const previous = normalizePinnedAt(note.pinnedAt);
  const previousScope = note.pinScope || '';
  const nextPinnedAt = pinned ? new Date().toISOString() : '';
  const nextScope = pinned ? (scope === 'minor' ? 'minor' : 'major') : '';
  note.pinnedAt = nextPinnedAt;
  note.pinScope = nextScope;
  renderSidebar();
  try {
    if (isOwnedNote(note)) {
      await setDoc(doc(fsDb, 'notes', noteId), {
        pinnedAt: nextPinnedAt ? Timestamp.fromDate(new Date(nextPinnedAt)) : deleteField(),
        pinScope: nextPinnedAt ? nextScope : deleteField()
      }, { merge: true });
    } else {
      const ok = await _setSharedNotePinned(noteId, nextPinnedAt, nextScope);
      showToast(
        ok
          ? (nextPinnedAt ? 'Note Pinned' : 'Note Unpinned')
          : (nextPinnedAt ? 'Note pinned locally; cloud sync failed' : 'Note unpinned locally; cloud sync failed'),
        ok ? 'success' : 'error'
      );
      return;
    }
    showToast(nextPinnedAt ? 'Note Pinned' : 'Note Unpinned', 'success');
  } catch (err) {
    console.error('set note pinned:', err);
    note.pinnedAt = previous;
    note.pinScope = previousScope;
    if (!isOwnedNote(note) && sharedLibraryMeta[noteId]) {
      sharedLibraryMeta[noteId].pinnedAt = previous;
      sharedLibraryMeta[noteId].pinScope = previousScope;
      _writeSharedLibraryToLocal();
    }
    renderSidebar();
    showToast('Could Not Update Pin', 'error');
  }
}
