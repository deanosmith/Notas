import * as firebase from './firebase.js';

Object.assign(window, firebase);

// Keep the extracted sections in the original shared browser scope while app.js
// owns Firebase module imports and startup sequencing.
const sectionScripts = [
  './state.js',
  './utils.js',
  './firestore.js',
  './notes.js',
  './folders.js',
  './editor.js',
  './editor-bindings.js',
  './split-view.js',
  './ui.js',
  './sharing.js',
  './conversations.js',
  './auth.js'
];

// When deployed, index.html loads this module as `app.js?v=<build-id>` so each
// release busts the browser cache. Carry that build id onto every dynamically
// injected section script so they all refresh together instead of being served
// stale from cache. In local dev there is no query string, so nothing is added.
const buildVersion = new URL(import.meta.url).searchParams.get('v');

function sectionScriptUrl(src) {
  const url = new URL(src, import.meta.url);
  if (buildVersion) url.searchParams.set('v', buildVersion);
  return url.href;
}

function loadSectionScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = sectionScriptUrl(src);
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(script);
  });
}

if (window.marked?.setOptions) {
  window.marked.setOptions({ gfm: true, breaks: true });
}

for (const src of sectionScripts) {
  await loadSectionScript(src);
}

if (window.desktop?.isElectron) {
  await loadSectionScript('./desktop.js');
}

showEditorView(false);
configureAuthLandingUI();

function openShortcutsModal() {
  if (typeof isGuestReadOnly === 'function' && isGuestReadOnly()) return;
  document.getElementById('shortcuts-modal')?.classList.add('open');
}

function closeShortcutsModal() {
  document.getElementById('shortcuts-modal')?.classList.remove('open');
}

function closeSettingsModal() {
  document.getElementById('color-popover')?.setAttribute('hidden', '');
  document.getElementById('accent-picker-btn')?.setAttribute('aria-expanded', 'false');
  document.getElementById('settings-modal')?.classList.remove('open');
  if (typeof updateMobileTabState === 'function') updateMobileTabState();
}

function closeColorPopover() {
  const colorPopover = document.getElementById('color-popover');
  if (!colorPopover || colorPopover.hidden) return false;
  colorPopover.hidden = true;
  document.getElementById('accent-picker-btn')?.setAttribute('aria-expanded', 'false');
  return true;
}

function closeOpenOverlayById(id) {
  const modal = document.getElementById(id);
  if (!modal?.classList.contains('open')) return false;
  modal.classList.remove('open');
  return true;
}

function handleEscapeNavigation() {
  if (typeof isGuestReadOnly === 'function' && isGuestReadOnly()) {
    const overlay = document.getElementById('auth-overlay');
    if (overlay && overlay.style.display === 'flex') {
      if (typeof returnToGuestNote === 'function') returnToGuestNote();
      return true;
    }
  }
  const mentionPopoverClosed = typeof hideMentionPopover === 'function' && hideMentionPopover();
  if (mentionPopoverClosed) return true;
  const conversationSelectionClosed = typeof hideConversationSelectionPopover === 'function' && hideConversationSelectionPopover();
  if (conversationSelectionClosed) return true;

  closeCtxMenu();
  closeFolderColorPicker();

  if (closeColorPopover()) return true;
  if (document.getElementById('settings-modal')?.classList.contains('open')) {
    closeSettingsModal();
    return true;
  }
  if (closeOpenOverlayById('shortcuts-modal')) return true;
  if (document.getElementById('mention-share-modal')?.classList.contains('open')) {
    closeMentionShareModal(false);
    return true;
  }
  if (document.getElementById('note-alarm-modal')?.classList.contains('open')) {
    closeNoteAlarmModal();
    return true;
  }
  if (closeOpenOverlayById('link-modal')) return true;
  if (document.getElementById('folder-modal')?.classList.contains('open')) {
    closeFolderModal();
    return true;
  }
  if (document.getElementById('delete-modal')?.classList.contains('open')) {
    closeDeleteModal();
    return true;
  }
  if (document.getElementById('move-modal')?.classList.contains('open')) {
    closeMoveModal();
    return true;
  }
  if (document.getElementById('modal')?.classList.contains('open')) {
    closeModal();
    return true;
  }
  if (closeOpenOverlayById('profile-link-modal')) return true;
  if (closeOpenOverlayById('share-modal')) return true;
  if (closeOpenOverlayById('notifications-modal')) return true;
  if (closeOpenOverlayById('alarms-modal')) return true;
  if (typeof closeConversationsSidebar === 'function' && conversationsOpen) {
    closeConversationsSidebar();
    return true;
  }
  const activeOverlay = document.activeElement?.closest?.('.modal-overlay');
  if (activeOverlay && !activeOverlay.classList.contains('open')) return true;
  if (typeof isNoteFocusMode === 'function' && isNoteFocusMode()) {
    setNoteFocusMode(false);
    return true;
  }
  if (isMobile() && document.getElementById('sidebar')?.classList.contains('open')) {
    closeDrawer();
    return true;
  }
  if (typeof navigateAlternatingNoteHistory === 'function' && navigateAlternatingNoteHistory()) {
    return true;
  }
  return false;
}

document.getElementById('drawer-btn').addEventListener('click',     toggleDrawer);
document.getElementById('mob-logo-btn').addEventListener('click', () => setSidebarView('notes'));
document.querySelectorAll('[data-mob-tab]').forEach(btn => {
  btn.addEventListener('click', () => selectMobileTab(btn.dataset.mobTab));
});
document.getElementById('sidebar-logo-btn').addEventListener('click', e => {
  toggleSidebarFromLogo(e);
});
document.getElementById('app-back-btn')?.addEventListener('click', () => navigateNoteHistory('back'));
document.getElementById('app-forward-btn')?.addEventListener('click', () => navigateNoteHistory('forward'));
document.getElementById('sidebar').addEventListener('click', () => { if (sidebarMinimized && !isMobile()) setSidebarMinimized(false); });
document.querySelectorAll('[data-sidebar-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.id === 'rail-notes-btn') toggleSidebarFromLogo();
    else toggleSidebarView(btn.dataset.sidebarView);
  });
});
document.getElementById('rail-create-btn')?.addEventListener('click', () => openModal('note'));
document.getElementById('shortcuts-btn')?.addEventListener('click', openShortcutsModal);
document.getElementById('shortcuts-close')?.addEventListener('click', closeShortcutsModal);
document.getElementById('shortcuts-modal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeShortcutsModal(); });
document.getElementById('mob-new-btn').addEventListener('click',    openModal);
document.getElementById('auth-logo-btn')?.addEventListener('click', toggleTestPasswordAuthFromLogo);
document.getElementById('early-access-form')?.addEventListener('submit', submitEarlyAccessCode);
document.getElementById('google-signin-btn').addEventListener('click', signInWithGoogle);
document.getElementById('test-password-signin-form')?.addEventListener('submit', signInWithTestPassword);
document.getElementById('guest-view-note-btn')?.addEventListener('click', () => enterGuestReadOnlyMode());
document.getElementById('guest-back-to-note-btn')?.addEventListener('click', returnToGuestNote);
document.getElementById('guest-sign-in-btn')?.addEventListener('click', showAuthOverlayFromGuest);
document.getElementById('signout-btn').addEventListener('click', () => {
  closeTransientSurfaces();
  signOut(auth);
});
document.getElementById('notifications-close').addEventListener('click', () => document.getElementById('notifications-modal').classList.remove('open'));
document.getElementById('notifications-mark-read').addEventListener('click', () => markAllNotificationsRead());
document.getElementById('notifications-delete-read')?.addEventListener('click', () => deleteReadNotifications());
document.querySelector('[data-selection-unread-for="notifications-list"]')?.addEventListener('click', () => markNotificationsUnread(selectedSidebarKeys('notifications-list')));
document.querySelector('[data-selection-delete-for="notifications-list"]')?.addEventListener('click', () => deleteReadNotifications(selectedSidebarKeys('notifications-list')));
document.getElementById('notifications-modal').addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('notifications-modal').classList.remove('open'); });
document.getElementById('alarms-close').addEventListener('click', () => document.getElementById('alarms-modal').classList.remove('open'));
document.getElementById('alarms-mark-read')?.addEventListener('click', () => markReminderItemsRead());
document.getElementById('alarms-delete-read')?.addEventListener('click', () => deleteReadReminderItems());
document.querySelector('[data-selection-unread-for="alarms-list"]')?.addEventListener('click', () => markReminderItemsUnread(selectedSidebarKeys('alarms-list')));
document.querySelector('[data-selection-delete-for="alarms-list"]')?.addEventListener('click', () => deleteReadReminderItems(selectedSidebarKeys('alarms-list')));
document.getElementById('alarms-modal').addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('alarms-modal').classList.remove('open'); });
document.getElementById('alarm-save').addEventListener('click', saveNoteAlarm);
document.getElementById('alarm-clear').addEventListener('click', () => clearNoteAlarm());
document.getElementById('alarm-cancel').addEventListener('click', closeNoteAlarmModal);
document.getElementById('note-alarm-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeNoteAlarmModal(); });
['alarm-date-input', 'alarm-time-input'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') saveNoteAlarm();
    if (e.key === 'Escape') closeNoteAlarmModal();
  });
  document.getElementById(id).addEventListener('input', updateAlarmSummary);
});
{
  const timeInput = document.getElementById('alarm-time-input');
  let wheelRemainder = 0;
  timeInput?.addEventListener('wheel', e => {
    if (document.activeElement !== timeInput && !timeInput.matches(':hover')) return;
    e.preventDefault();
    wheelRemainder += e.deltaY;
    const threshold = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 1 : 48;
    if (Math.abs(wheelRemainder) < threshold) return;
    const direction = wheelRemainder > 0 ? 1 : -1;
    wheelRemainder = 0;
    const [rawHour, rawMinute] = String(timeInput.value || '09:00').split(':').map(part => parseInt(part, 10));
    const hour = Number.isFinite(rawHour) ? rawHour : 9;
    const minute = Number.isFinite(rawMinute) ? rawMinute : 0;
    const total = (hour * 60 + minute + direction * 15 + 1440) % 1440;
    const nextHour = String(Math.floor(total / 60)).padStart(2, '0');
    const nextMinute = String(total % 60).padStart(2, '0');
    timeInput.value = nextHour + ':' + nextMinute;
    updateAlarmSummary();
  }, { passive: false });
  timeInput?.addEventListener('blur', () => { wheelRemainder = 0; });
}
document.getElementById('alarm-recipient-select')?.addEventListener('change', async () => {
  const targetUid = selectedAlarmRecipientUid();
  const note = _alarmContext?.noteId ? notes[_alarmContext.noteId] : (activeId ? notes[activeId] : null);
  const profile = targetUid ? (friends[targetUid] || linkedProfiles[targetUid]) : null;
  if (targetUid && typeof ensureProfileNoteAccessForFeature === 'function') {
    const accessOk = await ensureProfileNoteAccessForFeature(note, profile, 'reminders');
    if (!accessOk) {
      setAlarmRecipientValue('me');
      return;
    }
  }
  updateAlarmRecipientOptionState();
  updateAlarmRecipientState();
  updateAlarmSummary();
});
document.querySelectorAll('[data-alarm-date-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const date = new Date();
    if (btn.dataset.alarmDatePreset === 'tomorrow') date.setDate(date.getDate() + 1);
    if (btn.dataset.alarmDatePreset === 'next-week') date.setDate(date.getDate() + 7);
    document.getElementById('alarm-date-input').value = localDateParts(date).date;
    updateAlarmSummary();
  });
});
document.querySelectorAll('[data-alarm-time-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('alarm-time-input').value = btn.dataset.alarmTimePreset;
    updateAlarmSummary();
  });
});
document.getElementById('mention-share-confirm').addEventListener('click', () => closeMentionShareModal(true));
document.getElementById('mention-share-cancel').addEventListener('click', () => closeMentionShareModal(false));
document.getElementById('mention-share-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeMentionShareModal(false); });
document.getElementById('conversation-toggle-btn')?.addEventListener('click', () => {
  if (!document.getElementById('conversation-toggle-btn')?.dataset.sidebarView) toggleConversationsSidebar();
});
document.getElementById('conversation-close-btn')?.addEventListener('click', closeConversationsSidebar);
document.getElementById('conversation-selection-popover')?.addEventListener('mousedown', e => e.preventDefault());
document.getElementById('conversation-selection-start-btn')?.addEventListener('click', e => {
  e.preventDefault();
  openConversationComposerFromSelection();
  hideConversationSelectionPopover();
});
document.getElementById('conversation-selection-reminder-btn')?.addEventListener('click', e => {
  e.preventDefault();
  const pop = document.getElementById('conversation-selection-popover');
  const ctx = typeof selectionEditorContext === 'function' ? selectionEditorContext() : null;
  const noteId = ctx?.noteId || pop?.dataset?.noteId || activeId;
  if (ctx?.root && typeof runEditorOperationOnRoot === 'function') {
    runEditorOperationOnRoot(ctx.root, () => openNoteAlarmModal(noteId));
  } else {
    openNoteAlarmModal(noteId);
  }
  hideConversationSelectionPopover();
});
document.getElementById('connect-profile-btn')?.addEventListener('click', connectProfileByEmail);
document.getElementById('connect-profile-email-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') connectProfileByEmail();
});
document.getElementById('profile-link-approve').addEventListener('click', approvePendingProfileLink);
document.getElementById('profile-link-deny').addEventListener('click', denyPendingProfileLink);
document.getElementById('profile-link-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeProfileLinkApproval(); });
document.getElementById('note-focus-btn')?.addEventListener('click', toggleNoteFocusMode);
document.getElementById('note-focus-exit-btn')?.addEventListener('click', () => setNoteFocusMode(false));
document.getElementById('share-btn').addEventListener('click',       () => openShareModal('note', activeId));
document.getElementById('copy-link-btn').addEventListener('click',   copyShareLink);
document.getElementById('share-close').addEventListener('click',     () => document.getElementById('share-modal').classList.remove('open'));
document.getElementById('share-modal').addEventListener('click',     e => { if (e.target === e.currentTarget) document.getElementById('share-modal').classList.remove('open'); });
document.getElementById('new-folder-btn')?.addEventListener('click', openFolderModal);
document.getElementById('folder-modal-create').addEventListener('click', confirmCreateFolder);
document.getElementById('folder-modal-cancel').addEventListener('click', closeFolderModal);
document.getElementById('folder-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeFolderModal(); });
document.getElementById('folder-modal-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmCreateFolder();
  if (e.key === 'Escape') closeFolderModal();
});
document.getElementById('delete-modal-confirm').addEventListener('click', confirmDelete);
document.getElementById('delete-modal-cancel').addEventListener('click', closeDeleteModal);
document.getElementById('delete-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeDeleteModal(); });
document.getElementById('link-modal-insert').addEventListener('click', _confirmInsertLink);
document.getElementById('link-modal-cancel').addEventListener('click', () => document.getElementById('link-modal').classList.remove('open'));
document.getElementById('link-modal').addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('link-modal').classList.remove('open'); });
document.getElementById('link-modal-url').addEventListener('keydown', e => {
  if (e.key === 'Enter') _confirmInsertLink();
  if (e.key === 'Escape') document.getElementById('link-modal').classList.remove('open');
});
document.getElementById('move-modal-cancel').addEventListener('click', closeMoveModal);
document.getElementById('move-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeMoveModal(); });
document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
document.getElementById('new-note-btn')?.addEventListener('click',   openModal);
document.getElementById('empty-cta-btn').addEventListener('click',  openModal);
document.querySelectorAll('[data-create-type]').forEach(btn => {
  btn.addEventListener('click', () => setCreateModalType(btn.dataset.createType));
});
document.getElementById('modal-create').addEventListener('click',   confirmCreate);
document.getElementById('modal-cancel').addEventListener('click',   closeModal);
document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('modal-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmCreate();
  if (e.key === 'Escape') closeModal();
});

window.editorEl = document.getElementById('editor');
const editorEl = window.editorEl;
bindEditorRootListeners(editorEl);

async function pasteTextMatchingFormatting() {
  const peerBody = document.getElementById('note-split-peer-body');
  const root = (document.activeElement === peerBody && peerBody)
    || (typeof getNoteSplitActivePane === 'function' && getNoteSplitActivePane() === 'peer' && peerBody)
    || editorEl;
  if (!root || !navigator.clipboard?.readText) return;
  const selection = captureEditorSelection(root);
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (_) {
    return;
  }
  if (!text) return;
  runEditorOperationOnRoot(root, () => {
    restoreEditorSelection(root, selection);
    pushUndo();
    document.execCommand('insertText', false, text);
    root.dispatchEvent(new Event('input'));
    scheduleEditorRootUndoSnapshot(root);
  });
}

document.getElementById('toolbar').addEventListener('mousedown', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.preventDefault();
  if (typeof applyNoteSplitToolbarAction === 'function' && applyNoteSplitToolbarAction(btn.dataset.action)) return;
  if (shouldBlockTableAction(btn.dataset.action)) {
    showToast('Tables Support Simple Text Only', 'error');
    return;
  }
  if (!['link', 'alarm', 'conversation'].includes(btn.dataset.action)) pushUndo();
  ACTIONS[btn.dataset.action]?.();
  if (!['link', 'alarm', 'conversation'].includes(btn.dataset.action)) scheduleUndoSnapshot();
});
document.getElementById('toolbar').addEventListener('touchend', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.preventDefault();
  if (typeof applyNoteSplitToolbarAction === 'function' && applyNoteSplitToolbarAction(btn.dataset.action)) return;
  if (shouldBlockTableAction(btn.dataset.action)) {
    showToast('Tables Support Simple Text Only', 'error');
    return;
  }
  if (!['link', 'alarm', 'conversation'].includes(btn.dataset.action)) pushUndo();
  ACTIONS[btn.dataset.action]?.();
  if (!['link', 'alarm', 'conversation'].includes(btn.dataset.action)) scheduleUndoSnapshot();
});

function runMobileEditorHistory(direction) {
  const redo = direction === 'redo';
  const peerBody = document.getElementById('note-split-peer-body');
  const peerEditorFocused = !!peerBody && document.activeElement === peerBody;
  if (peerEditorFocused) {
    runEditorOperationOnRoot(peerBody, () => redo ? performRedo() : performUndo());
    return;
  }
  if (redo) {
    if (_lastRedoDomain === 'app' && appRedoStack.length) performAppRedo();
    else if (redoStack.length) performRedo();
    else performAppRedo();
    return;
  }
  if (_lastUndoDomain === 'app' && appUndoStack.length) performAppUndo();
  else if (undoStack.length) performUndo();
  else performAppUndo();
}

['mob-undo-btn', 'mob-redo-btn'].forEach(id => {
  const btn = document.getElementById(id);
  if (!btn) return;
  const direction = id === 'mob-redo-btn' ? 'redo' : 'undo';
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    runMobileEditorHistory(direction);
  });
});

document.getElementById('doc-title').addEventListener('focus', () => {
  _docTitleUndoState = activeId && notes[activeId]
    ? { noteId: activeId, title: notes[activeId].title || 'Untitled Note' }
    : null;
});
document.getElementById('doc-title').addEventListener('input', () => {
  if (!activeId || !notes[activeId]) return;
  if (!canEditNote(notes[activeId])) return;
  const nextTitle = document.getElementById('doc-title').value;
  if (notes[activeId].title === nextTitle) return;
  notes[activeId].title = nextTitle;
  notes[activeId].modified = new Date().toISOString();
  const el = document.querySelector('.sidebar-item.active .item-name');
  if (el) el.textContent = notes[activeId].title;
  scheduleSave();
});
document.getElementById('doc-title').addEventListener('blur', () => {
  if (!activeId || !notes[activeId]) {
    _docTitleUndoState = null;
    return;
  }
  if (!canEditNote(notes[activeId])) {
    _docTitleUndoState = null;
    return;
  }
  const previousTitle = notes[activeId].title;
  const titled = document.getElementById('doc-title').value.trim() || 'Untitled Note';
  document.getElementById('doc-title').value = titled;
  notes[activeId].title = titled;
  const el = document.querySelector('.sidebar-item.active .item-name');
  if (el) el.textContent = titled;
  if (_docTitleUndoState?.noteId === activeId) {
    recordAppHistoryAction({
      type: 'note-rename',
      noteId: activeId,
      beforeTitle: _docTitleUndoState.title,
      afterTitle: titled
    });
  }
  _docTitleUndoState = null;
  if (titled !== previousTitle) {
    notes[activeId].modified = new Date().toISOString();
    scheduleSave();
  }
});

let _searchTimer;
const sidebarSearchInput = document.getElementById('search-input');
sidebarSearchInput?.addEventListener('input', e => {
  if (typeof updateSidebarSearchControl === 'function') updateSidebarSearchControl();
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => renderSidebar(e.target.value), 150);
});
document.getElementById('search-clear-btn')?.addEventListener('click', () => {
  if (!sidebarSearchInput) return;
  clearTimeout(_searchTimer);
  sidebarSearchInput.value = '';
  if (typeof updateSidebarSearchControl === 'function') updateSidebarSearchControl();
  renderSidebar('');
  sidebarSearchInput.focus();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && handleEscapeNavigation()) {
    e.preventDefault();
    return;
  }
  const mod = /Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
  if (!mod) return;
  if (typeof isGuestReadOnly === 'function' && isGuestReadOnly()) {
    const guestKey = e.key.toLowerCase();
    if (guestKey === 'n' || guestKey === 'p' || (guestKey === 'f' && e.shiftKey)) e.preventDefault();
    return;
  }
  const key = e.key.toLowerCase();
  // Browser/Electron may still close the tab/window; Electron menu also disables this.
  if (key === 'w' && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const peerBody = document.getElementById('note-split-peer-body');
  const activeEl = document.activeElement;
  const peerEditorFocused = !!peerBody && activeEl === peerBody;
  const liveEditorFocused = activeEl === editorEl;
  const isNativeTextUndoTarget = activeEl && activeEl !== editorEl && activeEl !== peerBody && (
    activeEl.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName)
  );
  if (key === 'f' && e.shiftKey) {
    e.preventDefault();
    if (peerEditorFocused && typeof focusNoteSplitPeerFullscreen === 'function') {
      void focusNoteSplitPeerFullscreen();
      return;
    }
    toggleNoteFocusMode();
    return;
  }
  const runEditorShortcut = action => {
    if (typeof applyNoteSplitToolbarAction === 'function' && applyNoteSplitToolbarAction(action)) return;
    pushUndo();
    ACTIONS[action]?.();
    scheduleUndoSnapshot();
  };
  if (liveEditorFocused || peerEditorFocused) {
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (peerEditorFocused) {
        runEditorOperationOnRoot(peerBody, () => performUndo());
        return;
      }
      if (_lastUndoDomain === 'app' && appUndoStack.length) performAppUndo();
      else performUndo();
      return;
    }
    if (key === 'z' && e.shiftKey) {
      e.preventDefault();
      if (peerEditorFocused) {
        runEditorOperationOnRoot(peerBody, () => performRedo());
        return;
      }
      if (_lastRedoDomain === 'app' && appRedoStack.length) performAppRedo();
      else performRedo();
      return;
    }
    if (key === 'y') {
      e.preventDefault();
      if (peerEditorFocused) {
        runEditorOperationOnRoot(peerBody, () => performRedo());
        return;
      }
      if (_lastRedoDomain === 'app' && appRedoStack.length) performAppRedo();
      else performRedo();
      return;
    }
    if (key === 'b') { e.preventDefault(); runEditorShortcut('bold'); }
    if (key === 'i') { e.preventDefault(); runEditorShortcut('italic'); }
    if (key === 'e') { e.preventDefault(); runEditorShortcut('code'); return; }
    if (key === 's' && e.shiftKey) { e.preventDefault(); runEditorShortcut('strikethrough'); }
  } else if (!isNativeTextUndoTarget) {
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (_lastUndoDomain === 'editor' && undoStack.length) performUndo();
      else performAppUndo();
      return;
    }
    if (key === 'z' && e.shiftKey) {
      e.preventDefault();
      if (_lastRedoDomain === 'editor' && redoStack.length) performRedo();
      else performAppRedo();
      return;
    }
    if (key === 'y') {
      e.preventDefault();
      if (_lastRedoDomain === 'editor' && redoStack.length) performRedo();
      else performAppRedo();
      return;
    }
  }
  if (key === 'v' && e.shiftKey && liveEditorFocused) {
    e.preventDefault();
    pasteTextMatchingFormatting();
    return;
  }
  if (key === 'p' && !e.shiftKey && window.desktop?.isElectron && typeof window.openActiveDesktopNoteWindow === 'function') {
    e.preventDefault();
    window.openActiveDesktopNoteWindow();
    return;
  }
  if (key === 'n') { e.preventDefault(); openModal(); }
});

let _sx = 0;
document.addEventListener('touchstart', e => { _sx = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend',   e => {
  if (!isMobile()) return;
  if (typeof isGuestReadOnly === 'function' && isGuestReadOnly()) return;
  if (document.querySelector('.modal-overlay.open')) return;
  if (document.body.classList.contains('mob-keyboard-open')) return;
  const dx = e.changedTouches[0].clientX - _sx;
  if (Math.abs(dx) <= 52) return;
  const sidebarOpen = document.getElementById('sidebar')?.classList.contains('open');
  if (dx > 0 && _sx < 24) {
    if (sidebarOpen) return;
    if (sidebarView !== 'notes') setSidebarView('notes');
    else openDrawer();
    return;
  }
  if (dx < 0 && sidebarOpen) closeDrawer();
}, { passive: true });

function syncMobileKeyboardInset() {
  if (!isMobile()) {
    document.body.classList.remove('mob-keyboard-open');
    document.documentElement.style.removeProperty('--mob-vv-height');
    return;
  }
  const viewport = window.visualViewport;
  const visibleHeight = viewport?.height || window.innerHeight;
  const keyboardOpen = !!viewport && (window.innerHeight - visibleHeight) > 80;
  document.body.classList.toggle('mob-keyboard-open', keyboardOpen);
  document.documentElement.style.setProperty('--mob-vv-height', Math.round(visibleHeight) + 'px');
}
syncMobileKeyboardInset();
window.visualViewport?.addEventListener('resize', syncMobileKeyboardInset);
window.visualViewport?.addEventListener('scroll', syncMobileKeyboardInset);
window.addEventListener('resize', syncMobileKeyboardInset);

document.execCommand('defaultParagraphSeparator', false, 'p');

// Sidebar-list fallback drop zone — allows moving notes to "no folder"
// when the uncategorized section isn't visible (all notes are in folders)
const _sidebarList = document.getElementById('sidebar-list');
_sidebarList.addEventListener('dragover', e => {
  if (!_draggingNoteId || !notes[_draggingNoteId]?.folderId) return;
  if (e.target.closest('.sidebar-item') || e.target.closest('.folder-row') || e.target.closest('.uncat-drop-zone')) {
    _sidebarList.classList.remove('drag-over', 'uncat-drop-zone');
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  _sidebarList.classList.add('uncat-drop-zone', 'drag-over');
});
_sidebarList.addEventListener('dragleave', e => {
  if (!_sidebarList.contains(e.relatedTarget)) _sidebarList.classList.remove('drag-over', 'uncat-drop-zone');
});
_sidebarList.addEventListener('drop', e => {
  _sidebarList.classList.remove('drag-over', 'uncat-drop-zone');
  if (e.target.closest('.sidebar-item') || e.target.closest('.folder-row') || e.target.closest('.uncat-drop-zone')) return;
  const noteId = e.dataTransfer.getData('text/plain');
  if (noteId && notes[noteId] && notes[noteId].folderId) moveNoteToFolder(noteId, null);
});

renderSidebar();
initNoteSplitView?.();
initSettings();
initFolderColorPicker();
renderNotificationButton();
renderAlarmButton();
renderProfileConnectionUI();
updateAppNavigationButtons();
updateUndoRedoButtons();
updateMobileTabState();
// Always start open; only a direct logo click can fold the desktop sidebar.
localStorage.removeItem('notas_sidebar_minimized');
sidebarMinimized = false;

/* ── Sidebar Resize (desktop only) ───────────────────── */
{
  const SIDEBAR_MAX = 520;
  const STORAGE_KEY = 'notas_sidebar_w';
  const sidebar = document.getElementById('sidebar');
  const handle  = document.getElementById('sidebar-resize');

  const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '');
  if (saved >= SIDEBAR_ICON_SAFE_WIDTH && saved <= SIDEBAR_MAX) {
    sidebar.style.width    = saved + 'px';
    sidebar.style.minWidth = saved + 'px';
    updateSidebarWidthState(saved);
  } else {
    updateSidebarWidthState();
  }

  let dragging = false, startX = 0, startW = 0;

  function finishSidebarResize() {
    dragging = false;
    handle.classList.remove('dragging');
    sidebar.style.transition = '';
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  }

  handle.addEventListener('mousedown', e => {
    if (window.innerWidth <= 767) return;
    if (sidebarMinimized) return;
    dragging = true;
    startX   = e.clientX;
    startW   = sidebar.getBoundingClientRect().width;
    handle.classList.add('dragging');
    // Disable transition during drag to eliminate lag
    sidebar.style.transition = 'none';
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const intendedW = startW + (e.clientX - startX);
    const w = Math.max(SIDEBAR_ICON_SAFE_WIDTH, Math.min(SIDEBAR_MAX, intendedW));
    sidebar.style.width    = w + 'px';
    sidebar.style.minWidth = w + 'px';
    updateSidebarWidthState(w);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    finishSidebarResize();
    localStorage.setItem(STORAGE_KEY, Math.round(parseFloat(sidebar.style.width)));
    updateSidebarWidthState();
  });

  window.addEventListener('resize', () => {
    updateSidebarWidthState();
    refreshTableResizeHandles(editorEl);
  });
}
