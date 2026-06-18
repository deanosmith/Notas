/* Right-side note conversations and conversation alerts. */

let _conversationOverviewRefreshTimer = null;
let _conversationOverviewRefreshSeq = 0;
let _conversationDeletingSubject = false;
let _conversationPanelChromeReady = false;
let _conversationPanelDrag = null;
let _conversationPanelResize = null;

function conversationIso(value, fallback = new Date().toISOString()) {
  const normalized = typeof isoFromTimestamp === 'function' ? isoFromTimestamp(value) : '';
  if (normalized) return normalized;
  const date = value ? new Date(value) : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function conversationText(value, max = 180) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, Math.max(0, max - 3)).trimEnd() + '...';
}

function conversationEsc(value) {
  return esc(String(value || ''));
}

function conversationDocId(prefix = 'conv') {
  const safePrefix = typeof _safeDocFragment === 'function' ? _safeDocFragment(prefix) : prefix.replace(/[^A-Za-z0-9_-]/g, '_');
  return (safePrefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9))
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 180);
}

function normalizeConversation(id, data = {}) {
  const anchor = data.anchor && typeof data.anchor === 'object' ? data.anchor : {};
  const participantUids = Array.isArray(data.participantUids)
    ? data.participantUids
    : Object.keys(data.participantNames || {});
  const created = conversationIso(data.created, data.createdIso || data.modifiedIso || new Date().toISOString());
  const modified = conversationIso(data.modified || data.lastMessageAt, data.modifiedIso || data.lastMessageAtIso || created);
  return {
    id,
    noteId: data.noteId || '',
    noteTitle: data.noteTitle || '',
    createdBy: data.createdBy || '',
    createdByName: data.createdByName || '',
    participantUids: [...new Set(participantUids.filter(Boolean))],
    participantNames: data.participantNames && typeof data.participantNames === 'object' ? data.participantNames : {},
    anchorMode: data.anchorMode || anchor.mode || (data.anchorText || anchor.text ? 'selection' : 'cursor'),
    anchorText: data.anchorText || anchor.text || '',
    anchorContext: data.anchorContext || anchor.context || '',
    anchorStart: Number.isFinite(Number(data.anchorStart ?? anchor.start)) ? Number(data.anchorStart ?? anchor.start) : 0,
    anchorEnd: Number.isFinite(Number(data.anchorEnd ?? anchor.end)) ? Number(data.anchorEnd ?? anchor.end) : 0,
    anchorBookmark: data.anchorBookmark || anchor.bookmark || null,
    lastMessagePreview: data.lastMessagePreview || '',
    lastMessageBy: data.lastMessageBy || '',
    lastMessageAt: conversationIso(data.lastMessageAt, data.lastMessageAtIso || modified),
    created,
    modified,
    resolved: !!data.resolved
  };
}

function normalizeConversationMessage(id, data = {}) {
  const authorPhotos = profilePhotoFields(data.authorPhotoURL, data.authorPhotoURLCandidates);
  const created = conversationIso(data.created, data.createdIso || new Date().toISOString());
  return {
    id,
    conversationId: data.conversationId || '',
    noteId: data.noteId || '',
    authorUid: data.authorUid || '',
    authorName: data.authorName || 'Someone',
    authorEmail: normalizeEmail(data.authorEmail || ''),
    authorPhotoURL: authorPhotos.photoURL,
    authorPhotoURLCandidates: authorPhotos.photoURLCandidates,
    body: String(data.body || ''),
    created
  };
}

function clearConversationMessageSubscriptions() {
  Object.values(conversationMessageUnsubs || {}).forEach(fn => {
    try { fn(); } catch (_) {}
  });
  conversationMessageUnsubs = {};
}

function clearConversationState(options = {}) {
  if (unsubNoteConversations) {
    try { unsubNoteConversations(); } catch (_) {}
    unsubNoteConversations = null;
  }
  if (unsubAllConversations) {
    try { unsubAllConversations(); } catch (_) {}
    unsubAllConversations = null;
  }
  clearConversationMessageSubscriptions();
  if (_conversationOverviewRefreshTimer) {
    clearTimeout(_conversationOverviewRefreshTimer);
    _conversationOverviewRefreshTimer = null;
  }
  _conversationOverviewRefreshSeq += 1;
  noteConversations = {};
  allConversations = {};
  conversationMessages = {};
  activeConversationId = null;
  conversationComposeAnchor = null;
  conversationListeningNoteId = null;
  conversationBrowseView = 'all';
  conversationBrowseFolderId = null;
  conversationBrowseNoteId = null;
  hideConversationSelectionPopover();
  if (options.close) closeConversationsSidebar();
  updateConversationRailBadge();
  renderConversationsSidebar();
}

function subscribeConversationMessages(conversationId) {
  if (!conversationId || conversationMessageUnsubs[conversationId]) return;
  const ref = collection(fsDb, 'noteConversations', conversationId, 'messages');
  conversationMessageUnsubs[conversationId] = onSnapshot(ref, snap => {
    const next = {};
    snap.forEach(messageSnap => {
      next[messageSnap.id] = normalizeConversationMessage(messageSnap.id, messageSnap.data() || {});
    });
    conversationMessages[conversationId] = Object.values(next)
      .sort((a, b) => new Date(a.created) - new Date(b.created));
    renderConversationsSidebar();
  }, err => {
    console.warn('conversation messages listener:', err);
  });
}

function unsubscribeConversationMessages(conversationId) {
  if (!conversationMessageUnsubs[conversationId]) return;
  try { conversationMessageUnsubs[conversationId](); } catch (_) {}
  delete conversationMessageUnsubs[conversationId];
  delete conversationMessages[conversationId];
}

function listenToConversationsForNote(noteId) {
  const normalizedNoteId = noteId || null;
  if (conversationListeningNoteId === normalizedNoteId) {
    renderConversationsSidebar();
    return Promise.resolve();
  }
  if (unsubNoteConversations) {
    try { unsubNoteConversations(); } catch (_) {}
    unsubNoteConversations = null;
  }
  clearConversationMessageSubscriptions();
  noteConversations = {};
  conversationMessages = {};
  activeConversationId = null;
  conversationComposeAnchor = null;
  conversationListeningNoteId = normalizedNoteId;
  renderConversationsSidebar();

  if (!normalizedNoteId || !userId) return Promise.resolve();

  let initialSettled = false;
  let resolveInitial;
  const initialLoad = new Promise(resolve => { resolveInitial = resolve; });
  const settleInitial = () => {
    if (initialSettled) return;
    initialSettled = true;
    resolveInitial();
  };

  const q = query(collection(fsDb, 'noteConversations'), where('noteId', '==', normalizedNoteId));
  unsubNoteConversations = onSnapshot(q, snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        delete noteConversations[id];
        delete allConversations[id];
        unsubscribeConversationMessages(id);
        if (activeConversationId === id) activeConversationId = null;
        return;
      }
      const conversation = normalizeConversation(id, ch.doc.data() || {});
      noteConversations[id] = conversation;
      allConversations[id] = conversation;
      subscribeConversationMessages(id);
    });
    updateConversationRailBadge();
    renderConversationsSidebar();
    settleInitial();
  }, err => {
    console.warn('note conversations listener:', err);
    renderConversationsSidebar();
    settleInitial();
  });
  return initialLoad;
}

function listenToAllConversations() {
  if (!userId || unsubAllConversations) return;
  const q = query(collection(fsDb, 'noteConversations'), where('participantUids', 'array-contains', userId));
  unsubAllConversations = onSnapshot(q, snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        delete allConversations[id];
        return;
      }
      allConversations[id] = normalizeConversation(id, ch.doc.data() || {});
    });
    updateConversationRailBadge();
    if (conversationsOpen) renderConversationsSidebar();
  }, err => {
    console.warn('all conversations listener:', err);
    updateConversationRailBadge();
    if (conversationsOpen) renderConversationsSidebar();
  });
}

function scheduleConversationOverviewRefresh(delay = 160) {
  if (!userId) return;
  if (_conversationOverviewRefreshTimer) clearTimeout(_conversationOverviewRefreshTimer);
  _conversationOverviewRefreshTimer = setTimeout(() => {
    _conversationOverviewRefreshTimer = null;
    refreshConversationOverviewFromNotes();
  }, delay);
}

function conversationOverviewNoteCandidates() {
  return Object.values(notes || {})
    .filter(note => note?.id && !isTrashedNote(note) && canStartConversationOnNote(note));
}

async function loadConversationsForOverviewNote(noteId) {
  const snap = await getDocs(query(collection(fsDb, 'noteConversations'), where('noteId', '==', noteId)));
  const records = [];
  snap.forEach(conversationSnap => {
    records.push({
      id: conversationSnap.id,
      conversation: normalizeConversation(conversationSnap.id, conversationSnap.data() || {})
    });
  });
  return { noteId, records };
}

async function refreshConversationOverviewFromNotes() {
  if (!userId) return;
  const scanId = ++_conversationOverviewRefreshSeq;
  const noteIds = [...new Set(conversationOverviewNoteCandidates().map(note => note.id))];
  if (!noteIds.length) {
    updateConversationRailBadge();
    if (conversationsOpen && conversationBrowseView === 'all' && !activeConversationId && !conversationComposeAnchor) renderConversationsSidebar();
    return;
  }

  const successfulNoteIds = new Set();
  const discoveredConversationIds = new Set();
  const batchSize = 8;

  for (let i = 0; i < noteIds.length; i += batchSize) {
    const batch = noteIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(loadConversationsForOverviewNote));
    if (scanId !== _conversationOverviewRefreshSeq) return;

    results.forEach(result => {
      if (result.status !== 'fulfilled') {
        console.warn('conversation overview note scan:', result.reason);
        return;
      }
      successfulNoteIds.add(result.value.noteId);
      result.value.records.forEach(({ id, conversation }) => {
        discoveredConversationIds.add(id);
        allConversations[id] = conversation;
        if (conversationListeningNoteId && conversation.noteId === conversationListeningNoteId) noteConversations[id] = conversation;
      });
    });
  }

  Object.keys(allConversations || {}).forEach(id => {
    const noteId = allConversations[id]?.noteId || '';
    if (successfulNoteIds.has(noteId) && !discoveredConversationIds.has(id)) delete allConversations[id];
  });

  updateConversationRailBadge();
  if (conversationsOpen && !activeConversationId && !conversationComposeAnchor) renderConversationsSidebar();
}

function conversationTimeValue(conversation) {
  const value = conversation?.modified || conversation?.lastMessageAt || conversation?.created || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareConversationRows(a, b) {
  if (conversationHasUnread(a.id) !== conversationHasUnread(b.id)) return conversationHasUnread(a.id) ? -1 : 1;
  if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
  return conversationTimeValue(b) - conversationTimeValue(a);
}

function sortedAllConversations() {
  return Object.values(allConversations || {}).sort(compareConversationRows);
}

function updateConversationRailBadge() {
  const badge = document.getElementById('conversation-badge');
  if (!badge) return;
  const unreadCount = Object.values(allConversations || {}).reduce((sum, conv) => sum + conversationUnreadCount(conv.id), 0);
  const label = unreadCount + ' unread conversation message' + (unreadCount === 1 ? '' : 's');
  badge.classList.add('conversation-notification-icon');
  badge.innerHTML = '<i class="fa-solid fa-bell"></i>';
  badge.title = label;
  badge.setAttribute('aria-label', label);
  badge.hidden = unreadCount <= 0;
}

function canStartConversationOnNote(note) {
  return !!(note && !isTrashedNote(note) && canEditNote(note));
}

function currentUserConversationProfile() {
  const profile = currentProfileLinkPayload();
  return {
    uid: userId,
    displayName: profile.displayName || auth.currentUser?.displayName || 'You',
    email: normalizeEmail(profile.email || auth.currentUser?.email || ''),
    photoURL: profile.photoURL || '',
    photoURLCandidates: profile.photoURLCandidates || []
  };
}

function conversationProfileByUid(uid, conversation = null) {
  if (!uid) return { uid: '', displayName: 'Someone', email: '', photoURL: '' };
  if (uid === userId) return currentUserConversationProfile();
  if (friends[uid]) return friends[uid];
  if (linkedProfiles[uid]) return linkedProfiles[uid];
  const access = Object.values(noteAccessById || {}).find(entry => entry?.userUid === uid || entry?.fromUid === uid);
  if (access?.userUid === uid) {
    return {
      uid,
      displayName: access.displayName || access.email || 'Friend',
      email: normalizeEmail(access.email || ''),
      photoURL: access.photoURL || ''
    };
  }
  if (access?.fromUid === uid) {
    return {
      uid,
      displayName: access.fromName || 'Shared Owner',
      email: normalizeEmail(access.fromEmail || ''),
      photoURL: access.fromPhotoURL || '',
      photoURLCandidates: access.fromPhotoURLCandidates || []
    };
  }
  const direct = activeId ? (notes[activeId]?.directAccess || directAccessForNote(activeId)) : null;
  if (direct?.fromUid === uid) {
    return {
      uid,
      displayName: direct.fromName || 'Shared Owner',
      email: normalizeEmail(direct.fromEmail || ''),
      photoURL: direct.fromPhotoURL || '',
      photoURLCandidates: direct.fromPhotoURLCandidates || []
    };
  }
  return {
    uid,
    displayName: conversation?.participantNames?.[uid] || 'Friend',
    email: '',
    photoURL: ''
  };
}

function addConversationRecipientOption(map, profile) {
  const normalized = normalizeUserProfile(profile?.uid, profile || {});
  if (!normalized?.uid || normalized.uid === userId) return;
  map[normalized.uid] = mergeLinkedProfileRecords(map[normalized.uid], normalized) || normalized;
}

function conversationRecipientOptions(note = notes[activeId]) {
  const byUid = {};
  if (!note) return [];
  if (isOwnedNote(note)) {
    friendArray().forEach(profile => addConversationRecipientOption(byUid, profile));
    accessProfilesForNote(note).forEach(profile => addConversationRecipientOption(byUid, profile));
  } else {
    const access = note.directAccess || directAccessForNote(note.id) || {};
    addConversationRecipientOption(byUid, {
      uid: access.fromUid || note.owner || '',
      displayName: access.fromName || 'Shared Owner',
      email: normalizeEmail(access.fromEmail || ''),
      photoURL: access.fromPhotoURL || '',
      photoURLCandidates: access.fromPhotoURLCandidates || []
    });
  }
  return Object.values(byUid).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

function conversationRecipientByUid(uid) {
  return conversationRecipientOptions().find(profile => profile.uid === uid) || conversationProfileByUid(uid);
}

function editorRangeForConversation() {
  const ed = getEd();
  const sel = window.getSelection();
  if (ed && sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const owner = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (owner && ed.contains(owner)) return range.cloneRange();
  }
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  return range;
}

function blockTextForRange(range) {
  let node = range?.startContainer || null;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const ed = getEd();
  while (node && node !== ed) {
    if (node.nodeType === Node.ELEMENT_NODE && /^(P|DIV|LI|H1|H2|H3|H4|BLOCKQUOTE|PRE|TD|TH)$/.test(node.tagName)) {
      return conversationText(node.innerText || node.textContent || '', 220);
    }
    node = node.parentNode;
  }
  return conversationText(ed?.innerText || '', 220);
}

function captureRangeBookmark(root, range) {
  if (!root || !range) return null;
  try {
    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(root);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(root);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    return {
      startPath: nodePathFromRoot(root, range.startContainer),
      startOffset: range.startOffset,
      endPath: nodePathFromRoot(root, range.endContainer),
      endOffset: range.endOffset,
      start: beforeStart.toString().length,
      end: beforeEnd.toString().length,
      collapsed: range.collapsed
    };
  } catch (_) {
    return null;
  }
}

function conversationAnchorFromSelection() {
  const ed = getEd();
  const range = editorRangeForConversation();
  const bookmark = captureRangeBookmark(ed, range);
  const selectedText = conversationText(range.toString(), 260);
  const context = conversationText(selectedText || blockTextForRange(range) || notes[activeId]?.title || 'Cursor location', 260);
  return {
    noteId: activeId || '',
    mode: range.collapsed ? 'cursor' : 'selection',
    text: selectedText,
    context,
    start: bookmark?.start || 0,
    end: bookmark?.end || bookmark?.start || 0,
    bookmark
  };
}

function conversationAnchorCopy(anchorOrConversation) {
  const text = anchorOrConversation?.anchorText || anchorOrConversation?.text || '';
  const context = anchorOrConversation?.anchorContext || anchorOrConversation?.context || '';
  return conversationText(text || context || 'Cursor location', 220);
}

function conversationMessageCountLabel(count) {
  const total = Number(count) || 0;
  return total + ' message' + (total === 1 ? '' : 's');
}

function conversationNoteForDisplay(conversation) {
  return notes[conversation?.noteId] || {
    id: conversation?.noteId || '',
    title: conversation?.noteTitle || 'Untitled Note',
    folderId: ''
  };
}

function conversationFolderLabel(note) {
  const folder = note?.folderId ? folders[note.folderId] : null;
  return folder?.title || 'Notes';
}

function conversationFolderColor(note) {
  const folder = note?.folderId ? folders[note.folderId] : null;
  return folder ? resolveFolderIconColor(folder.iconColor, folder.iconColorMode) : DEFAULT_FOLDER_ICON_COLOR;
}

function conversationLocationLabel(conversation) {
  const note = conversationNoteForDisplay(conversation);
  const folderLabel = conversationFolderLabel(note);
  const noteLabel = note?.title || conversation?.noteTitle || 'Untitled Note';
  return folderLabel + ' / ' + noteLabel;
}

function conversationById(conversationId) {
  return noteConversations[conversationId] || allConversations[conversationId] || null;
}

function conversationsForNote(noteId) {
  const local = Object.values(noteConversations || {}).filter(conv => conv.noteId === noteId);
  const localIds = new Set(local.map(conv => conv.id));
  const global = sortedAllConversations().filter(conv => conv.noteId === noteId && !localIds.has(conv.id));
  return [...local, ...global].sort(compareConversationRows);
}

function newestConversation(conversations) {
  return [...(conversations || [])].sort(compareConversationRows)[0] || null;
}

function conversationCountLabel(count) {
  const total = Number(count) || 0;
  return total + ' conversation' + (total === 1 ? '' : 's');
}

function conversationNoteGroups(conversations = sortedAllConversations()) {
  const groups = new Map();
  (conversations || []).forEach(conv => {
    const note = conversationNoteForDisplay(conv);
    const noteId = note?.id || conv.noteId || '';
    if (!noteId) return;
    if (!groups.has(noteId)) {
      groups.set(noteId, {
        id: noteId,
        title: note?.title || conv.noteTitle || 'Untitled Note',
        folderTitle: conversationFolderLabel(note),
        folderColor: conversationFolderColor(note),
        conversations: []
      });
    }
    groups.get(noteId).conversations.push(conv);
  });
  return [...groups.values()]
    .map(group => ({ ...group, latest: newestConversation(group.conversations) }))
    .sort((a, b) => compareConversationRows(a.latest || {}, b.latest || {}));
}

function setConversationBrowseScope(view = 'all', options = {}) {
  conversationBrowseView = view === 'note' ? 'note' : 'all';
  conversationBrowseFolderId = null;
  conversationBrowseNoteId = conversationBrowseView === 'note' ? (options.noteId || null) : null;
}

function setConversationScopeForConversation(conversation) {
  if (!conversation?.noteId) return;
  setConversationBrowseScope('note', {
    noteId: conversation.noteId
  });
}

function conversationScopeTitle() {
  if (activeConversationId) {
    const conv = conversationById(activeConversationId);
    const note = conv ? conversationNoteForDisplay(conv) : null;
    return note?.title || conv?.noteTitle || '';
  }
  if (conversationBrowseView === 'note') {
    const conv = conversationsForNote(conversationBrowseNoteId)[0];
    const note = conv ? conversationNoteForDisplay(conv) : notes[conversationBrowseNoteId];
    return note?.title || conv?.noteTitle || 'Untitled Note';
  }
  return 'All notes';
}

function conversationPanelTitle() {
  if (conversationComposeAnchor || activeConversationId) return 'Conversation';
  if (conversationBrowseView === 'note') return 'Note Conversations';
  return 'Conversations';
}

function conversationPanelNumberVar(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function conversationPanelBounds(width, height) {
  const edge = isMobile() ? 12 : 16;
  const rail = isMobile() ? 0 : conversationPanelNumberVar('--rail-w', 64);
  const minLeft = rail + edge;
  const minTop = edge;
  return {
    minLeft,
    minTop,
    maxLeft: Math.max(minLeft, window.innerWidth - width - edge),
    maxTop: Math.max(minTop, window.innerHeight - height - edge)
  };
}

function conversationPanelSizeLimits(top = 0) {
  const edge = isMobile() ? 12 : 16;
  const rail = isMobile() ? 0 : conversationPanelNumberVar('--rail-w', 64);
  const minWidth = Math.max(280, Math.min(320, window.innerWidth - edge * 2));
  const minHeight = Math.max(260, Math.min(360, window.innerHeight - 104));
  return {
    minWidth,
    minHeight,
    maxWidth: Math.max(minWidth, window.innerWidth - rail - edge * 2),
    maxHeight: Math.max(minHeight, window.innerHeight - top - edge)
  };
}

function resetConversationPanelPlacement() {
  const sidebar = document.getElementById('conversation-sidebar');
  if (!sidebar) return;
  sidebar.style.left = '';
  sidebar.style.top = '';
  sidebar.style.right = '';
  sidebar.style.width = '';
  sidebar.style.height = '';
  sidebar.classList.remove('conversation-panel-dragging');
  sidebar.classList.remove('conversation-panel-resizing');
  _conversationPanelDrag = null;
  _conversationPanelResize = null;
}

function clampConversationPanelToViewport() {
  const sidebar = document.getElementById('conversation-sidebar');
  if (!sidebar || isMobile() || !sidebar.classList.contains('open')) return;
  const rect = sidebar.getBoundingClientRect();
  const bounds = conversationPanelBounds(rect.width, rect.height);
  const left = Math.min(Math.max(rect.left, bounds.minLeft), bounds.maxLeft);
  const top = Math.min(Math.max(rect.top, bounds.minTop), bounds.maxTop);
  sidebar.style.left = left + 'px';
  sidebar.style.top = top + 'px';
  sidebar.style.right = 'auto';
}

function startConversationPanelDrag(e) {
  if (e.button !== 0 || isMobile()) return;
  if (e.target.closest?.('button, input, select, textarea, a')) return;
  const sidebar = document.getElementById('conversation-sidebar');
  const header = e.currentTarget;
  if (!sidebar?.classList.contains('open')) return;
  const rect = sidebar.getBoundingClientRect();
  _conversationPanelDrag = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
  sidebar.style.left = rect.left + 'px';
  sidebar.style.top = rect.top + 'px';
  sidebar.style.right = 'auto';
  sidebar.style.width = rect.width + 'px';
  sidebar.style.height = rect.height + 'px';
  sidebar.classList.add('conversation-panel-dragging');
  header.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function moveConversationPanelDrag(e) {
  if (!_conversationPanelDrag || e.pointerId !== _conversationPanelDrag.pointerId) return;
  const sidebar = document.getElementById('conversation-sidebar');
  if (!sidebar) return;
  const bounds = conversationPanelBounds(_conversationPanelDrag.width, _conversationPanelDrag.height);
  const left = Math.min(
    Math.max(_conversationPanelDrag.left + e.clientX - _conversationPanelDrag.startX, bounds.minLeft),
    bounds.maxLeft
  );
  const top = Math.min(
    Math.max(_conversationPanelDrag.top + e.clientY - _conversationPanelDrag.startY, bounds.minTop),
    bounds.maxTop
  );
  sidebar.style.left = left + 'px';
  sidebar.style.top = top + 'px';
}

function endConversationPanelDrag(e = {}) {
  if (!_conversationPanelDrag || (e.pointerId && e.pointerId !== _conversationPanelDrag.pointerId)) return;
  document.getElementById('conversation-sidebar')?.classList.remove('conversation-panel-dragging');
  _conversationPanelDrag = null;
  clampConversationPanelToViewport();
}

function startConversationPanelResize(e) {
  if (e.button !== 0 || isMobile()) return;
  const sidebar = document.getElementById('conversation-sidebar');
  const handle = e.currentTarget;
  if (!sidebar?.classList.contains('open')) return;
  const rect = sidebar.getBoundingClientRect();
  _conversationPanelResize = {
    pointerId: e.pointerId,
    edge: handle.dataset.conversationResizeEdge || (handle.classList.contains('conversation-resize-handle-right') ? 'right' : 'left'),
    startX: e.clientX,
    startY: e.clientY,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    width: rect.width,
    height: rect.height
  };
  sidebar.style.left = rect.left + 'px';
  sidebar.style.top = rect.top + 'px';
  sidebar.style.right = 'auto';
  sidebar.style.width = rect.width + 'px';
  sidebar.style.height = rect.height + 'px';
  sidebar.classList.add('conversation-panel-resizing');
  handle.setPointerCapture?.(e.pointerId);
  e.preventDefault();
  e.stopPropagation();
}

function moveConversationPanelResize(e) {
  if (!_conversationPanelResize || e.pointerId !== _conversationPanelResize.pointerId) return;
  const sidebar = document.getElementById('conversation-sidebar');
  if (!sidebar) return;
  const edge = isMobile() ? 12 : 16;
  const rail = isMobile() ? 0 : conversationPanelNumberVar('--rail-w', 64);
  const minLeft = rail + edge;
  const limits = conversationPanelSizeLimits(_conversationPanelResize.top);
  const deltaX = e.clientX - _conversationPanelResize.startX;
  const resizingRight = _conversationPanelResize.edge === 'right';
  const maxWidth = resizingRight
    ? Math.min(limits.maxWidth, window.innerWidth - edge - _conversationPanelResize.left)
    : Math.min(limits.maxWidth, _conversationPanelResize.right - minLeft);
  const width = Math.min(
    Math.max(_conversationPanelResize.width + (resizingRight ? deltaX : -deltaX), limits.minWidth),
    maxWidth
  );
  const height = Math.min(Math.max(_conversationPanelResize.height + (e.clientY - _conversationPanelResize.startY), limits.minHeight), limits.maxHeight);
  sidebar.style.left = (resizingRight ? _conversationPanelResize.left : _conversationPanelResize.right - width) + 'px';
  sidebar.style.width = width + 'px';
  sidebar.style.height = height + 'px';
}

function endConversationPanelResize(e = {}) {
  if (!_conversationPanelResize || (e.pointerId && e.pointerId !== _conversationPanelResize.pointerId)) return;
  document.getElementById('conversation-sidebar')?.classList.remove('conversation-panel-resizing');
  _conversationPanelResize = null;
  clampConversationPanelToViewport();
}

function setupConversationPanelChrome() {
  if (_conversationPanelChromeReady) return;
  _conversationPanelChromeReady = true;
  const header = document.querySelector('#conversation-sidebar .conversation-panel-header');
  const resizeHandles = document.querySelectorAll('#conversation-sidebar .conversation-resize-handle');
  header?.addEventListener('pointerdown', startConversationPanelDrag);
  header?.addEventListener('pointermove', moveConversationPanelDrag);
  header?.addEventListener('pointerup', endConversationPanelDrag);
  header?.addEventListener('pointercancel', endConversationPanelDrag);
  resizeHandles.forEach(handle => {
    handle.addEventListener('pointerdown', startConversationPanelResize);
    handle.addEventListener('pointermove', moveConversationPanelResize);
    handle.addEventListener('pointerup', endConversationPanelResize);
    handle.addEventListener('pointercancel', endConversationPanelResize);
  });
  document.addEventListener('pointermove', moveConversationPanelDrag);
  document.addEventListener('pointerup', endConversationPanelDrag);
  document.addEventListener('pointercancel', endConversationPanelDrag);
  document.addEventListener('pointermove', moveConversationPanelResize);
  document.addEventListener('pointerup', endConversationPanelResize);
  document.addEventListener('pointercancel', endConversationPanelResize);
  window.addEventListener('resize', () => {
    if (!conversationsOpen) return;
    if (isMobile()) resetConversationPanelPlacement();
    else clampConversationPanelToViewport();
  });
}

function conversationPreviewForConversation(conversation) {
  return conversationText(conversation?.lastMessagePreview || conversationAnchorCopy(conversation) || 'Conversation', 120);
}

function conversationSenderName(conversation, message) {
  if (message?.authorUid === userId) return 'You';
  if (message?.authorName) return message.authorName;
  const profile = conversationProfileByUid(conversation?.lastMessageBy || conversation?.createdBy, conversation);
  return profile.displayName || profile.email || conversation?.createdByName || 'Someone';
}

function createConversationAnchorMark(conversationId, anchor = {}) {
  const mark = document.createElement('span');
  mark.className = 'note-conversation-anchor';
  mark.dataset.conversationId = conversationId || '';
  mark.dataset.conversationMode = anchor.mode === 'cursor' ? 'cursor' : 'selection';
  updateConversationAnchorMarkDisplay(mark);
  return mark;
}

function updateConversationAnchorMarkDisplay(mark) {
  if (!mark) return false;
  const conversationId = mark.dataset.conversationId || mark.getAttribute('data-conversation-id') || '';
  if (!conversationId) return false;
  const mode = mark.dataset.conversationMode === 'cursor' ? 'cursor' : 'selection';
  mark.classList.add('note-conversation-anchor');
  mark.dataset.conversationId = conversationId;
  mark.dataset.conversationMode = mode;
  mark.title = mode === 'cursor' ? 'Open conversation at this point' : 'Open conversation';
  if (mode === 'cursor') {
    mark.setAttribute('contenteditable', 'false');
    if (!mark.textContent.trim()) mark.textContent = 'Conversation';
  } else {
    mark.removeAttribute('contenteditable');
  }
  return true;
}

function unwrapConversationAnchorMark(mark) {
  const parent = mark?.parentNode;
  if (!parent) return;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  mark.remove();
  parent.normalize?.();
}

function restoreConversationAnchorMarks(root = getEd()) {
  if (!root) return;
  root.querySelectorAll('.note-conversation-anchor').forEach(mark => {
    if (!updateConversationAnchorMarkDisplay(mark)) unwrapConversationAnchorMark(mark);
  });
}

function conversationAnchorMarkForConversation(root, conversationId) {
  if (!root || !conversationId) return null;
  return [...root.querySelectorAll('.note-conversation-anchor')]
    .find(mark => mark.dataset.conversationId === conversationId) || null;
}

function placeConversationFocusOnMark(mark) {
  if (!mark) return;
  mark.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  mark.classList.add('conversation-anchor-focused');
  setTimeout(() => mark.classList.remove('conversation-anchor-focused'), 1400);
}

function openConversationFromMarker(mark) {
  const conversationId = mark?.dataset?.conversationId || '';
  if (!conversationId) return;
  selectConversation(conversationId);
  placeConversationFocusOnMark(mark);
}

async function applyConversationAnchorMark(conversationId, anchor) {
  const note = anchor?.noteId ? notes[anchor.noteId] : notes[activeId];
  if (!conversationId || !note || activeId !== note.id || !canEditNote(note)) return false;
  const ed = getEd();
  if (!ed) return false;
  const bookmark = anchor.bookmark || {
    start: anchor.start || 0,
    end: anchor.end || anchor.start || 0,
    collapsed: anchor.mode === 'cursor'
  };

  try {
    pushUndo();
    restoreEditorSelection(ed, bookmark);
    const sel = window.getSelection();
    if (!sel?.rangeCount) {
      commitUndoSnapshot();
      return false;
    }
    const range = sel.getRangeAt(0);
    const owner = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (!owner || !ed.contains(owner)) {
      commitUndoSnapshot();
      return false;
    }

    const mark = createConversationAnchorMark(conversationId, anchor);
    if (range.collapsed) {
      mark.textContent = 'Conversation';
      range.insertNode(mark);
    } else {
      mark.appendChild(range.extractContents());
      mark.querySelectorAll('.note-conversation-anchor').forEach(nested => unwrapConversationAnchorMark(nested));
      range.insertNode(mark);
    }
    restoreConversationAnchorMarks(ed);
    placeCursorAfterNode(mark);
    refreshEmpty(ed);
    const synced = syncActiveNoteFromEditor();
    scheduleUndoSnapshot();
    renderSidebar();
    return synced ? await saveDoc(note) : false;
  } catch (err) {
    console.warn('conversation anchor mark:', err);
    try { commitUndoSnapshot(); } catch (_) {}
    return false;
  }
}

function openConversationsSidebar(conversationId = null, options = {}) {
  const wasOpen = conversationsOpen;
  conversationsOpen = true;
  if (conversationId) {
    activeConversationId = conversationId;
    conversationComposeAnchor = null;
    const conversation = conversationById(conversationId);
    if (conversation) {
      setConversationScopeForConversation(conversation);
      if (conversation.noteId && notes[conversation.noteId] && activeId !== conversation.noteId) openNote(conversation.noteId);
      activeConversationId = conversationId;
    }
  } else if (!options.preserveScope && !conversationComposeAnchor) {
    activeConversationId = null;
    setConversationBrowseScope('all');
  } else if (!conversationComposeAnchor) {
    activeConversationId = null;
  }
  if (activeConversationId) subscribeConversationMessages(activeConversationId);
  if (!conversationId) scheduleConversationOverviewRefresh(0);
  document.getElementById('app')?.classList.add('conversations-open');
  const sidebar = document.getElementById('conversation-sidebar');
  setupConversationPanelChrome();
  if (!wasOpen) resetConversationPanelPlacement();
  sidebar?.classList.add('open');
  sidebar?.setAttribute('aria-hidden', 'false');
  renderConversationsSidebar();
  if (activeConversationId) {
    markConversationNotificationsRead(activeConversationId);
    setTimeout(() => {
      const conversation = conversationById(activeConversationId);
      if (conversation && activeId === conversation.noteId) focusConversationAnchor(conversation);
    }, 80);
  }
}

function closeConversationsSidebar() {
  conversationsOpen = false;
  conversationComposeAnchor = null;
  endConversationPanelDrag();
  endConversationPanelResize();
  document.getElementById('app')?.classList.remove('conversations-open');
  const sidebar = document.getElementById('conversation-sidebar');
  sidebar?.classList.remove('open');
  sidebar?.setAttribute('aria-hidden', 'true');
  renderConversationsSidebar();
}

function toggleConversationsSidebar() {
  if (conversationsOpen) closeConversationsSidebar();
  else openConversationsSidebar();
}

function openConversationComposerFromSelection(anchor = null) {
  if (!activeId || !notes[activeId]) {
    showToast('Select A Note First', 'error');
    return;
  }
  if (!canStartConversationOnNote(notes[activeId])) {
    showToast('Conversation Requires Edit Access', 'error');
    return;
  }
  conversationComposeAnchor = anchor || conversationAnchorFromSelection();
  activeConversationId = null;
  setConversationBrowseScope('note', {
    noteId: conversationComposeAnchor.noteId
  });
  openConversationsSidebar(null, { preserveScope: true });
  setTimeout(() => document.getElementById('conversation-new-message')?.focus(), 80);
}

function selectConversation(conversationId) {
  if (!conversationId) return;
  const conversation = conversationById(conversationId);
  if (conversation) {
    setConversationScopeForConversation(conversation);
    if (conversation.noteId && notes[conversation.noteId] && activeId !== conversation.noteId) openNote(conversation.noteId);
  }
  activeConversationId = conversationId;
  conversationComposeAnchor = null;
  openConversationsSidebar(conversationId, { preserveScope: true });
}

function conversationUnreadItems(conversationId) {
  if (!conversationId || typeof getMentionItems !== 'function') return [];
  return getMentionItems().filter(item =>
    item.type === 'conversation' &&
    item.conversationId === conversationId &&
    !item.read
  );
}

function conversationHasUnread(conversationId) {
  return conversationUnreadCount(conversationId) > 0;
}

function conversationUnreadCount(conversationId) {
  return conversationUnreadItems(conversationId).length;
}

function conversationGroupUnreadCount(conversations = []) {
  return conversations.reduce((sum, conv) => sum + conversationUnreadCount(conv.id), 0);
}

async function markConversationNotificationsRead(conversationId) {
  const unread = conversationUnreadItems(conversationId);
  if (!unread.length || typeof persistNotificationReads !== 'function') return;
  await persistNotificationReads(unread.flatMap(notificationReadKeys));
}

function renderConversationAnchor(anchorOrConversation, options = {}) {
  const mode = anchorOrConversation?.anchorMode || anchorOrConversation?.mode || 'cursor';
  const icon = mode === 'cursor' ? 'fa-solid fa-location-dot' : 'fa-solid fa-quote-left';
  const text = conversationAnchorCopy(anchorOrConversation);
  const title = mode === 'cursor' ? 'Cursor location' : 'Highlighted text';
  const cardClass = 'conversation-anchor-card conversation-anchor-' + (mode === 'cursor' ? 'cursor' : 'selection') + (options.button ? ' as-button' : '');
  const inner =
    '<span class="conversation-anchor-icon"><i class="' + icon + '"></i></span>' +
    '<span class="conversation-anchor-copy">' +
      '<span class="conversation-anchor-label">' + title + '</span>' +
      '<span class="conversation-anchor-text">' + conversationEsc(text) + '</span>' +
    '</span>';
  if (options.button) {
    return '<button class="' + cardClass + '" data-conversation-focus-anchor="' + conversationEsc(anchorOrConversation?.id || '') + '" type="button" title="' + conversationEsc(title) + '">' +
      inner +
    '</button>';
  }
  return '<div class="' + cardClass + '" title="' + conversationEsc(title) + '">' + inner + '</div>';
}

function renderConversationNoteOverview(body) {
  const conversations = sortedAllConversations();
  const noteGroups = conversationNoteGroups(conversations);
  const rows = noteGroups.map(group => {
    const latest = group.latest;
    const preview = latest ? conversationPreviewForConversation(latest) : conversationCountLabel(group.conversations.length);
    const sub = group.folderTitle + ' · ' + preview;
    const unreadCount = conversationGroupUnreadCount(group.conversations);
    const unreadLabel = unreadCount + ' unread message' + (unreadCount === 1 ? '' : 's');
    return '<button class="conversation-scope-row" data-conversation-note="' + conversationEsc(group.id) + '" type="button">' +
      '<span class="conversation-scope-icon folder" style="--conversation-folder-color:' + conversationEsc(group.folderColor || DEFAULT_FOLDER_ICON_COLOR) + ';"><i class="fa-solid fa-folder"></i></span>' +
      '<span class="conversation-scope-main">' +
        '<span class="conversation-scope-title">' + conversationEsc(group.title) + '</span>' +
        '<span class="conversation-scope-sub">' + conversationEsc(sub) + '</span>' +
      '</span>' +
      '<span class="conversation-scope-trailing">' +
        (unreadCount ? '<span class="conversation-scope-count unread" title="' + conversationEsc(unreadLabel) + '" aria-label="' + conversationEsc(unreadLabel) + '">' + conversationEsc(unreadCount > 99 ? '99+' : String(unreadCount)) + '</span>' : '') +
        '<span class="conversation-scope-chevron"><i class="fa-solid fa-chevron-right"></i></span>' +
      '</span>' +
    '</button>';
  }).join('');

  body.innerHTML =
    '<div class="conversation-list">' +
      (rows
        ? '<div class="conversation-scope-list">' + rows + '</div>'
        : '<div class="conversation-empty"><i class="fa-regular fa-comments"></i><span>No Conversations Yet</span></div>') +
    '</div>';
}

function renderConversationList(body, conversations, options = {}) {
  const note = options.noteId ? (notes[options.noteId] || (conversations[0] ? conversationNoteForDisplay(conversations[0]) : conversationNoteForDisplay({ noteId: options.noteId, noteTitle: '' }))) : null;
  const rows = conversations.map(conv => {
    const messages = conversationMessages[conv.id] || [];
    const last = messages[messages.length - 1];
    const profile = conversationProfileByUid(last?.authorUid || conv.lastMessageBy || conv.createdBy, conv);
    const preview = conversationText(last?.body || conv.lastMessagePreview || 'Conversation', 120);
    const note = conversationNoteForDisplay(conv);
    const folderLabel = conversationFolderLabel(note);
    const noteLabel = note?.title || conv.noteTitle || 'Untitled Note';
    const sender = conversationSenderName(conv, last);
    const modifiedLabel = relativeNotificationTime(conv.modified || conv.lastMessageAt || conv.created);
    const unread = conversationHasUnread(conv.id);
    const canDelete = canDeleteConversationSubject(conv);
    return '<div class="conversation-thread-row' + (unread ? ' unread' : '') + (conv.resolved ? ' resolved' : '') + (canDelete ? ' has-topic-delete' : '') + '">' +
      '<button class="conversation-thread-main" data-conversation-open="' + conversationEsc(conv.id) + '" type="button">' +
      '<div class="conversation-thread-top">' +
        '<div class="conversation-thread-avatar">' + renderProfileAvatar(profile) + '</div>' +
        '<span class="conversation-thread-sender">' + conversationEsc(sender) + '</span>' +
        (unread ? '<span class="conversation-unread-dot"></span>' : '') +
      '</div>' +
      '<div class="conversation-thread-location"><i class="fa-solid fa-folder"></i><span>' + conversationEsc(folderLabel) + '</span><span class="conversation-thread-separator">/</span><i class="fa-solid fa-note-sticky"></i><span>' + conversationEsc(noteLabel) + '</span></div>' +
      '<div class="conversation-thread-bottom">' +
        '<span class="conversation-thread-preview">' + conversationEsc(preview) + '</span>' +
        '<time>' + conversationEsc(modifiedLabel) + '</time>' +
      '</div>' +
      '</button>' +
      (canDelete
        ? '<button class="conversation-thread-delete" data-conversation-delete-subject="' + conversationEsc(conv.id) + '" type="button" title="Delete Conversation" aria-label="Delete Conversation"' + (_conversationDeletingSubject ? ' disabled' : '') + '><i class="fa-solid fa-trash"></i></button>'
        : '') +
    '</div>';
  }).join('');

  body.innerHTML =
    '<div class="conversation-list">' +
      (options.showBack
        ? '<div class="conversation-subheader">' +
            '<button class="conversation-text-btn" data-conversation-back type="button"><i class="fa-solid fa-chevron-left"></i><span>Back</span></button>' +
            '<div class="conversation-view-title"><span>' + conversationEsc(note?.title || 'Untitled Note') + '</span><small>' + conversationEsc(conversationCountLabel(conversations.length)) + '</small></div>' +
            '<span class="conversation-subheader-spacer"></span>' +
          '</div>'
        : '') +
      (conversations.length
        ? '<div class="conversation-thread-list">' + rows + '</div>'
        : '<div class="conversation-empty"><i class="fa-regular fa-comments"></i><span>No Conversations Yet</span></div>') +
    '</div>';
}

function renderConversationComposer(body, anchor) {
  const recipients = conversationRecipientOptions();
  const defaultRecipient = recipients[0]?.uid || '';
  const recipientOptions = recipients.map(profile =>
    '<option value="' + conversationEsc(profile.uid) + '">' +
      conversationEsc(profile.displayName || profile.email || 'Friend') +
    '</option>'
  ).join('');

  body.innerHTML =
    '<div class="conversation-compose">' +
      '<div class="conversation-subheader">' +
        '<button class="conversation-text-btn" data-conversation-cancel-compose type="button"><i class="fa-solid fa-chevron-left"></i><span>Back</span></button>' +
        '<div class="conversation-view-title"><span>New Conversation</span><small>' + (anchor.mode === 'cursor' ? 'At cursor' : 'On highlight') + '</small></div>' +
      '</div>' +
      renderConversationAnchor(anchor) +
      (recipients.length
        ? '<div class="conversation-compose-fields">' +
            '<select class="settings-select conversation-recipient-select" id="conversation-recipient-select" aria-label="Recipient">' + recipientOptions + '</select>' +
            '<textarea class="conversation-textarea" id="conversation-new-message" rows="5" maxlength="1200" placeholder="Write the first message..." aria-label="Message"></textarea>' +
          '</div>' +
          '<div class="conversation-actions"><button class="modal-btn" data-conversation-cancel-compose type="button">Cancel</button><button class="modal-btn primary" id="conversation-create-btn" type="button"><i class="fa-solid fa-paper-plane" style="margin-right:6px;"></i>Start</button></div>'
        : '<div class="conversation-empty compact"><i class="fa-solid fa-user-group"></i><span>No Friends Available</span></div>') +
    '</div>';

  const select = document.getElementById('conversation-recipient-select');
  if (select && defaultRecipient) select.value = defaultRecipient;
}

function renderConversationDetail(body, conv) {
  if (!conv) {
    body.innerHTML =
      '<div class="conversation-detail">' +
        '<div class="conversation-subheader"><button class="conversation-text-btn" data-conversation-back type="button"><i class="fa-solid fa-chevron-left"></i><span>Back</span></button></div>' +
        '<div class="conversation-empty"><i class="fa-regular fa-comments"></i><span>Loading Conversation</span></div>' +
      '</div>';
    return;
  }

  const messages = conversationMessages[conv.id] || [];
  const locationLabel = conversationLocationLabel(conv);
  const messageRows = messages.map(message => {
    const mine = message.authorUid === userId;
    const profile = conversationProfileByUid(message.authorUid, conv);
    return '<div class="conversation-message' + (mine ? ' mine' : '') + '">' +
      renderProfileAvatar({ ...profile, displayName: message.authorName || profile.displayName, photoURL: message.authorPhotoURL || profile.photoURL, photoURLCandidates: message.authorPhotoURLCandidates || profile.photoURLCandidates || [] }) +
      '<div class="conversation-bubble">' +
        '<div class="conversation-message-meta">' + conversationEsc(mine ? 'You' : (message.authorName || profile.displayName || 'Friend')) + ' &middot; ' + conversationEsc(relativeNotificationTime(message.created)) + '</div>' +
        '<div class="conversation-message-body">' + conversationEsc(message.body) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  body.innerHTML =
    '<div class="conversation-detail">' +
      '<div class="conversation-subheader">' +
        '<button class="conversation-text-btn" data-conversation-back type="button"><i class="fa-solid fa-chevron-left"></i><span>Back</span></button>' +
        '<div class="conversation-view-title" title="' + conversationEsc(locationLabel) + '"><span>' + conversationEsc(locationLabel) + '</span><small>' + conversationEsc(conversationMessageCountLabel(messages.length)) + '</small></div>' +
        '<button class="conversation-text-btn" data-conversation-toggle-resolved="' + conversationEsc(conv.id) + '" type="button">' +
          '<i class="fa-solid ' + (conv.resolved ? 'fa-rotate-left' : 'fa-check') + '"></i><span>' + (conv.resolved ? 'Reopen' : 'Resolve') + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="conversation-detail-context">' +
        renderConversationAnchor(conv, { button: true }) +
      '</div>' +
      '<div class="conversation-messages">' + (messageRows || '<div class="conversation-empty compact"><span>No Messages Yet</span></div>') + '</div>' +
      '<div class="conversation-reply">' +
        '<textarea class="conversation-textarea" id="conversation-reply-input" rows="3" maxlength="1200" placeholder="Reply..."></textarea>' +
        '<button class="conversation-send-btn" id="conversation-send-btn" type="button" title="Send Reply" aria-label="Send Reply"><i class="fa-solid fa-paper-plane"></i></button>' +
      '</div>' +
    '</div>';

  markConversationNotificationsRead(conv.id);
  setTimeout(() => {
    const list = body.querySelector('.conversation-messages');
    if (list) list.scrollTop = list.scrollHeight;
  }, 0);
}

function openConversationNoteOverview(noteId) {
  if (!noteId) return;
  activeConversationId = null;
  conversationComposeAnchor = null;
  setConversationBrowseScope('note', {
    noteId
  });
  if (notes[noteId] && activeId !== noteId) openNote(noteId);
  else renderConversationsSidebar();
}

function navigateConversationBack() {
  if (activeConversationId) {
    activeConversationId = null;
    renderConversationsSidebar();
    return;
  }
  if (conversationBrowseView === 'note') {
    setConversationBrowseScope('all');
    renderConversationsSidebar();
    return;
  }
}

function attachConversationSidebarEvents(body) {
  body.querySelectorAll('[data-conversation-note]').forEach(btn => {
    btn.addEventListener('click', () => openConversationNoteOverview(btn.dataset.conversationNote));
  });
  body.querySelectorAll('[data-conversation-open]').forEach(btn => {
    btn.addEventListener('click', () => selectConversation(btn.dataset.conversationOpen));
  });
  body.querySelectorAll('[data-conversation-back]').forEach(btn => {
    btn.addEventListener('click', navigateConversationBack);
  });
  body.querySelectorAll('[data-conversation-cancel-compose]').forEach(btn => {
    btn.addEventListener('click', () => {
      conversationComposeAnchor = null;
      renderConversationsSidebar();
    });
  });
  body.querySelectorAll('[data-conversation-focus-anchor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const conversation = conversationById(btn.dataset.conversationFocusAnchor);
      if (!conversation) return;
      if (conversation.noteId && notes[conversation.noteId] && activeId !== conversation.noteId) {
        openNote(conversation.noteId);
        setTimeout(() => focusConversationAnchor(conversationById(conversation.id)), 120);
        return;
      }
      focusConversationAnchor(conversation);
    });
  });
  body.querySelectorAll('[data-conversation-toggle-resolved]').forEach(btn => {
    btn.addEventListener('click', () => {
      const conversation = conversationById(btn.dataset.conversationToggleResolved);
      setConversationResolved(btn.dataset.conversationToggleResolved, !conversation?.resolved);
    });
  });
  body.querySelectorAll('[data-conversation-delete-subject]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openConversationSubjectDeleteModal(btn.dataset.conversationDeleteSubject);
    });
  });
  document.getElementById('conversation-create-btn')?.addEventListener('click', createConversationFromComposer);
  document.getElementById('conversation-send-btn')?.addEventListener('click', sendActiveConversationReply);
  document.getElementById('conversation-reply-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendActiveConversationReply();
  });
  document.getElementById('conversation-new-message')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createConversationFromComposer();
  });
}

function renderConversationsSidebar() {
  const sidebar = document.getElementById('conversation-sidebar');
  const body = document.getElementById('conversation-sidebar-body');
  const noteTitle = document.getElementById('conversation-note-title');
  const panelTitle = document.getElementById('conversation-panel-title-text');
  if (!sidebar || !body) return;
  setupConversationPanelChrome();

  sidebar.classList.toggle('open', !!conversationsOpen);
  sidebar.setAttribute('aria-hidden', conversationsOpen ? 'false' : 'true');
  sidebar.dataset.conversationView = conversationComposeAnchor
    ? 'compose'
    : (activeConversationId ? 'detail' : (conversationBrowseView === 'note' ? 'note' : 'overview'));
  document.getElementById('app')?.classList.toggle('conversations-open', !!conversationsOpen);
  const toggleBtn = document.getElementById('conversation-toggle-btn');
  toggleBtn?.classList.toggle('active', !!conversationsOpen);
  toggleBtn?.setAttribute('aria-pressed', conversationsOpen ? 'true' : 'false');

  if (panelTitle) panelTitle.textContent = conversationPanelTitle();
  if (noteTitle) noteTitle.textContent = conversationScopeTitle();

  if (conversationComposeAnchor) renderConversationComposer(body, conversationComposeAnchor);
  else if (activeConversationId) renderConversationDetail(body, conversationById(activeConversationId));
  else if (conversationBrowseView === 'note' && conversationBrowseNoteId) {
    renderConversationList(body, conversationsForNote(conversationBrowseNoteId), {
      noteId: conversationBrowseNoteId,
      showBack: true
    });
  } else {
    renderConversationNoteOverview(body);
  }

  attachConversationSidebarEvents(body);
}

function focusConversationAnchor(conversation) {
  if (!conversation || activeId !== conversation.noteId) return;
  const ed = getEd();
  if (!ed) return;
  const mark = conversationAnchorMarkForConversation(ed, conversation.id);
  if (mark) {
    placeConversationFocusOnMark(mark);
    return;
  }
  const bookmark = conversation.anchorBookmark || {
    start: conversation.anchorStart,
    end: conversation.anchorEnd,
    collapsed: conversation.anchorStart === conversation.anchorEnd
  };
  try {
    restoreEditorSelection(ed, bookmark);
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      const el = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
  } catch (err) {
    console.warn('focus conversation anchor:', err);
  }
}

async function ensureConversationRecipientAccess(note, recipient) {
  if (!note || !recipient?.uid) return false;
  if (!isOwnedNote(note)) return true;
  const existing = noteAccessForProfile(note.id, recipient);
  if (existing?.noteShared || existing?.directRole === 'editor') return true;
  return await shareNoteWithFriend(note.id, recipient, 'editor', {}, { silent: true });
}

function conversationParentPayload(note, anchor, recipient) {
  const sender = currentUserConversationProfile();
  const participantUids = [...new Set([userId, recipient.uid].filter(Boolean))];
  const participantNames = {};
  participantNames[userId] = sender.displayName || 'You';
  participantNames[recipient.uid] = recipient.displayName || recipient.email || 'Friend';
  const now = new Date().toISOString();
  return {
    noteId: note.id,
    noteTitle: note.title || 'Untitled Note',
    createdBy: userId,
    createdByName: sender.displayName || 'Someone',
    participantUids,
    participantNames,
    anchor: {
      mode: anchor.mode,
      text: anchor.text || '',
      context: anchor.context || '',
      start: anchor.start || 0,
      end: anchor.end || anchor.start || 0,
      bookmark: anchor.bookmark || null
    },
    anchorMode: anchor.mode,
    anchorText: anchor.text || '',
    anchorContext: anchor.context || '',
    anchorStart: anchor.start || 0,
    anchorEnd: anchor.end || anchor.start || 0,
    anchorBookmark: anchor.bookmark || null,
    resolved: false,
    createdIso: now,
    modifiedIso: now,
    created: serverTimestamp(),
    modified: serverTimestamp()
  };
}

function conversationMessagePayload(conversation, body) {
  const sender = currentUserConversationProfile();
  const now = new Date().toISOString();
  return {
    conversationId: conversation.id,
    noteId: conversation.noteId,
    authorUid: userId,
    authorName: sender.displayName || 'Someone',
    authorEmail: normalizeEmail(sender.email || ''),
    authorPhotoURL: sender.photoURL || '',
    authorPhotoURLCandidates: sender.photoURLCandidates || [],
    body,
    createdIso: now,
    created: serverTimestamp()
  };
}

async function createConversationFromComposer() {
  if (_conversationStarting) return;
  const note = activeId ? notes[activeId] : null;
  const anchor = conversationComposeAnchor;
  const recipientUid = document.getElementById('conversation-recipient-select')?.value || '';
  const body = String(document.getElementById('conversation-new-message')?.value || '').trim();
  if (!note || !anchor) return;
  if (!recipientUid) { showToast('Choose A Friend', 'error'); return; }
  if (!body) { document.getElementById('conversation-new-message')?.focus(); return; }
  const recipient = conversationRecipientByUid(recipientUid);
  _conversationStarting = true;
  document.getElementById('conversation-create-btn')?.setAttribute('disabled', '');
  try {
    const accessOk = await ensureConversationRecipientAccess(note, recipient);
    if (!accessOk) {
      showToast('Could Not Share Note', 'error');
      return;
    }
    const conversationId = conversationDocId('conversation');
    const parentPayload = conversationParentPayload(note, anchor, recipient);
    await setDoc(doc(fsDb, 'noteConversations', conversationId), parentPayload);
    const conversation = normalizeConversation(conversationId, parentPayload);
    noteConversations[conversationId] = conversation;
    allConversations[conversationId] = conversation;
    conversationComposeAnchor = null;
    activeConversationId = conversationId;
    applyConversationAnchorMark(conversationId, anchor).catch(err => console.warn('save conversation anchor mark:', err));
    await writeConversationMessage(conversation, body);
    renderConversationsSidebar();
    showToast('Conversation Started', 'success');
  } catch (err) {
    console.error('create conversation:', err);
    showToast('Could Not Start Conversation', 'error');
  } finally {
    _conversationStarting = false;
    document.getElementById('conversation-create-btn')?.removeAttribute('disabled');
  }
}

async function writeConversationMessage(conversation, body) {
  if (!conversation?.id || !body.trim()) return null;
  const messageId = conversationDocId('message');
  const payload = conversationMessagePayload(conversation, body.trim());
  const preview = conversationText(body, 160);
  const now = payload.createdIso;
  const messageRef = doc(fsDb, 'noteConversations', conversation.id, 'messages', messageId);
  const conversationRef = doc(fsDb, 'noteConversations', conversation.id);

  await setDoc(messageRef, payload);
  await setDoc(conversationRef, {
    noteTitle: notes[conversation.noteId]?.title || conversation.noteTitle || 'Untitled Note',
    lastMessagePreview: preview,
    lastMessageBy: userId,
    lastMessageAtIso: now,
    lastMessageAt: serverTimestamp(),
    modifiedIso: now,
    modified: serverTimestamp()
  }, { merge: true });

  const message = normalizeConversationMessage(messageId, payload);
  const existingMessages = conversationMessages[conversation.id] || [];
  conversationMessages[conversation.id] = [...existingMessages.filter(item => item.id !== messageId), message]
    .sort((a, b) => new Date(a.created) - new Date(b.created));
  const updatedConversation = {
    ...conversation,
    lastMessagePreview: preview,
    lastMessageBy: userId,
    lastMessageAt: now,
    modified: now
  };
  noteConversations[conversation.id] = updatedConversation;
  allConversations[conversation.id] = updatedConversation;

  const delivered = await notifyConversationParticipants(updatedConversation, message);
  if (!delivered) showToast('Message Sent; Alert Delivery Failed', 'error');
  return message;
}

async function sendActiveConversationReply() {
  if (_conversationSending) return;
  const conversation = conversationById(activeConversationId);
  const input = document.getElementById('conversation-reply-input');
  const body = String(input?.value || '').trim();
  if (!conversation || !body) {
    input?.focus();
    return;
  }
  _conversationSending = true;
  document.getElementById('conversation-send-btn')?.setAttribute('disabled', '');
  try {
    await writeConversationMessage(conversation, body);
    if (input) input.value = '';
    renderConversationsSidebar();
  } catch (err) {
    console.error('send conversation reply:', err);
    showToast('Could Not Send Message', 'error');
  } finally {
    _conversationSending = false;
    document.getElementById('conversation-send-btn')?.removeAttribute('disabled');
  }
}

function canDeleteConversationSubject(conversation) {
  if (!conversation?.id) return false;
  const note = conversation?.noteId ? notes[conversation.noteId] : null;
  return conversation.createdBy === userId || (note && isOwnedNote(note));
}

function openConversationSubjectDeleteModal(conversationId) {
  const conversation = conversationById(conversationId);
  if (!conversation || !canDeleteConversationSubject(conversation)) return;

  _deletePending = { type: 'conversation-subject', conversationId };
  const titleEl = document.getElementById('delete-modal-title');
  const bodyEl = document.getElementById('delete-modal-body');
  const confirmBtn = document.getElementById('delete-modal-confirm');
  if (!titleEl || !bodyEl || !confirmBtn) return;

  titleEl.textContent = 'Delete Conversation?';
  bodyEl.className = 'delete-message';
  bodyEl.innerHTML =
    '<strong class="delete-target">' + conversationEsc(conversationAnchorCopy(conversation) || 'Conversation') + '</strong>' +
    '<div class="delete-copy">Deletes this conversation and all of its messages. This cannot be undone.</div>';
  confirmBtn.innerHTML = '<i class="fa-solid fa-trash" style="margin-right:6px;"></i>Delete Conversation';
  document.getElementById('delete-modal')?.classList.add('open');
}

async function deleteConversationDocuments(conversationId) {
  const parentRef = doc(fsDb, 'noteConversations', conversationId);
  const messagesSnap = await getDocs(collection(fsDb, 'noteConversations', conversationId, 'messages'));
  const messageRefs = [];
  messagesSnap.forEach(messageSnap => messageRefs.push(messageSnap.ref));

  for (let i = 0; i < messageRefs.length; i += 450) {
    const batch = writeBatch(fsDb);
    messageRefs.slice(i, i + 450).forEach(ref => batch.delete(ref));
    await batch.commit();
  }

  const parentBatch = writeBatch(fsDb);
  parentBatch.delete(parentRef);
  await parentBatch.commit();
}

async function removeConversationAnchorFromNote(conversation) {
  const note = conversation?.noteId ? notes[conversation.noteId] : null;
  if (!conversation?.id || !note || !canEditNote(note)) return true;

  if (activeId === note.id) {
    const ed = getEd();
    const mark = conversationAnchorMarkForConversation(ed, conversation.id);
    if (!mark) return true;
    pushUndo();
    unwrapConversationAnchorMark(mark);
    refreshEmpty(ed);
    if (!syncActiveNoteFromEditor()) {
      commitUndoSnapshot();
      return false;
    }
    scheduleUndoSnapshot();
    renderSidebar();
    return await saveDoc(note);
  }

  const root = document.createElement('div');
  root.innerHTML = note.content || '';
  const mark = conversationAnchorMarkForConversation(root, conversation.id);
  if (!mark) return true;
  unwrapConversationAnchorMark(mark);
  note.content = root.innerHTML;
  note.modified = new Date().toISOString();
  renderSidebar();
  return await saveDoc(note);
}

function removeConversationLocal(conversationId) {
  delete noteConversations[conversationId];
  delete allConversations[conversationId];
  delete conversationMessages[conversationId];
  unsubscribeConversationMessages(conversationId);
  if (activeConversationId === conversationId) activeConversationId = null;
}

async function deleteConversationSubject(conversationId) {
  if (_conversationDeletingSubject) return;
  const conversation = conversationById(conversationId);
  if (!conversation || !canDeleteConversationSubject(conversation)) {
    showToast('Could Not Delete Conversation', 'error');
    return;
  }

  _conversationDeletingSubject = true;
  renderConversationsSidebar();

  try {
    const anchorRemoved = await removeConversationAnchorFromNote(conversation);
    if (!anchorRemoved) throw new Error('Conversation subject marker could not be removed from the note.');
    await deleteConversationDocuments(conversationId);
    await markConversationNotificationsRead(conversationId);
    removeConversationLocal(conversationId);
    updateConversationRailBadge();
    showToast('Conversation Deleted', 'success');
  } catch (err) {
    console.error('delete conversation subject:', err);
    showToast('Could Not Delete Conversation', 'error');
  } finally {
    _conversationDeletingSubject = false;
    renderConversationsSidebar();
  }
}

async function setConversationResolved(conversationId, resolved) {
  const conversation = conversationById(conversationId);
  if (!conversation) return;
  const previousResolved = !!conversation.resolved;
  const modified = new Date().toISOString();
  if (noteConversations[conversationId]) {
    noteConversations[conversationId].resolved = !!resolved;
    noteConversations[conversationId].modified = modified;
  }
  if (allConversations[conversationId]) {
    allConversations[conversationId].resolved = !!resolved;
    allConversations[conversationId].modified = modified;
  }
  renderConversationsSidebar();
  try {
    await setDoc(doc(fsDb, 'noteConversations', conversationId), {
      resolved: !!resolved,
      modifiedIso: modified,
      modified: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error('resolve conversation:', err);
    if (noteConversations[conversationId]) noteConversations[conversationId].resolved = previousResolved;
    if (allConversations[conversationId]) allConversations[conversationId].resolved = previousResolved;
    renderConversationsSidebar();
    showToast('Could Not Update Conversation', 'error');
  }
}

function conversationNotificationPayload(conversation, message, targetUid) {
  const sender = currentUserConversationProfile();
  const recipient = conversationProfileByUid(targetUid, conversation);
  const notificationId = ('conversation_' + conversation.id + '_' + message.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
  return {
    id: notificationId,
    type: 'conversation',
    noteId: conversation.noteId,
    noteTitle: notes[conversation.noteId]?.title || conversation.noteTitle || 'Untitled Note',
    conversationId: conversation.id,
    messageId: message.id,
    anchorText: conversationAnchorCopy(conversation),
    messagePreview: conversationText(message.body, 180),
    recipientUid: targetUid,
    recipientProfileKey: targetUid,
    recipientName: recipient.displayName || '',
    recipientEmail: normalizeEmail(recipient.email || ''),
    fromUid: userId,
    fromName: sender.displayName || 'Someone',
    fromPhotoURL: sender.photoURL || '',
    fromPhotoURLCandidates: sender.photoURLCandidates || [],
    fromEmail: normalizeEmail(sender.email || ''),
    createdIso: message.created,
    created: serverTimestamp()
  };
}

async function deliverConversationNotification(conversation, message, targetUid) {
  if (!targetUid || targetUid === userId) return true;
  const payload = conversationNotificationPayload(conversation, message, targetUid);
  const writes = [setDoc(doc(fsDb, 'profileShares', targetUid, 'items', payload.id), payload, { merge: true })];
  if (payload.recipientEmail) {
    writes.push(setDoc(doc(fsDb, 'profileEmailShares', emailProfileDocId(payload.recipientEmail), 'items', payload.id), payload, { merge: true }));
  }
  const results = await Promise.allSettled(writes);
  if (results.some(result => result.status === 'rejected')) console.warn('conversation notification delivery:', results);
  return results.some(result => result.status === 'fulfilled');
}

async function notifyConversationParticipants(conversation, message) {
  const targets = [...new Set((conversation.participantUids || []).filter(uid => uid && uid !== userId))];
  if (!targets.length) return true;
  const results = await Promise.all(targets.map(uid => deliverConversationNotification(conversation, message, uid)));
  renderNotificationButton();
  if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
  refreshOpenSidebarPage('notifications');
  return results.every(Boolean);
}

function selectionRangeIsInEditor() {
  const ed = getEd();
  const sel = window.getSelection();
  if (!ed || !sel || !sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const owner = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!owner || !ed.contains(owner) || !range.toString().trim()) return null;
  return range;
}

function hideConversationSelectionPopover() {
  const pop = document.getElementById('conversation-selection-popover');
  if (pop) pop.hidden = true;
}

function scheduleConversationSelectionPopover() {
  clearTimeout(_conversationSelectionTimer);
  _conversationSelectionTimer = setTimeout(renderConversationSelectionPopover, 80);
}

function renderConversationSelectionPopover() {
  const pop = document.getElementById('conversation-selection-popover');
  if (!pop || !activeId || !canStartConversationOnNote(notes[activeId])) {
    hideConversationSelectionPopover();
    return;
  }
  const range = selectionRangeIsInEditor();
  if (!range) {
    hideConversationSelectionPopover();
    return;
  }
  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) {
    hideConversationSelectionPopover();
    return;
  }
  pop.hidden = false;
  requestAnimationFrame(() => {
    const width = pop.offsetWidth || 38;
    const left = Math.max(10, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 10));
    const top = Math.max(10, rect.top - (pop.offsetHeight || 38) - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  });
}
