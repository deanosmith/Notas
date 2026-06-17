/* Right-side note conversations and conversation alerts. */

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
  clearConversationMessageSubscriptions();
  noteConversations = {};
  conversationMessages = {};
  activeConversationId = null;
  conversationComposeAnchor = null;
  conversationListeningNoteId = null;
  hideConversationSelectionPopover();
  if (options.close) closeConversationsSidebar();
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
        unsubscribeConversationMessages(id);
        if (activeConversationId === id) activeConversationId = null;
        return;
      }
      noteConversations[id] = normalizeConversation(id, ch.doc.data() || {});
      subscribeConversationMessages(id);
    });
    renderConversationsSidebar();
    settleInitial();
  }, err => {
    console.warn('note conversations listener:', err);
    renderConversationsSidebar();
    settleInitial();
  });
  return initialLoad;
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

function conversationParticipantSummary(conversation) {
  const others = (conversation?.participantUids || [])
    .filter(uid => uid && uid !== userId)
    .map(uid => {
      const profile = conversationProfileByUid(uid, conversation);
      return profile.displayName || profile.email || 'Friend';
    })
    .filter(Boolean);
  if (!others.length) return 'Only you';
  if (others.length === 1) return others[0];
  return others.slice(0, 2).join(', ') + (others.length > 2 ? ' +' + (others.length - 2) : '');
}

function conversationMessageCountLabel(count) {
  const total = Number(count) || 0;
  return total + ' message' + (total === 1 ? '' : 's');
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

function openConversationsSidebar(conversationId = activeConversationId) {
  conversationsOpen = true;
  if (conversationId) activeConversationId = conversationId;
  document.getElementById('app')?.classList.add('conversations-open');
  const sidebar = document.getElementById('conversation-sidebar');
  sidebar?.classList.add('open');
  sidebar?.setAttribute('aria-hidden', 'false');
  renderConversationsSidebar();
  if (activeConversationId) {
    markConversationNotificationsRead(activeConversationId);
    setTimeout(() => {
      if (noteConversations[activeConversationId]) focusConversationAnchor(noteConversations[activeConversationId]);
    }, 80);
  }
}

function closeConversationsSidebar() {
  conversationsOpen = false;
  conversationComposeAnchor = null;
  document.getElementById('app')?.classList.remove('conversations-open');
  const sidebar = document.getElementById('conversation-sidebar');
  sidebar?.classList.remove('open');
  sidebar?.setAttribute('aria-hidden', 'true');
  renderConversationsSidebar();
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
  openConversationsSidebar(null);
  setTimeout(() => document.getElementById('conversation-new-message')?.focus(), 80);
}

function selectConversation(conversationId) {
  if (!conversationId) return;
  activeConversationId = conversationId;
  conversationComposeAnchor = null;
  openConversationsSidebar(conversationId);
}

function sortedConversations() {
  return Object.values(noteConversations || {})
    .sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      return new Date(b.modified || b.lastMessageAt || 0) - new Date(a.modified || a.lastMessageAt || 0);
    });
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
  return conversationUnreadItems(conversationId).length > 0;
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
  const label = mode === 'cursor' ? 'Cursor point' : 'Highlighted text';
  const inner =
    '<span class="conversation-anchor-icon"><i class="' + icon + '"></i></span>' +
    '<span class="conversation-anchor-copy">' +
      '<span class="conversation-anchor-label">' + label + '</span>' +
      '<span class="conversation-anchor-text">' + conversationEsc(text) + '</span>' +
    '</span>';
  if (options.button) {
    return '<button class="conversation-anchor-card as-button" data-conversation-focus-anchor="' + conversationEsc(anchorOrConversation?.id || '') + '" type="button">' +
      inner +
    '</button>';
  }
  return '<div class="conversation-anchor-card">' + inner + '</div>';
}

function renderConversationList(body, conversations) {
  const openCount = conversations.filter(conv => !conv.resolved).length;
  const resolvedCount = conversations.length - openCount;
  const rows = conversations.map(conv => {
    const messages = conversationMessages[conv.id] || [];
    const last = messages[messages.length - 1];
    const profile = conversationProfileByUid(last?.authorUid || conv.lastMessageBy || conv.createdBy, conv);
    const preview = conversationText(last?.body || conv.lastMessagePreview || conversationAnchorCopy(conv) || 'Conversation', 120);
    const unread = conversationHasUnread(conv.id);
    const status = conv.resolved ? 'Resolved' : 'Open';
    const mode = conv.anchorMode === 'cursor' ? 'Point' : 'Highlight';
    return '<button class="conversation-thread-row' + (unread ? ' unread' : '') + (conv.resolved ? ' resolved' : '') + '" data-conversation-open="' + conversationEsc(conv.id) + '" type="button">' +
      '<span class="conversation-thread-status ' + (conv.resolved ? 'resolved' : 'open') + '">' + status + '</span>' +
      '<div class="conversation-thread-head">' +
        '<div class="conversation-thread-avatar">' + renderProfileAvatar(profile) + '</div>' +
        '<div class="conversation-thread-title-wrap">' +
          '<div class="conversation-thread-anchor">' + conversationEsc(conversationAnchorCopy(conv)) + '</div>' +
          '<div class="conversation-thread-participants">' + conversationEsc(conversationParticipantSummary(conv)) + '</div>' +
        '</div>' +
        (unread ? '<span class="conversation-unread-dot"></span>' : '') +
      '</div>' +
      '<div class="conversation-thread-preview">' + conversationEsc(preview) + '</div>' +
      '<div class="conversation-thread-footer">' +
        '<span><i class="fa-solid ' + (conv.anchorMode === 'cursor' ? 'fa-location-dot' : 'fa-highlighter') + '"></i><span>' + mode + '</span></span>' +
        '<span>' + conversationEsc(conversationMessageCountLabel(messages.length)) + '</span>' +
        '<time>' + conversationEsc(relativeNotificationTime(conv.modified || conv.lastMessageAt || conv.created)) + '</time>' +
      '</div>' +
    '</button>';
  }).join('');

  body.innerHTML =
    '<div class="conversation-list">' +
      '<div class="conversation-overview">' +
        '<div><span class="conversation-overview-label">Open</span><strong>' + openCount + '</strong></div>' +
        '<div><span class="conversation-overview-label">Resolved</span><strong>' + resolvedCount + '</strong></div>' +
      '</div>' +
      (conversations.length
        ? '<div class="conversation-thread-list">' + rows + '</div>'
        : '<div class="conversation-empty"><i class="fa-regular fa-comments"></i><span>No Conversations Yet</span><button class="conversation-text-btn" data-conversation-start-new type="button"><i class="fa-regular fa-comment-dots"></i><span>Start</span></button></div>') +
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
            '<label class="conversation-field"><span>To</span><select class="settings-select" id="conversation-recipient-select">' + recipientOptions + '</select></label>' +
            '<label class="conversation-field"><span>Message</span><textarea class="conversation-textarea" id="conversation-new-message" rows="5" maxlength="1200" placeholder="Write the first message..."></textarea></label>' +
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
  const messageRows = messages.map(message => {
    const mine = message.authorUid === userId;
    const profile = conversationProfileByUid(message.authorUid, conv);
    return '<div class="conversation-message' + (mine ? ' mine' : '') + '">' +
      (mine ? '' : renderProfileAvatar({ ...profile, displayName: message.authorName || profile.displayName, photoURL: message.authorPhotoURL || profile.photoURL, photoURLCandidates: message.authorPhotoURLCandidates || profile.photoURLCandidates || [] })) +
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
        '<div class="conversation-view-title"><span>' + conversationEsc(conversationParticipantSummary(conv)) + '</span><small>' + conversationEsc(conversationMessageCountLabel(messages.length)) + '</small></div>' +
        '<button class="conversation-text-btn" data-conversation-toggle-resolved="' + conversationEsc(conv.id) + '" type="button">' +
          '<i class="fa-solid ' + (conv.resolved ? 'fa-rotate-left' : 'fa-check') + '"></i><span>' + (conv.resolved ? 'Reopen' : 'Resolve') + '</span>' +
        '</button>' +
      '</div>' +
      renderConversationAnchor(conv, { button: true }) +
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

function attachConversationSidebarEvents(body) {
  body.querySelectorAll('[data-conversation-open]').forEach(btn => {
    btn.addEventListener('click', () => selectConversation(btn.dataset.conversationOpen));
  });
  body.querySelectorAll('[data-conversation-start-new]').forEach(btn => {
    btn.addEventListener('click', () => openConversationComposerFromSelection());
  });
  body.querySelectorAll('[data-conversation-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeConversationId = null;
      renderConversationsSidebar();
    });
  });
  body.querySelectorAll('[data-conversation-cancel-compose]').forEach(btn => {
    btn.addEventListener('click', () => {
      conversationComposeAnchor = null;
      renderConversationsSidebar();
    });
  });
  body.querySelectorAll('[data-conversation-focus-anchor]').forEach(btn => {
    btn.addEventListener('click', () => focusConversationAnchor(noteConversations[btn.dataset.conversationFocusAnchor]));
  });
  body.querySelectorAll('[data-conversation-toggle-resolved]').forEach(btn => {
    btn.addEventListener('click', () => setConversationResolved(btn.dataset.conversationToggleResolved, !noteConversations[btn.dataset.conversationToggleResolved]?.resolved));
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
  const startBtn = document.getElementById('conversation-start-btn');
  if (!sidebar || !body) return;

  sidebar.classList.toggle('open', !!conversationsOpen);
  sidebar.setAttribute('aria-hidden', conversationsOpen ? 'false' : 'true');
  document.getElementById('app')?.classList.toggle('conversations-open', !!conversationsOpen);

  const note = activeId ? notes[activeId] : null;
  if (noteTitle) noteTitle.textContent = note?.title || '';
  if (startBtn) startBtn.disabled = !canStartConversationOnNote(note);

  if (!note) {
    body.innerHTML = '<div class="conversation-empty"><i class="fa-regular fa-note-sticky"></i><span>No Note Selected</span></div>';
    return;
  }

  if (conversationComposeAnchor) renderConversationComposer(body, conversationComposeAnchor);
  else if (activeConversationId) renderConversationDetail(body, noteConversations[activeConversationId]);
  else renderConversationList(body, sortedConversations());

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
  noteConversations[conversation.id] = {
    ...conversation,
    lastMessagePreview: preview,
    lastMessageBy: userId,
    lastMessageAt: now,
    modified: now
  };

  const delivered = await notifyConversationParticipants(noteConversations[conversation.id], message);
  if (!delivered) showToast('Message Sent; Alert Delivery Failed', 'error');
  return message;
}

async function sendActiveConversationReply() {
  if (_conversationSending) return;
  const conversation = noteConversations[activeConversationId];
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

async function setConversationResolved(conversationId, resolved) {
  const conversation = noteConversations[conversationId];
  if (!conversation) return;
  conversation.resolved = !!resolved;
  conversation.modified = new Date().toISOString();
  renderConversationsSidebar();
  try {
    await setDoc(doc(fsDb, 'noteConversations', conversationId), {
      resolved: !!resolved,
      modifiedIso: conversation.modified,
      modified: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error('resolve conversation:', err);
    conversation.resolved = !resolved;
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
