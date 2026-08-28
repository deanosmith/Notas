/* Folder CRUD, moving, sharing cleanup, and pinning. */
function folderOrderValue(folder) {
  if (Number.isFinite(Number(folder?.order))) return Number(folder.order);
  const created = new Date(folder?.created || 0).getTime();
  return Number.isFinite(created) && created > 0 ? created : Number.MAX_SAFE_INTEGER;
}

function compareFolders(a, b) {
  const orderDiff = folderOrderValue(a) - folderOrderValue(b);
  if (orderDiff) return orderDiff;
  const createdDiff = new Date(a?.created || 0) - new Date(b?.created || 0);
  if (createdDiff) return createdDiff;
  return String(a?.title || '').localeCompare(String(b?.title || ''));
}

function sortedFolders() {
  return Object.values(folders).sort(compareFolders);
}

function folderOrderHistorySnapshot(list = sortedFolders()) {
  return list.map(folder => ({
    id: folder.id,
    order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : null
  }));
}

function nextFolderOrderValue() {
  const ordered = sortedFolders();
  if (!ordered.length) return 1;
  const last = ordered[ordered.length - 1];
  const lastOrder = folderOrderValue(last);
  return Number.isFinite(lastOrder) && lastOrder < Number.MAX_SAFE_INTEGER ? lastOrder + 1 : ordered.length + 1;
}

function createFolder(title) {
  if (typeof isGuestReadOnly === 'function' && isGuestReadOnly()) return;
  const id  = 'folder_' + Date.now();
  const now = new Date().toISOString();
  const folder = { id, title: title.trim() || 'Untitled Folder', public: false, iconColor: DEFAULT_FOLDER_ICON_COLOR, iconColorMode: 'manual', sharedWith: {}, sharedAccessKeys: [], order: nextFolderOrderValue(), created: now, modified: now };
  folders[id] = folder;
  expandedFolders.add(id);
  activeFolderId = id;
  renderSidebar();
  saveFolderDoc(folder);
}

async function renameFolder(folderId, title) {
  const folder = folders[folderId];
  const nextTitle = String(title || '').trim() || 'Untitled Folder';
  if (!folder || !isOwnedFolder(folder) || folder.title === nextTitle) return;
  const previousTitle = folder.title;
  folder.title = nextTitle;
  folder.modified = new Date().toISOString();
  renderSidebar();
  try {
    await setDoc(doc(fsDb, 'folders', folderId), {
      title: nextTitle,
      modified: serverTimestamp()
    }, { merge: true });
    recordAppHistoryAction({
      type: 'folder-rename',
      folderId,
      beforeTitle: previousTitle,
      afterTitle: nextTitle
    });
    showToast('Folder Renamed', 'success');
  } catch (err) {
    console.error('rename folder:', err);
    folder.title = previousTitle;
    renderSidebar();
    showToast('Could Not Rename Folder', 'error');
  }
}

async function reorderFolder(draggedId, targetId, position) {
  if (!draggedId || !targetId || draggedId === targetId || !folders[draggedId] || !folders[targetId]) return;
  const ordered = sortedFolders();
  const beforeOrder = folderOrderHistorySnapshot(ordered);
  const withoutDragged = ordered.filter(folder => folder.id !== draggedId);
  const targetIndex = withoutDragged.findIndex(folder => folder.id === targetId);
  if (targetIndex < 0) return;
  withoutDragged.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, folders[draggedId]);
  if (withoutDragged.every((folder, index) => ordered[index]?.id === folder.id)) return;

  const previousOrders = new Map(withoutDragged.map(folder => [folder.id, folder.order]));
  withoutDragged.forEach((folder, index) => {
    folder.order = index + 1;
    folder.modified = new Date().toISOString();
  });
  renderSidebar();

  try {
    await Promise.all(withoutDragged.map(folder => setDoc(doc(fsDb, 'folders', folder.id), {
      order: folder.order,
      modified: serverTimestamp()
    }, { merge: true })));
    recordAppHistoryAction({
      type: 'folder-move',
      beforeOrder,
      afterOrder: folderOrderHistorySnapshot()
    });
    showToast('Folders Reordered', 'success');
  } catch (err) {
    console.error('reorder folders:', err);
    previousOrders.forEach((order, id) => {
      if (folders[id]) folders[id].order = order;
    });
    renderSidebar();
    showToast('Could Not Reorder Folders', 'error');
  }
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
  const previous = normalizeFolderIconColor(folder.iconColor, folder.iconColorMode) || DEFAULT_FOLDER_ICON_COLOR;
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
    .filter(folder => !isOwnedNote(note) || isOwnedFolder(folder))
    .sort(compareFolders);

  moveFolders
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

async function moveNoteToFolder(noteId, folderId, { unpin = false } = {}) {
  const note = notes[noteId];
  if (!note) return;
  folderId = folderId && folders[folderId] ? folderId : null;
  if (folderId && isOwnedNote(note) && !isOwnedFolder(folders[folderId])) folderId = null;
  const prev = note.folderId;
  const folderChanged = (folderId || null) !== (prev || null);
  const previousPinnedAt = normalizePinnedAt(note.pinnedAt);
  const previousPinScope = note.pinScope || '';
  const shouldUnpin = unpin && !!previousPinnedAt;
  if (!folderChanged && !shouldUnpin) return;
  note.folderId = folderId || null;
  if (shouldUnpin) {
    note.pinnedAt = '';
    note.pinScope = '';
  }
  note.modified = new Date().toISOString();
  if (folderId) expandedFolders.add(folderId);
  renderSidebar();
  try {
    let cloudSynced = true;
    if (isOwnedNote(note)) {
      if (folderChanged && prev && prev !== folderId) {
        const previousFolder = folders[prev];
        await removeFolderScopeFromNote(noteId, prev);
        if (previousFolder) {
          await Promise.all(folderSharedProfiles(previousFolder)
            .filter(profile => profile.uid)
            .map(profile => removeFolderScopeFromNoteAccess(noteId, prev, profile.uid)));
        }
      }
      if (folderChanged && folderId) {
        const publicFolderIds = new Set(normalizePublicFolderIds(note.publicFolderIds));
        if (folders[folderId]?.public) publicFolderIds.add(folderId);
        else publicFolderIds.delete(folderId);
        note.publicFolderIds = [...publicFolderIds];
        await inheritFolderSharingForNote(note, folderId);
      }
      const payload = { modified: serverTimestamp() };
      if (folderChanged) {
        note.public = computeEffectiveNotePublic(note);
        payload.folderId = folderId || deleteField();
        payload.public = note.public;
        payload.publicFolderIds = normalizePublicFolderIds(note.publicFolderIds);
      }
      if (shouldUnpin) {
        payload.pinnedAt = deleteField();
        payload.pinScope = deleteField();
      }
      await setDoc(doc(fsDb, 'notes', noteId), payload, { merge: true });
    } else {
      cloudSynced = await _setSharedNoteFolder(noteId, folderId, { unpin: shouldUnpin });
    }
    if (folderChanged) {
      recordAppHistoryAction({
        type: 'note-move',
        noteId,
        beforeFolderId: prev || null,
        afterFolderId: note.folderId || null
      });
    }
    const successMessage = shouldUnpin
      ? (folderChanged ? 'Note Moved And Unpinned' : 'Note Unpinned')
      : 'Note Moved';
    const failureMessage = shouldUnpin
      ? (folderChanged ? 'Note moved and unpinned locally; cloud sync failed' : 'Note unpinned locally; cloud sync failed')
      : 'Note moved locally; cloud sync failed';
    showToast(cloudSynced ? successMessage : failureMessage, cloudSynced ? 'success' : 'error');
  } catch (err) {
    console.error('moveNoteToFolder:', err);
    note.folderId = prev;
    note.pinnedAt = previousPinnedAt;
    note.pinScope = previousPinScope;
    renderSidebar();
    showToast(shouldUnpin ? 'Failed To Move Or Unpin Note' : 'Failed To Move Note', 'error');
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
