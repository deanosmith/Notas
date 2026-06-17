/* Rendering, modals, sidebar, drawer, and settings UI - extracted from index.original.html. */
function openDeleteModal(type, id) {
  const item = type === 'note' || type === 'trash-note' ? notes[id] : folders[id];
  const name = item?.title;
  if (!name) return;
  const isPermanentTrashDelete = type === 'trash-note';
  const isOwned = isPermanentTrashDelete ? true : (type === 'note' ? isOwnedNote(item) : isOwnedFolder(item));
  _deletePending = { type, id, mode: isOwned ? 'delete' : 'remove' };

  const titleEl = document.getElementById('delete-modal-title');
  const bodyEl = document.getElementById('delete-modal-body');
  const confirmBtn = document.getElementById('delete-modal-confirm');

  titleEl.textContent = isPermanentTrashDelete
    ? 'Delete Forever?'
    : isOwned
    ? (type === 'note' ? 'Delete Note?' : 'Delete Folder?')
    : (type === 'note' ? 'Remove Shared Note?' : 'Remove Shared Folder?');
  bodyEl.className = 'delete-message' + (isOwned ? '' : ' remove');
  const copy = isPermanentTrashDelete
    ? 'Permanently deletes this note now. This cannot be undone.'
    : isOwned
    ? (type === 'note'
      ? 'Moves this note to Trash for 30 days. You can restore it before it is permanently deleted.'
      : 'Deletes the folder. Notes inside move to Notes.')
    : (type === 'note'
      ? 'Removes it from your library only. The owner keeps the note.'
      : 'Removes this folder and its shared notes from your library only.');
  bodyEl.innerHTML =
    '<strong class="delete-target">' + esc(name) + '</strong>' +
    '<div class="delete-copy">' + esc(copy) + '</div>';
  confirmBtn.innerHTML = isPermanentTrashDelete
    ? '<i class="fa-solid fa-trash" style="margin-right:6px;"></i>Delete Forever'
    : isOwned
    ? '<i class="fa-solid fa-trash" style="margin-right:6px;"></i>Move To Trash'
    : '<i class="fa-solid fa-xmark" style="margin-right:6px;"></i>Remove';
  document.getElementById('delete-modal').classList.add('open');
}
function closeDeleteModal() {
  document.getElementById('delete-modal').classList.remove('open');
  _deletePending = null;
}
async function confirmDelete() {
  if (!_deletePending) return;
  const pending = _deletePending;
  const { type, id } = pending;
  closeDeleteModal();
  if (type === 'note') await _execDeleteNote(id);
  else if (type === 'trash-note') permanentlyDeleteTrashedNote(id);
  else if (type === 'profile') await removeLinkedProfile(id);
  else if (type === 'table') confirmTableDelete(pending.table);
  else await _execDeleteFolder(id);
}

/* Move Modal */

/* Sidebar */
function isOwnedNote(note) {
  return !note?.owner || note.owner === userId;
}

function isSharedFolder(folder) {
  return !!(folder?.shared || folder?.sourceFolderId);
}

function isOwnedFolder(folder) {
  return !!folder && !isSharedFolder(folder);
}

function hasVisibleFolder(note) {
  return !!(note?.folderId && folders[note.folderId]);
}

const noteMatchesFilter = (n, f) =>
  n.title.toLowerCase().includes(f) ||
  n.content.replace(/<[^>]+>/g, ' ').toLowerCase().includes(f);

function profileIdentityKey(profile) {
  return normalizeEmail(profile?.email || '') || profile?.uid || profile?.displayName || '';
}

function uniqueProfiles(profiles) {
  const out = [];
  const seen = new Set();
  profiles.filter(Boolean).forEach(profile => {
    const key = profileIdentityKey(profile);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(profile);
  });
  return out;
}

function enrichProfileFromLinkedCache(profile) {
  const normalized = normalizeLinkedProfile(profile?.uid, profile);
  if (!normalized) return profile;
  const cached = Object.values(linkedProfiles).find(p => profileMatchesLink(p, normalized));
  return mergeLinkedProfileRecords(cached, normalized) || normalized;
}

function accessProfilesFromSharedWith(sharedWith) {
  return uniqueProfiles(Object.values(normalizeSharedWith(sharedWith))
    .map(entry => normalizeAccessEntry(entry))
    .filter(accessEntryHasAnyScope)
    .map(entry => enrichProfileFromLinkedCache({
      uid: entry.uid || emailProfileKey(entry.email || ''),
      displayName: entry.displayName || entry.email || 'Linked Profile',
      email: normalizeEmail(entry.email || ''),
      photoURL: entry.photoURL || '',
      photoURLCandidates: entry.photoURLCandidates || []
    })));
}

function sourceProfileFromAccess(access, fallbackName = 'Shared Owner') {
  if (!access) return null;
  return {
    uid: access.fromUid || '',
    displayName: access.fromName || fallbackName,
    email: normalizeEmail(access.fromEmail || ''),
    photoURL: access.fromPhotoURL || '',
    photoURLCandidates: access.fromPhotoURLCandidates || []
  };
}

function accessProfilesForNote(note) {
  if (!note) return [];
  const directProfiles = noteAccessProfiles(note.id);
  if (directProfiles.length) return directProfiles;
  if (isOwnedNote(note)) return accessProfilesFromSharedWith(note.sharedWith);
  return uniqueProfiles([sourceProfileFromAccess(note.directAccess || getSharedAccessEntry(note.sharedWith), 'Shared Owner')]);
}

function accessProfilesForFolder(folder) {
  if (!folder) return [];
  if (isOwnedFolder(folder)) return accessProfilesFromSharedWith(folder.sharedWith);
  return uniqueProfiles([{
    uid: folder.sourceOwnerUid || '',
    displayName: folder.sourceOwnerName || 'Shared Owner',
    email: '',
    photoURL: folder.sourceOwnerPhotoURL || '',
    photoURLCandidates: folder.sourceOwnerPhotoURLCandidates || []
  }]);
}

function renderAccessAvatars(profiles, label) {
  const visible = uniqueProfiles(profiles).filter(p => p.displayName || p.photoURL || p.email);
  if (!visible.length) return '';
  const shown = visible.slice(0, 3);
  const title = (label ? label + ': ' : '') + visible.map(p => p.displayName || p.email || 'Linked Profile').join(', ');
  return '<span class="access-avatars" title="' + esc(title) + '">' +
    shown.map(p => renderAvatar(p, 'access-avatar')).join('') +
    (visible.length > shown.length ? '<span class="access-avatar access-more">+' + (visible.length - shown.length) + '</span>' : '') +
  '</span>';
}

function updateActiveNoteAccessAvatars() {
  const el = document.getElementById('doc-access-avatars');
  if (!el) return;
  const note = activeId ? notes[activeId] : null;
  el.innerHTML = note ? renderAccessAvatars(accessProfilesForNote(note), isOwnedNote(note) ? 'Shared with' : 'Your access') : '';
}

/* ── Context Menu ────────────────────────────────── */
function openCtxMenu(anchorEl, items) {
  closeCtxMenu();
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = '';

  const buildCtxRow = item => {
    if (item === 'sep') {
      const s = document.createElement('div'); s.className = 'ctx-sep'; return s;
    }
    const row = document.createElement('div');
    const hasSubmenu = Array.isArray(item.children) && item.children.length;
    row.className = 'ctx-row' + (item.danger ? ' danger' : '') + (hasSubmenu ? ' has-submenu' : '');
    const icon = item.color
      ? '<span class="ctx-color-dot" style="background:' + esc(item.color) + ';"></span>'
      : '<i class="' + item.icon + '"></i>';
    row.innerHTML = icon + '<span>' + esc(item.label) + '</span>' + (hasSubmenu ? '<span class="ctx-sub-arrow">&rsaquo;</span>' : '');
    if (hasSubmenu) {
      const sub = document.createElement('div');
      sub.className = 'ctx-submenu';
      item.children.forEach(child => sub.appendChild(buildCtxRow(child)));
      row.appendChild(sub);
      row.addEventListener('click', e => {
        if (e.target.closest('.ctx-submenu')) return;
        e.stopPropagation();
        row.classList.toggle('submenu-open');
      });
    } else {
      row.addEventListener('click', e => { e.stopPropagation(); closeCtxMenu(); item.action(); });
    }
    return row;
  };

  items.forEach(item => {
    menu.appendChild(buildCtxRow(item));
  });
  _ctxAnchor = anchorEl;
  anchorEl.classList.add('open');
  menu.classList.add('open');
  requestAnimationFrame(() => {
    const r  = anchorEl.getBoundingClientRect();
    const mw = menu.offsetWidth  || 180;
    const mh = menu.offsetHeight || 160;
    let left = r.right - mw;
    let top  = r.bottom + 4;
    if (left < 8)                           left = r.left;
    if (top + mh > window.innerHeight - 8)  top  = r.top - mh - 4;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    menu.style.left = left + 'px';
    menu.style.top  = top  + 'px';
  });
  _ctxCloseHandler = e => { if (!menu.contains(e.target) && e.target !== anchorEl) closeCtxMenu(); };
  setTimeout(() => document.addEventListener('click', _ctxCloseHandler), 0);
}

function closeCtxMenu() {
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.classList.remove('open');
  if (_ctxAnchor) { _ctxAnchor.classList.remove('open'); _ctxAnchor = null; }
  if (_ctxCloseHandler) { document.removeEventListener('click', _ctxCloseHandler); _ctxCloseHandler = null; }
}

function makeSidebarNoteEl(note, { inFolder = false } = {}) {
  const active   = note.id === activeId;
  const isOwned  = isOwnedNote(note);
  const isPinned = isPinnedNote(note);
  const pinScope = pinScopeForNote(note);
  const canChoosePinScope = hasVisibleFolder(note);
  const pinMenu = canChoosePinScope
    ? {
        icon: 'fa-solid fa-thumbtack',
        label: 'Pin',
        children: [
          { icon: 'fa-solid fa-arrow-up', label: pinScope === 'major' ? 'Major Pin Active' : 'Major Pin', action: () => setNotePinned(note.id, true, 'major') },
          { icon: 'fa-solid fa-thumbtack', label: pinScope === 'minor' ? 'Minor Pin Active' : 'Minor Pin', action: () => setNotePinned(note.id, true, 'minor') },
          ...(isPinned ? ['sep', { icon: 'fa-solid fa-xmark', label: 'Unpin', action: () => setNotePinned(note.id, false) }] : [])
        ]
      }
    : {
        icon: 'fa-solid fa-thumbtack',
        label: isPinned ? 'Unpin from Sidebar' : 'Pin to Sidebar',
        action: () => setNotePinned(note.id, !isPinnedNote(note), 'major')
      };
  const showPreview = sidebarNotePreviewMode === 'title-text';
  const snippet  = showPreview ? (note.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 65) || 'Empty Note') : '';
  const accessAvatars = inFolder ? '' : renderAccessAvatars(accessProfilesForNote(note), isOwned ? 'Shared with' : 'Shared by');
  const noteFolder = note.folderId ? folders[note.folderId] : null;
  const noteFolderColor = noteFolder ? resolveFolderIconColor(noteFolder.iconColor, noteFolder.iconColorMode) : '';
  const el       = document.createElement('div');
  el.className   = 'sidebar-item' + (active ? ' active' : '') + (showPreview ? '' : ' titles-only');
  el.dataset.id  = note.id;
  el.draggable   = true;
  if (noteFolderColor) {
    el.classList.add('note-folder-border');
    el.style.setProperty('--note-folder-color', noteFolderColor);
  }
  el.innerHTML   =
    '<div class="item-info"><div class="item-name">' + esc(note.title) + '</div>' + (showPreview ? '<div class="item-preview">' + esc(snippet) + '</div>' : '') + '</div>' +
    accessAvatars +
    (isPinned ? '<span class="note-pin-badge" title="' + (pinScope === 'minor' ? 'Pinned in folder' : 'Pinned to sidebar') + '"><i class="fa-solid fa-thumbtack"></i></span>' : '') +
    (isOwned ? '' : '<span class="note-shared-badge" title="Shared with you"><i class="fa-solid fa-link"></i></span>') +
    '<button class="item-menu-btn" title="More Options"><i class="fa-solid fa-ellipsis"></i></button>';
  el.addEventListener('click', e => {
    if (!e.target.closest('.item-menu-btn')) openNote(note.id);
  });
  el.querySelector('.item-menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    const items = isOwned
      ? [
          pinMenu,
          { icon: 'fa-solid fa-arrow-up-from-bracket', label: 'Share',              action: () => openShareModal('note', note.id) },
          ...(inFolder ? [{ icon: 'fa-solid fa-folder-minus', label: 'Remove from Folder', action: () => moveNoteToFolder(note.id, null) }] : []),
          { icon: 'fa-solid fa-folder-open',            label: 'Move to Folder',    action: () => openMoveModal(note.id) },
          'sep',
          { icon: 'fa-solid fa-trash', label: 'Delete', danger: true,              action: () => deleteNote(note.id) }
        ]
      : [
          pinMenu,
          ...(inFolder ? [{ icon: 'fa-solid fa-folder-minus', label: 'Remove from Folder', action: () => moveNoteToFolder(note.id, null) }] : []),
          { icon: 'fa-solid fa-folder-open', label: 'Move to Folder', action: () => openMoveModal(note.id) },
          'sep',
          { icon: 'fa-solid fa-xmark', label: 'Remove from Library', danger: true, action: () => deleteNote(note.id) }
        ];
    openCtxMenu(e.currentTarget, items);
  });
  el.addEventListener('dragstart', e => {
    _draggingNoteId = note.id;
    e.dataTransfer.setData('text/plain', note.id);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    _draggingNoteId = null;
    document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
    document.querySelectorAll('.pin-drop-before,.pin-drop-after').forEach(d => d.classList.remove('pin-drop-before', 'pin-drop-after'));
    document.querySelectorAll('.folder-drop-before,.folder-drop-after').forEach(d => d.classList.remove('folder-drop-before', 'folder-drop-after'));
  });
  return el;
}

function noteBelongsToPinReorderGroup(note, group) {
  if (!note || !isPinnedNote(note)) return false;
  if (group === 'major') return isMajorPinnedNote(note);
  if (group?.startsWith('folder:')) {
    const folderId = group.slice('folder:'.length);
    return note.folderId === folderId && pinScopeForNote(note) === 'minor';
  }
  return false;
}

function pinReorderGroupNotes(group) {
  return Object.values(notes)
    .filter(note => noteBelongsToPinReorderGroup(note, group))
    .sort(compareNotes);
}

async function persistPinnedOrder(orderedNotes) {
  const base = Date.now();
  let cloudSynced = true;
  await Promise.all(orderedNotes.map(async (note, index) => {
    const pinnedAt = new Date(base - (index * 1000)).toISOString();
    const scope = pinScopeForNote(note) || 'major';
    note.pinnedAt = pinnedAt;
    note.pinScope = scope;
    if (isOwnedNote(note)) {
      await setDoc(doc(fsDb, 'notes', note.id), {
        pinnedAt: Timestamp.fromDate(new Date(pinnedAt)),
        pinScope: scope
      }, { merge: true });
    } else {
      const ok = await _setSharedNotePinned(note.id, pinnedAt, scope);
      if (!ok) cloudSynced = false;
    }
  }));
  renderSidebar();
  showToast(
    cloudSynced ? 'Pinned Notes Reordered' : 'Pinned notes reordered locally; cloud sync failed',
    cloudSynced ? 'success' : 'error'
  );
}

async function reorderPinnedNote(draggedId, targetId, position, group) {
  if (!draggedId || !targetId || draggedId === targetId) return;
  const dragged = notes[draggedId];
  const target = notes[targetId];
  if (!noteBelongsToPinReorderGroup(dragged, group) || !noteBelongsToPinReorderGroup(target, group)) return;
  const ordered = pinReorderGroupNotes(group);
  const withoutDragged = ordered.filter(note => note.id !== draggedId);
  const targetIndex = withoutDragged.findIndex(note => note.id === targetId);
  if (targetIndex < 0) return;
  withoutDragged.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, dragged);
  if (withoutDragged.every((note, index) => ordered[index]?.id === note.id)) return;
  try {
    await persistPinnedOrder(withoutDragged);
  } catch (err) {
    console.error('reorder pinned notes:', err);
    showToast('Could Not Reorder Pinned Notes', 'error');
    renderSidebar();
  }
}

function attachPinnedReorderHandlers(el, note, group) {
  if (!el || !noteBelongsToPinReorderGroup(note, group)) return;
  el.dataset.pinReorderGroup = group;
  el.addEventListener('dragover', e => {
    if (!_draggingNoteId || _draggingNoteId === note.id) return;
    if (!noteBelongsToPinReorderGroup(notes[_draggingNoteId], group)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = el.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    el.classList.toggle('pin-drop-before', before);
    el.classList.toggle('pin-drop-after', !before);
  });
  el.addEventListener('dragleave', e => {
    if (el.contains(e.relatedTarget)) return;
    el.classList.remove('pin-drop-before', 'pin-drop-after');
  });
  el.addEventListener('drop', e => {
    if (!_draggingNoteId || !noteBelongsToPinReorderGroup(notes[_draggingNoteId], group)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    el.classList.remove('pin-drop-before', 'pin-drop-after');
    reorderPinnedNote(e.dataTransfer.getData('text/plain') || _draggingNoteId, note.id, position, group);
  });
}

function attachFolderReorderHandlers(row, folder) {
  if (!row || !folder) return;
  row.draggable = true;
  row.addEventListener('dragstart', e => {
    if (e.target.closest('button')) {
      e.preventDefault();
      return;
    }
    _draggingFolderId = folder.id;
    e.dataTransfer.setData('application/x-notas-folder', folder.id);
    e.dataTransfer.setData('text/plain', folder.id);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => row.classList.add('folder-dragging'));
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('folder-dragging');
    _draggingFolderId = null;
    document.querySelectorAll('.folder-drop-before,.folder-drop-after').forEach(d => d.classList.remove('folder-drop-before', 'folder-drop-after'));
    document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
  });
}

const SIDEBAR_VIEWS = new Set(['notes', 'notifications', 'alarms', 'friends', 'trash']);

function updateRailActiveState() {
  document.querySelectorAll('[data-sidebar-view]').forEach(btn => {
    const active = btn.dataset.sidebarView === sidebarView;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setSidebarView(view) {
  sidebarView = SIDEBAR_VIEWS.has(view) ? view : 'notes';
  if (sidebarMinimized && !isMobile()) setSidebarMinimized(false);
  if (isMobile()) openDrawer();
  if (sidebarView !== 'trash' && activeId && isTrashedNote(notes[activeId])) {
    const ids = sortedIds();
    activeId = ids.length ? ids[0] : null;
    activeId ? openNote(activeId) : showEditorView(false);
  }
  renderSidebar();
}

function refreshOpenSidebarPage(view) {
  if (sidebarView === view) renderSidebarPage(view);
}

function renderSidebarPage(view) {
  const list = document.getElementById('sidebar-list');
  const sidebar = document.getElementById('sidebar');
  if (!list) return;
  sidebar?.classList.add('sidebar-page-mode');
  updateRailActiveState();

  const meta = {
    create:        { icon: 'fa-solid fa-plus',       label: 'Create' },
    notifications: { icon: 'fa-solid fa-bell',       label: 'Notifications' },
    alarms:        { icon: 'fa-solid fa-clock',      label: 'Reminders' },
    friends:       { icon: 'fa-solid fa-user-group', label: 'Friends' },
    trash:         { icon: 'fa-solid fa-trash',      label: 'Trash' }
  }[view] || { icon: 'fa-solid fa-note-sticky', label: 'Notes' };

  list.innerHTML =
    '<div class="sidebar-page">' +
      '<div class="sidebar-page-header">' +
        '<div class="sidebar-page-title"><i class="' + meta.icon + '"></i><span>' + meta.label + '</span></div>' +
      '</div>' +
      '<div class="sidebar-page-content" id="sidebar-page-content"></div>' +
    '</div>';

  const content = document.getElementById('sidebar-page-content');
  if (!content) return;

  if (view === 'notifications') {
    content.innerHTML =
      '<div class="notifications-list" id="sidebar-notifications-list"></div>' +
      '<button class="sidebar-page-action" id="sidebar-notifications-mark-read" type="button"><i class="fa-solid fa-check-double"></i><span>Mark All Read</span></button>';
    renderNotificationsList(document.getElementById('sidebar-notifications-list'));
    document.getElementById('sidebar-notifications-mark-read')?.addEventListener('click', markAllNotificationsRead);
    return;
  }

  if (view === 'alarms') {
    content.innerHTML = '<div class="notifications-list" id="sidebar-alarms-list"></div>';
    renderAlarmsList(document.getElementById('sidebar-alarms-list'));
    return;
  }

  if (view === 'friends') {
    content.innerHTML =
      '<div class="profile-connect-row">' +
        '<input class="modal-input" id="sidebar-connect-profile-email-input" type="email" placeholder="Friend Google Email" autocomplete="email" />' +
        '<button class="modal-btn primary" id="sidebar-connect-profile-btn" type="button">Add</button>' +
      '</div>' +
      '<div class="profile-link-requests" id="sidebar-profile-link-requests-panel" hidden>' +
        '<div class="share-section-title"><i class="fa-solid fa-user-check"></i><span>Friend Requests</span></div>' +
        '<div class="profile-list" id="sidebar-profile-link-requests-list"></div>' +
      '</div>' +
      '<div class="share-section-title"><i class="fa-solid fa-user-group"></i><span>Friends</span></div>' +
      '<div class="profile-list" id="sidebar-linked-profiles-list"></div>';
    renderProfileConnectionUI({
      inputId: 'sidebar-connect-profile-email-input',
      listId: 'sidebar-linked-profiles-list',
      requestsPanelId: 'sidebar-profile-link-requests-panel',
      requestsListId: 'sidebar-profile-link-requests-list'
    });
    document.getElementById('sidebar-connect-profile-btn')?.addEventListener('click', () => connectProfileByEmail('sidebar-connect-profile-email-input'));
    document.getElementById('sidebar-connect-profile-email-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') connectProfileByEmail('sidebar-connect-profile-email-input');
    });
    return;
  }

  if (view === 'trash') {
    const trashIds = trashSortedIds();
    content.innerHTML = trashIds.length
      ? '<div class="trash-list" id="sidebar-trash-list"></div>'
      : '<div class="sidebar-page-empty">Deleted notes stay here for 30 days.</div>';
    const trashList = document.getElementById('sidebar-trash-list');
    if (!trashList) return;
    trashList.innerHTML = trashIds.map(id => {
      const note = notes[id];
      const days = trashDaysRemaining(note);
      const sub = days > 1 ? 'Deletes in ' + days + ' days' : days === 1 ? 'Deletes tomorrow' : 'Deletes soon';
      return '<div class="trash-row" data-trash-note-id="' + esc(id) + '">' +
        '<button class="trash-main" data-open-trash-note="' + esc(id) + '" type="button">' +
          '<div class="trash-title">' + esc(note.title || 'Untitled Note') + '</div>' +
          '<div class="trash-sub">' + esc(sub) + '</div>' +
        '</button>' +
        '<div class="trash-actions">' +
          '<button class="trash-action-btn" data-restore-note="' + esc(id) + '" type="button" title="Restore" aria-label="Restore"><i class="fa-solid fa-rotate-left"></i></button>' +
          '<button class="trash-action-btn danger" data-delete-trash-note="' + esc(id) + '" type="button" title="Delete Forever" aria-label="Delete Forever"><i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
      '</div>';
    }).join('');
    trashList.querySelectorAll('[data-open-trash-note]').forEach(btn => {
      btn.addEventListener('click', () => openNote(btn.dataset.openTrashNote));
    });
    trashList.querySelectorAll('[data-restore-note]').forEach(btn => {
      btn.addEventListener('click', () => restoreTrashedNote(btn.dataset.restoreNote));
    });
    trashList.querySelectorAll('[data-delete-trash-note]').forEach(btn => {
      btn.addEventListener('click', () => openDeleteModal('trash-note', btn.dataset.deleteTrashNote));
    });
  }
}

function renderSidebar(filter) {
  if (typeof filter === 'string') sidebarFilter = filter;
  else {
    const searchInput = document.getElementById('search-input');
    sidebarFilter = searchInput ? searchInput.value : sidebarFilter;
  }
  filter = (sidebarFilter || '').toLowerCase();
  const list = document.getElementById('sidebar-list');
  const sidebar = document.getElementById('sidebar');
  if (sidebarView !== 'notes') {
    renderSidebarPage(sidebarView);
    renderNotificationButton();
    renderAlarmButton();
    return;
  }
  sidebar?.classList.remove('sidebar-page-mode');
  updateRailActiveState();
  list.innerHTML = '';

  const sortedFolderList = sortedFolders();

  const filteredNotes = sortedIds().map(id => notes[id])
    .filter(n => !filter || noteMatchesFilter(n, filter));
  const pinnedLooseNotes = filteredNotes.filter(n => isMajorPinnedNote(n));
  const looseNotes = filteredNotes.filter(n => !hasVisibleFolder(n) && !isMajorPinnedNote(n));
  const uncategorized = looseNotes.filter(n => !isPinnedNote(n) && isOwnedNote(n));
  const sharedUncategorized = looseNotes.filter(n => !isPinnedNote(n) && !isOwnedNote(n));

  let hasContent = false;

  if (pinnedLooseNotes.length) {
    hasContent = true;
    const pinnedWrap = document.createElement('div');
    pinnedWrap.className = 'pinned-notes-section';
    const lbl = document.createElement('div');
    lbl.className = 'sidebar-section-label';
    lbl.textContent = 'Pinned';
    pinnedWrap.appendChild(lbl);
    pinnedLooseNotes.forEach(note => {
      const el = makeSidebarNoteEl(note);
      attachPinnedReorderHandlers(el, note, 'major');
      pinnedWrap.appendChild(el);
    });
    list.appendChild(pinnedWrap);
  }

  sortedFolderList.forEach(folder => {
    const folderNotes = sortedIds().map(id => notes[id])
      .filter(n => n.folderId === folder.id)
      .filter(n => !isMajorPinnedNote(n))
      .filter(n => !filter || noteMatchesFilter(n, filter));
    if (filter && !folder.title.toLowerCase().includes(filter) && !folderNotes.length) return;
    hasContent = true;

    const isExpanded = expandedFolders.has(folder.id);
    const folderEl   = document.createElement('div');
    folderEl.className = 'folder-item';

    const folderAccessProfiles = accessProfilesForFolder(folder);
    const sharedBadge = folder.public || folder.shared || folderAccessProfiles.length
      ? '<span class="folder-shared-badge" title="Shared"><i class="fa-solid fa-link"></i></span>'
      : '';
    const folderAccessAvatars = renderAccessAvatars(folderAccessProfiles, isOwnedFolder(folder) ? 'Folder shared with' : 'Shared by');
    const folderColor = resolveFolderIconColor(folder.iconColor, folder.iconColorMode);
    const toggleLabel = isExpanded ? 'Collapse Folder' : 'Expand Folder';
    folderEl.innerHTML =
      '<div class="folder-row" data-fid="' + folder.id + '" style="--folder-color:' + esc(folderColor) + ';">' +
        '<button class="folder-toggle-btn" type="button" title="' + toggleLabel + '" aria-label="' + toggleLabel + '">' +
          '<span class="folder-chevron' + (isExpanded ? ' expanded' : '') + '"><i class="fa-solid fa-chevron-right"></i></span>' +
          '<span class="item-icon folder-icon"><i class="fa-solid fa-folder' + (isExpanded ? '-open' : '') + '"></i></span>' +
        '</button>' +
        '<div class="item-info"><div class="item-name">' + esc(folder.title) + '</div></div>' +
        folderAccessAvatars +
        sharedBadge +
        '<button class="item-menu-btn" title="More Options"><i class="fa-solid fa-ellipsis"></i></button>' +
      '</div>';

    const row = folderEl.querySelector('.folder-row');
    attachFolderReorderHandlers(row, folder);
    const notesWrap = document.createElement('div');
    notesWrap.className = 'folder-notes' + (isExpanded ? ' expanded' : '');
    const notesInner = document.createElement('div');
    notesInner.className = 'folder-notes-inner';
    if (folderNotes.length) {
      folderNotes.forEach(n => {
        const el = makeSidebarNoteEl(n, { inFolder: true });
        el.classList.add('folder-note-item');
        if (isPinnedNote(n) && pinScopeForNote(n) === 'minor') {
          attachPinnedReorderHandlers(el, n, 'folder:' + folder.id);
        }
        notesInner.appendChild(el);
      });
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:7px 8px 7px 28px;color:var(--muted);font-size:11.5px;font-style:italic;';
      empty.textContent = 'No notes - click + to add one';
      notesInner.appendChild(empty);
    }
    notesWrap.appendChild(notesInner);
    folderEl.appendChild(notesWrap);

    row.addEventListener('click', e => {
      if (e.target.closest('.item-menu-btn')) return;
      const nextExpanded = !expandedFolders.has(folder.id);
      if (nextExpanded) expandedFolders.add(folder.id);
      else expandedFolders.delete(folder.id);
      row.querySelector('.folder-chevron')?.classList.toggle('expanded', nextExpanded);
      const folderIcon = row.querySelector('.folder-icon i');
      if (folderIcon) folderIcon.className = 'fa-solid fa-folder' + (nextExpanded ? '-open' : '');
      const toggleBtn = row.querySelector('.folder-toggle-btn');
      if (toggleBtn) {
        const label = nextExpanded ? 'Collapse Folder' : 'Expand Folder';
        toggleBtn.title = label;
        toggleBtn.setAttribute('aria-label', label);
      }
      notesWrap.classList.toggle('expanded', nextExpanded);
    });
    row.addEventListener('dragover', e => {
      if (_draggingFolderId) {
        if (_draggingFolderId === folder.id) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        row.classList.toggle('folder-drop-before', before);
        row.classList.toggle('folder-drop-after', !before);
        return;
      }
      if (!_draggingNoteId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', e => {
      if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over', 'folder-drop-before', 'folder-drop-after');
    });
    row.addEventListener('drop', e => {
      if (_draggingFolderId) {
        e.preventDefault();
        e.stopPropagation();
        const rect = row.getBoundingClientRect();
        const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        row.classList.remove('folder-drop-before', 'folder-drop-after');
        reorderFolder(e.dataTransfer.getData('application/x-notas-folder') || _draggingFolderId, folder.id, position);
        return;
      }
      e.preventDefault();
      row.classList.remove('drag-over');
      const noteId = e.dataTransfer.getData('text/plain');
      if (noteId && notes[noteId]) moveNoteToFolder(noteId, folder.id);
    });
    row.querySelector('.item-menu-btn').addEventListener('click', e => {
      e.stopPropagation();
      const colourItem = {
        icon: 'fa-solid fa-palette',
        label: 'Folder Colour',
        action: () => openFolderColorPicker(folder.id)
      };
      const folderItems = isOwnedFolder(folder)
        ? [
            { icon: 'fa-solid fa-plus',                  label: 'New Note in Folder', action: () => { activeFolderId = folder.id; expandedFolders.add(folder.id); openModal(); } },
            { icon: 'fa-solid fa-pen',                   label: 'Rename Folder',      action: () => openFolderRenameModal(folder.id) },
            { icon: 'fa-solid fa-arrow-up-from-bracket', label: 'Share Folder',       action: () => openShareModal('folder', folder.id) },
            colourItem,
            'sep',
            { icon: 'fa-solid fa-trash', label: 'Delete Folder', danger: true,        action: () => deleteFolder(folder.id) }
          ]
        : [
            colourItem,
            'sep',
            { icon: 'fa-solid fa-xmark', label: 'Remove from Library', danger: true,  action: () => deleteFolder(folder.id) }
          ];
      openCtxMenu(e.currentTarget, folderItems);
    });
    list.appendChild(folderEl);
  });

  const appendLooseSection = (sectionNotes, label, showLabel) => {
    hasContent = true;
    const uncatWrap = document.createElement('div');
    uncatWrap.className = 'uncat-drop-zone';
    if (showLabel) {
      const lbl = document.createElement('div');
      lbl.className = 'sidebar-section-label';
      lbl.style.marginTop = '10px';
      lbl.textContent = label;
      uncatWrap.appendChild(lbl);
    }
    uncatWrap.addEventListener('dragover', e => {
      if (!_draggingNoteId || !notes[_draggingNoteId]?.folderId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      uncatWrap.classList.add('drag-over');
    });
    uncatWrap.addEventListener('dragleave', e => {
      if (!uncatWrap.contains(e.relatedTarget)) uncatWrap.classList.remove('drag-over');
    });
    uncatWrap.addEventListener('drop', e => {
      e.preventDefault();
      uncatWrap.classList.remove('drag-over');
      const noteId = e.dataTransfer.getData('text/plain');
      if (noteId && notes[noteId] && notes[noteId].folderId) moveNoteToFolder(noteId, null);
    });
    sectionNotes.forEach(note => uncatWrap.appendChild(makeSidebarNoteEl(note)));
    list.appendChild(uncatWrap);
  };

  if (uncategorized.length) {
    appendLooseSection(uncategorized, 'Notes', sortedFolderList.length || sharedUncategorized.length);
  }

  if (sharedUncategorized.length) {
    appendLooseSection(sharedUncategorized, 'Shared With Me', true);
  }

  if (!hasContent) {
    list.innerHTML = '<div style="padding:20px;color:var(--muted);font-size:12.5px;text-align:center;">' +
      (filter ? 'No Matching Notes' : 'No Notes Yet') + '</div>';
  }
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
}
function updateMobileSidebarToggleLabel(open) {
  const drawerBtn = document.getElementById('drawer-btn');
  const mobileLogoBtn = document.getElementById('mob-logo-btn');
  if (drawerBtn) {
    drawerBtn.title = open ? 'Close Sidebar' : 'Open Sidebar';
    drawerBtn.setAttribute('aria-label', open ? 'Close Sidebar' : 'Open Sidebar');
    const icon = drawerBtn.querySelector('i');
    if (icon) icon.className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
  }
  if (mobileLogoBtn) {
    mobileLogoBtn.title = open ? 'Close Sidebar' : 'Open Sidebar';
    mobileLogoBtn.setAttribute('aria-label', open ? 'Close Sidebar' : 'Open Sidebar');
  }
}

function openDrawer() {
  document.getElementById('app-rail').classList.add('open');
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  updateMobileSidebarToggleLabel(true);
}

function closeDrawer() {
  document.getElementById('app-rail').classList.remove('open');
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  updateMobileSidebarToggleLabel(false);
}

function toggleDrawer() {
  document.getElementById('sidebar').classList.contains('open') ? closeDrawer() : openDrawer();
}

function toggleSidebarFromLogo(e) {
  e?.stopPropagation?.();
  if (isMobile()) { toggleDrawer(); return; }
  setSidebarMinimized(!sidebarMinimized);
}

/* Modal */
let createModalType = 'note';
function normalizeCreateModalType(type) {
  return type === 'folder' ? 'folder' : 'note';
}
function setCreateModalType(type) {
  createModalType = normalizeCreateModalType(type);
  const isFolder = createModalType === 'folder';
  const title = document.getElementById('modal-title');
  const input = document.getElementById('modal-input');
  const createBtn = document.getElementById('modal-create');
  if (title) title.textContent = isFolder ? 'New Folder' : 'New Note';
  if (input) input.placeholder = isFolder ? 'Folder Name' : 'Note Name';
  if (createBtn) createBtn.textContent = isFolder ? 'Create Folder' : 'Create Note';
  document.querySelectorAll('[data-create-type]').forEach(btn => {
    const active = btn.dataset.createType === createModalType;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
function openModal(type = 'note') {
  if (type && typeof type === 'object') type = 'note';
  setCreateModalType(type);
  document.getElementById('modal').classList.add('open');
  document.getElementById('modal-input').value = '';
  setTimeout(() => document.getElementById('modal-input').focus(), 120);
}
const closeModal = () => document.getElementById('modal').classList.remove('open');
function confirmCreate() {
  const t = document.getElementById('modal-input').value.trim();
  if (!t) { document.getElementById('modal-input').focus(); return; }
  const type = createModalType;
  const fid = activeFolderId;
  closeModal();
  if (type === 'folder') {
    createFolder(t);
    return;
  }
  createNote(t, fid);
}

/* Folder Modal */
const openFolderModal = () => openModal('folder');
function openFolderRenameModal(folderId) {
  const folder = folders[folderId];
  if (!folder || !isOwnedFolder(folder)) return;
  _folderModalMode = 'rename';
  _folderRenameId = folderId;
  const title = document.querySelector('#folder-modal .modal-title');
  const input = document.getElementById('folder-modal-input');
  const createBtn = document.getElementById('folder-modal-create');
  if (title) title.innerHTML = '<i class="fa-solid fa-pen" style="margin-right:8px;opacity:.7;"></i>Rename Folder';
  if (input) {
    input.placeholder = 'Folder Name';
    input.value = folder.title || '';
  }
  if (createBtn) createBtn.textContent = 'Rename Folder';
  document.getElementById('folder-modal').classList.add('open');
  setTimeout(() => {
    input?.focus();
    input?.select();
  }, 120);
};
const closeFolderModal = () => {
  document.getElementById('folder-modal').classList.remove('open');
  _folderModalMode = 'create';
  _folderRenameId = null;
};
function confirmCreateFolder() {
  const t = document.getElementById('folder-modal-input').value.trim();
  if (!t) { document.getElementById('folder-modal-input').focus(); return; }
  if (_folderModalMode === 'rename' && _folderRenameId) {
    const folderId = _folderRenameId;
    closeFolderModal();
    renameFolder(folderId, t);
    return;
  }
  closeFolderModal();
  createFolder(t);
}

/* Settings */
const FONT_MIN = 12, FONT_MAX = 24;
let editorFontSize = parseInt(localStorage.getItem('notas_font_size') || '15');
const SIDEBAR_NOTE_PREVIEW_STORAGE_KEY = 'notas_sidebar_note_preview_mode';
const savedSidebarNotePreviewMode = localStorage.getItem(SIDEBAR_NOTE_PREVIEW_STORAGE_KEY);
let sidebarNotePreviewMode = savedSidebarNotePreviewMode === 'title-only' ? 'title-only' : 'title-text';
const savedThemeMode = localStorage.getItem('notas_theme');
let themeMode = ['system', 'dark', 'light'].includes(savedThemeMode) ? savedThemeMode : 'dark';
let isLightMode = false;
const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

const ACCENT_PALETTES = {
  blue:   { r:0,   g:180, b:255, r2:0,   g2:80,  b2:180, accent:'#00b4ff', accentH:'#40d0ff',
            muted:'#4a6a8a', text2:'#b8cce8', border:'#1a2e48',
            lightMuted:'#2a6090', lightText2:'#1a3050', lightBorder:'#78a8cc' },
  purple: { r:130, g:70,  b:255, r2:70,  g2:20,  b2:180, accent:'#8246ff', accentH:'#b080ff',
            muted:'#5a4a88', text2:'#c8b8e8', border:'#221848',
            lightMuted:'#5a3090', lightText2:'#3a1870', lightBorder:'#9870c8' },
  green:  { r:0,   g:210, b:120, r2:0,   g2:110, b2:60,  accent:'#00d278', accentH:'#30f09a',
            muted:'#3a6a58', text2:'#b8e4d0', border:'#182e22',
            lightMuted:'#2a7050', lightText2:'#184030', lightBorder:'#60b888' },
  rose:   { r:255, g:55,  b:110, r2:180, g2:15,  b2:60,  accent:'#ff3770', accentH:'#ff7aa0',
            muted:'#7a4a5a', text2:'#e8b8c8', border:'#381828',
            lightMuted:'#903060', lightText2:'#601838', lightBorder:'#cc7890' },
  amber:  { r:255, g:160, b:0,   r2:180, g2:80,  b2:0,   accent:'#ffa000', accentH:'#ffbf40',
            muted:'#7a6040', text2:'#e8d8b8', border:'#382818',
            lightMuted:'#906028', lightText2:'#603010', lightBorder:'#c8a048' },
  teal:   { r:0,   g:195, b:175, r2:0,   g2:95,  b2:115, accent:'#00c3af', accentH:'#30e3cf',
            muted:'#3a6868', text2:'#b8e4e0', border:'#183030',
            lightMuted:'#2a7070', lightText2:'#184040', lightBorder:'#60b4b0' },
};
const DEFAULT_ACCENT = ACCENT_PALETTES.blue.accent;
let accentColor = localStorage.getItem('notas_accent') || DEFAULT_ACCENT;

function clampColor(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => clampColor(v).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!match) return null;
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

function mixColor(a, b, weight) {
  return {
    r: a.r + (b.r - a.r) * weight,
    g: a.g + (b.g - a.g) * weight,
    b: a.b + (b.b - a.b) * weight
  };
}

function relativeLuminance({ r, g, b }) {
  const linear = [r, g, b].map(value => {
    const channel = clampColor(value) / 255;
    return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + .05) / (darker + .05);
}

function accentTextColor(palette) {
  const accent = { r: palette.r, g: palette.g, b: palette.b };
  const accentH = hexToRgb(palette.accentH) || accent;
  const lightText = { r: 255, g: 255, b: 255 };
  const darkText = { r: 4, g: 18, b: 28 };
  const lightScore = Math.min(contrastRatio(accent, lightText), contrastRatio(accentH, lightText));
  const darkScore = Math.min(contrastRatio(accent, darkText), contrastRatio(accentH, darkText));
  return darkScore >= lightScore ? '#04121c' : '#ffffff';
}

function rgbToHsv({ r, g, b }) {
  r = clampColor(r) / 255;
  g = clampColor(g) / 255;
  b = clampColor(b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max ? delta / max : 0, v: max };
}

function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb = [0, 0, 0];

  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255
  };
}

function normalizeAccentColor(value) {
  if (ACCENT_PALETTES[value]) return ACCENT_PALETTES[value].accent;
  return /^#[a-f\d]{6}$/i.test(value || '') ? value : DEFAULT_ACCENT;
}

function normalizeManualFolderIconColor(value) {
  return /^#[a-f\d]{6}$/i.test(value || '') ? value.toLowerCase() : '';
}

function isLegacyThemeFolderColor(value) {
  const normalized = normalizeManualFolderIconColor(value);
  if (!normalized) return false;
  return Object.values(ACCENT_PALETTES).some(p => p.accent.toLowerCase() === normalized);
}

function normalizeFolderIconColor(value, mode = '') {
  if (mode === 'theme' || value === FOLDER_ICON_THEME || value === 'app-theme' || value === 'auto') return FOLDER_ICON_THEME;
  const manual = normalizeManualFolderIconColor(value);
  if (!manual) return '';
  if (mode === 'manual') return manual;
  return isLegacyThemeFolderColor(manual) ? FOLDER_ICON_THEME : manual;
}

function resolveFolderIconColor(value, mode = '') {
  const normalized = normalizeFolderIconColor(value, mode) || DEFAULT_FOLDER_ICON_COLOR;
  return normalized === FOLDER_ICON_THEME ? 'var(--accent)' : normalized;
}

let folderPickerHsv = rgbToHsv(hexToRgb(DEFAULT_FOLDER_ICON_COLOR) || hexToRgb(DEFAULT_ACCENT));
let _folderColorPickerFolderId = null;
let _folderColorPickerValue = DEFAULT_FOLDER_ICON_COLOR;

function openFolderColorPicker(folderId) {
  const folder = folders[folderId];
  const modal = document.getElementById('folder-color-modal');
  if (!folder || !modal) return;
  const normalized = normalizeFolderIconColor(folder.iconColor, folder.iconColorMode) || DEFAULT_FOLDER_ICON_COLOR;
  const initialColor = normalized === FOLDER_ICON_THEME ? normalizeAccentColor(accentColor) : normalized;
  _folderColorPickerFolderId = folderId;
  _folderColorPickerValue = normalized;
  folderPickerHsv = rgbToHsv(hexToRgb(initialColor) || hexToRgb(DEFAULT_ACCENT));
  const title = document.getElementById('folder-color-title');
  if (title) title.textContent = folder.title || 'Folder';
  updateFolderColorPickerUI();
  modal.classList.add('open');
}

function closeFolderColorPicker() {
  document.getElementById('folder-color-modal')?.classList.remove('open');
  _folderColorPickerFolderId = null;
  _folderColorPickerValue = DEFAULT_FOLDER_ICON_COLOR;
}

function folderColorFromPickerHsv() {
  return rgbToHex(hsvToRgb(folderPickerHsv));
}

function updateFolderColorPickerUI() {
  const activeValue = _folderColorPickerValue === FOLDER_ICON_THEME ? normalizeAccentColor(accentColor) : _folderColorPickerValue;
  const rgb = hexToRgb(normalizeManualFolderIconColor(activeValue) || normalizeAccentColor(accentColor)) || hexToRgb(DEFAULT_ACCENT);
  folderPickerHsv = rgbToHsv(rgb);

  const panel = document.getElementById('folder-color-picker-panel');
  const sv = document.getElementById('folder-color-sv');
  const cursor = document.getElementById('folder-color-sv-cursor');
  const hue = document.getElementById('folder-color-hue');
  const rInput = document.getElementById('folder-color-r');
  const gInput = document.getElementById('folder-color-g');
  const bInput = document.getElementById('folder-color-b');
  const preview = document.getElementById('folder-color-preview');

  [panel, sv].forEach(el => el?.style.setProperty('--picker-hue', Math.round(folderPickerHsv.h)));
  if (cursor) {
    cursor.style.left = `${folderPickerHsv.s * 100}%`;
    cursor.style.top = `${(1 - folderPickerHsv.v) * 100}%`;
  }
  if (hue) hue.value = Math.round(folderPickerHsv.h);
  if (rInput) rInput.value = clampColor(rgb.r);
  if (gInput) gInput.value = clampColor(rgb.g);
  if (bInput) bInput.value = clampColor(rgb.b);
  if (preview) preview.style.background = _folderColorPickerValue === FOLDER_ICON_THEME ? 'var(--accent)' : rgbToHex(rgb);

  document.querySelectorAll('[data-folder-color-value]').forEach(btn => {
    const value = btn.dataset.folderColorValue;
    btn.classList.toggle('active', value === _folderColorPickerValue);
  });
}

function setFolderPickerManualColor(hex) {
  const manual = normalizeManualFolderIconColor(hex);
  if (!manual) return;
  _folderColorPickerValue = manual;
  folderPickerHsv = rgbToHsv(hexToRgb(manual));
  updateFolderColorPickerUI();
}

function setFolderPickerFromRgbInputs() {
  const r = document.getElementById('folder-color-r');
  const g = document.getElementById('folder-color-g');
  const b = document.getElementById('folder-color-b');
  if (!r || !g || !b) return;
  setFolderPickerManualColor(rgbToHex({
    r: clampColor(Number(r.value)),
    g: clampColor(Number(g.value)),
    b: clampColor(Number(b.value))
  }));
}

function saveFolderColorPicker() {
  const folderId = _folderColorPickerFolderId;
  const value = _folderColorPickerValue;
  closeFolderColorPicker();
  if (folderId) setFolderIconColor(folderId, value);
}

function accentPalette(value) {
  if (ACCENT_PALETTES[value]) return ACCENT_PALETTES[value];
  const rgb = hexToRgb(normalizeAccentColor(value)) || hexToRgb(DEFAULT_ACCENT);
  const deep = mixColor(rgb, { r: 0, g: 0, b: 0 }, .48);
  return {
    r: rgb.r, g: rgb.g, b: rgb.b,
    r2: clampColor(deep.r), g2: clampColor(deep.g), b2: clampColor(deep.b),
    accent: rgbToHex(rgb),
    accentH: rgbToHex(mixColor(rgb, { r: 255, g: 255, b: 255 }, .28)),
    muted: rgbToHex(mixColor(rgb, { r: 74, g: 86, b: 104 }, .68)),
    text2: rgbToHex(mixColor(rgb, { r: 232, g: 240, b: 255 }, .72)),
    border: rgbToHex(mixColor(rgb, { r: 18, g: 28, b: 44 }, .82)),
    lightMuted: rgbToHex(mixColor(rgb, { r: 32, g: 68, b: 92 }, .62)),
    lightText2: rgbToHex(mixColor(rgb, { r: 12, g: 28, b: 44 }, .7)),
    lightBorder: rgbToHex(mixColor(rgb, { r: 160, g: 190, b: 215 }, .58))
  };
}

function brightenDarkUiColor(hex, weight) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(mixColor(rgb, { r: 255, g: 255, b: 255 }, weight));
}

function applyAccentColor(value) {
  const normalized = normalizeAccentColor(value);
  const p = accentPalette(normalized);
  const s = document.documentElement.style; // <html>
  const b = document.body.style;            // <body>

  // Orb/ambient/glass on <html> — cascade correctly in both modes
  s.setProperty('--orb-r',    p.r);
  s.setProperty('--orb-g',    p.g);
  s.setProperty('--orb-b',    p.b);
  s.setProperty('--orb2-r',   p.r2);
  s.setProperty('--orb2-g',   p.g2);
  s.setProperty('--orb2-b',   p.b2);
  s.setProperty('--glass-border',    `rgba(${Math.min(p.r+80,255)},${Math.min(p.g+30,255)},${Math.min(p.b+10,255)},.16)`);
  s.setProperty('--glass-highlight', `rgba(${Math.min(p.r+80,255)},${Math.min(p.g+30,255)},${Math.min(p.b+10,255)},.12)`);

  // Accent on both <html> and <body> — body inline style beats body.light-mode CSS rule
  s.setProperty('--accent',   p.accent);
  s.setProperty('--accent-h', p.accentH);
  s.setProperty('--accent-text', accentTextColor(p));
  b.setProperty('--accent',   p.accent);
  b.setProperty('--accent-h', p.accentH);
  b.setProperty('--accent-text', accentTextColor(p));

  // Mode-dependent vars — set on <body> so they override body.light-mode CSS in both modes
  const lm = isLightMode;
  b.setProperty('--muted',  lm ? p.lightMuted  : brightenDarkUiColor(p.muted, .16));
  b.setProperty('--text2',  lm ? p.lightText2  : brightenDarkUiColor(p.text2, .08));
  b.setProperty('--border', lm ? p.lightBorder : brightenDarkUiColor(p.border, .18));
  b.setProperty('--note-subtext', lm ? 'rgba(12, 28, 44, .68)' : 'rgba(232, 240, 255, .78)');
  // Ambient glows adapt in both modes
  b.setProperty('--ambient-a', `rgba(${p.r},${p.g},${p.b},${lm ? '.14' : '.18'})`);
  b.setProperty('--ambient-b', `rgba(${p.r2},${p.g2},${p.b2},.12)`);
  b.setProperty('--ambient-c', `rgba(${Math.min(p.r+90,255)},${Math.min(p.g+30,255)},${Math.min(p.b+10,255)},${lm ? '.1' : '.08'})`);

  updateColorPickerUI(normalized);
}

function setAccentColor(value) {
  accentColor = normalizeAccentColor(value);
  localStorage.setItem('notas_accent', accentColor);
  applyAccentColor(accentColor);
}

let pickerHsv = rgbToHsv(hexToRgb(normalizeAccentColor(accentColor)) || hexToRgb(DEFAULT_ACCENT));

function updateColorPickerUI(value = accentColor) {
  const rgb = hexToRgb(normalizeAccentColor(value)) || hexToRgb(DEFAULT_ACCENT);
  pickerHsv = rgbToHsv(rgb);

  const popover = document.getElementById('color-popover');
  const sv = document.getElementById('color-sv');
  const cursor = document.getElementById('color-sv-cursor');
  const hue = document.getElementById('color-hue');
  const rInput = document.getElementById('color-r');
  const gInput = document.getElementById('color-g');
  const bInput = document.getElementById('color-b');

  if (popover) popover.style.setProperty('--picker-hue', Math.round(pickerHsv.h));
  if (sv) sv.style.setProperty('--picker-hue', Math.round(pickerHsv.h));
  if (cursor) {
    cursor.style.left = `${pickerHsv.s * 100}%`;
    cursor.style.top = `${(1 - pickerHsv.v) * 100}%`;
  }
  if (hue) hue.value = Math.round(pickerHsv.h);
  if (rInput) rInput.value = clampColor(rgb.r);
  if (gInput) gInput.value = clampColor(rgb.g);
  if (bInput) bInput.value = clampColor(rgb.b);
}

function colorFromPickerHsv() {
  return rgbToHex(hsvToRgb(pickerHsv));
}

function setPickerFromRgbInputs() {
  const r = document.getElementById('color-r');
  const g = document.getElementById('color-g');
  const b = document.getElementById('color-b');
  if (!r || !g || !b) return;
  setAccentColor(rgbToHex({
    r: clampColor(Number(r.value)),
    g: clampColor(Number(g.value)),
    b: clampColor(Number(b.value))
  }));
}

function resolveLightMode() {
  return themeMode === 'system' ? !!systemThemeQuery?.matches : themeMode === 'light';
}

function applyTheme() {
  isLightMode = resolveLightMode();
  document.body.classList.toggle('light-mode', isLightMode);
  applyAccentColor(accentColor);
}

function applyFontSize() {
  document.documentElement.style.setProperty('--editor-font-size', editorFontSize + 'px');
  const val = document.getElementById('fs-val');
  if (val) val.textContent = editorFontSize;
}

function applySidebarNotePreviewMode() {
  const toggle = document.getElementById('sidebar-preview-toggle');
  if (toggle) toggle.checked = sidebarNotePreviewMode === 'title-text';
  if (sidebarView === 'notes') renderSidebar();
}

function initSettings() {
  applyTheme(); // also calls applyAccentColor
  applyFontSize();
  applySidebarNotePreviewMode();
  const settingsModal = document.getElementById('settings-modal');
  const colorControl = document.getElementById('color-control');
  const pickerBtn = document.getElementById('accent-picker-btn');
  const colorPopover = document.getElementById('color-popover');
  const colorSv = document.getElementById('color-sv');
  const colorHue = document.getElementById('color-hue');
  const colorInputs = ['color-r', 'color-g', 'color-b'].map(id => document.getElementById(id)).filter(Boolean);

  function closeColorPopover() {
    if (!colorPopover) return;
    colorPopover.hidden = true;
    pickerBtn?.setAttribute('aria-expanded', 'false');
  }

  function updateFromSaturationValueEvent(e) {
    if (!colorSv) return;
    const rect = colorSv.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    pickerHsv.s = rect.width ? x / rect.width : 0;
    pickerHsv.v = rect.height ? 1 - (y / rect.height) : 0;
    setAccentColor(colorFromPickerHsv());
  }

  document.getElementById('profile-settings-btn').addEventListener('click', () => {
    if (isMobile()) closeDrawer();
    document.getElementById('theme-select').value = themeMode;
    const sidebarPreviewToggle = document.getElementById('sidebar-preview-toggle');
    if (sidebarPreviewToggle) sidebarPreviewToggle.checked = sidebarNotePreviewMode === 'title-text';
    updateColorPickerUI(accentColor);
    settingsModal.classList.add('open');
  });
  settingsModal.addEventListener('click', e => {
    if (e.target === e.currentTarget) {
      closeColorPopover();
      settingsModal.classList.remove('open');
    }
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    closeColorPopover();
    settingsModal.classList.remove('open');
  });
  document.getElementById('theme-select').addEventListener('change', e => {
    themeMode = e.target.value;
    localStorage.setItem('notas_theme', themeMode);
    applyTheme();
  });
  document.getElementById('sidebar-preview-toggle')?.addEventListener('change', e => {
    sidebarNotePreviewMode = e.target.checked ? 'title-text' : 'title-only';
    localStorage.setItem(SIDEBAR_NOTE_PREVIEW_STORAGE_KEY, sidebarNotePreviewMode);
    renderSidebar();
  });
  const onSystemThemeChange = () => {
    if (themeMode === 'system') applyTheme();
  };
  if (systemThemeQuery?.addEventListener) systemThemeQuery.addEventListener('change', onSystemThemeChange);
  else systemThemeQuery?.addListener?.(onSystemThemeChange);

  pickerBtn?.addEventListener('click', e => {
    e.stopPropagation();
    if (!colorPopover) return;
    colorPopover.hidden = !colorPopover.hidden;
    pickerBtn.setAttribute('aria-expanded', colorPopover.hidden ? 'false' : 'true');
    updateColorPickerUI(accentColor);
  });

  document.addEventListener('click', e => {
    if (!colorPopover || colorPopover.hidden || colorControl?.contains(e.target)) return;
    closeColorPopover();
  });

  colorSv?.addEventListener('pointerdown', e => {
    e.preventDefault();
    colorSv.setPointerCapture(e.pointerId);
    updateFromSaturationValueEvent(e);
  });
  colorSv?.addEventListener('pointermove', e => {
    if (e.buttons !== 1) return;
    updateFromSaturationValueEvent(e);
  });

  colorHue?.addEventListener('input', e => {
    pickerHsv.h = Number(e.target.value) || 0;
    setAccentColor(colorFromPickerHsv());
  });

  colorInputs.forEach(input => {
    input.addEventListener('input', setPickerFromRgbInputs);
  });
  document.getElementById('fs-inc').addEventListener('click', () => {
    if (editorFontSize < FONT_MAX) {
      editorFontSize++;
      localStorage.setItem('notas_font_size', String(editorFontSize));
      applyFontSize();
    }
  });
  document.getElementById('fs-dec').addEventListener('click', () => {
    if (editorFontSize > FONT_MIN) {
      editorFontSize--;
      localStorage.setItem('notas_font_size', String(editorFontSize));
      applyFontSize();
    }
  });
}

function initFolderColorPicker() {
  const modal = document.getElementById('folder-color-modal');
  const sv = document.getElementById('folder-color-sv');
  const hue = document.getElementById('folder-color-hue');
  const colorInputs = ['folder-color-r', 'folder-color-g', 'folder-color-b'].map(id => document.getElementById(id)).filter(Boolean);

  function updateFromSaturationValueEvent(e) {
    if (!sv) return;
    const rect = sv.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    folderPickerHsv.s = rect.width ? x / rect.width : 0;
    folderPickerHsv.v = rect.height ? 1 - (y / rect.height) : 0;
    setFolderPickerManualColor(folderColorFromPickerHsv());
  }

  modal?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFolderColorPicker();
  });
  document.getElementById('folder-color-cancel')?.addEventListener('click', closeFolderColorPicker);
  document.getElementById('folder-color-save')?.addEventListener('click', saveFolderColorPicker);
  document.querySelectorAll('[data-folder-color-value]').forEach(btn => {
    btn.addEventListener('click', () => {
      _folderColorPickerValue = normalizeFolderIconColor(btn.dataset.folderColorValue, btn.dataset.folderColorValue === FOLDER_ICON_THEME ? 'theme' : 'manual') || DEFAULT_FOLDER_ICON_COLOR;
      updateFolderColorPickerUI();
    });
  });

  sv?.addEventListener('pointerdown', e => {
    e.preventDefault();
    sv.setPointerCapture(e.pointerId);
    updateFromSaturationValueEvent(e);
  });
  sv?.addEventListener('pointermove', e => {
    if (e.buttons !== 1) return;
    updateFromSaturationValueEvent(e);
  });

  hue?.addEventListener('input', e => {
    folderPickerHsv.h = Number(e.target.value) || 0;
    setFolderPickerManualColor(folderColorFromPickerHsv());
  });
  colorInputs.forEach(input => input.addEventListener('input', setFolderPickerFromRgbInputs));
}

const SIDEBAR_WORDMARK_HIDE_WIDTH = 160;
const SIDEBAR_ICON_SAFE_WIDTH = 224;

function updateSidebarWidthState(width) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const actualWidth = width || sidebar.getBoundingClientRect().width;
  sidebar.classList.toggle('logo-compact', !sidebarMinimized && actualWidth <= SIDEBAR_WORDMARK_HIDE_WIDTH);
}

function setSidebarMinimized(val) {
  if (isMobile()) return; // sidebar is a drawer on mobile
  sidebarMinimized = val;
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('minimized', val);
  sidebar.classList.toggle('logo-compact', false);
  const logoBtn = document.getElementById('sidebar-logo-btn');
  if (logoBtn) {
    logoBtn.title = val ? 'Expand Sidebar' : 'Collapse Sidebar';
    logoBtn.setAttribute('aria-label', val ? 'Expand Sidebar' : 'Collapse Sidebar');
  }
  localStorage.setItem('notas_sidebar_minimized', val ? '1' : '0');
  if (!val) {
    // Restore previously-saved resize width
    const saved = parseInt(localStorage.getItem('notas_sidebar_w') || '256');
    const w = (saved >= SIDEBAR_ICON_SAFE_WIDTH && saved <= 520) ? saved : 256;
    sidebar.style.width    = w + 'px';
    sidebar.style.minWidth = w + 'px';
    updateSidebarWidthState(w);
  }
}

/* Share ─────────────────────────────────────────────────── */
