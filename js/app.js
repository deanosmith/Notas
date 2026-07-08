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
configureTestPasswordAuthUI();

function openShortcutsModal() {
  document.getElementById('shortcuts-modal')?.classList.add('open');
}

function closeShortcutsModal() {
  document.getElementById('shortcuts-modal')?.classList.remove('open');
}

function closeSettingsModal() {
  document.getElementById('color-popover')?.setAttribute('hidden', '');
  document.getElementById('accent-picker-btn')?.setAttribute('aria-expanded', 'false');
  document.getElementById('settings-modal')?.classList.remove('open');
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
  if (typeof navigateAlternatingNoteHistory === 'function' && navigateAlternatingNoteHistory()) {
    return true;
  }
  return false;
}

document.getElementById('drawer-btn').addEventListener('click',     toggleDrawer);
document.getElementById('mob-logo-btn').addEventListener('click',   toggleDrawer);
document.getElementById('sidebar-logo-btn').addEventListener('click', showSidebarHomeFromLogo);
document.getElementById('app-back-btn')?.addEventListener('click', () => navigateNoteHistory('back'));
document.getElementById('app-forward-btn')?.addEventListener('click', () => navigateNoteHistory('forward'));
document.getElementById('sidebar').addEventListener('click', () => { if (sidebarMinimized && !isMobile()) setSidebarMinimized(false); });
document.querySelectorAll('[data-sidebar-view]').forEach(btn => {
  btn.addEventListener('click', () => toggleSidebarView(btn.dataset.sidebarView));
});
document.getElementById('rail-create-btn')?.addEventListener('click', () => openModal('note'));
document.getElementById('shortcuts-btn')?.addEventListener('click', openShortcutsModal);
document.getElementById('shortcuts-close')?.addEventListener('click', closeShortcutsModal);
document.getElementById('shortcuts-modal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeShortcutsModal(); });
document.getElementById('mob-new-btn').addEventListener('click',    openModal);
document.getElementById('google-signin-btn').addEventListener('click', signInWithGoogle);
document.getElementById('test-password-signin-form')?.addEventListener('submit', signInWithTestPassword);
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
document.getElementById('connect-profile-btn')?.addEventListener('click', connectProfileByEmail);
document.getElementById('connect-profile-email-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') connectProfileByEmail();
});
document.getElementById('profile-link-approve').addEventListener('click', approvePendingProfileLink);
document.getElementById('profile-link-deny').addEventListener('click', denyPendingProfileLink);
document.getElementById('profile-link-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeProfileLinkApproval(); });
document.getElementById('share-btn').addEventListener('click',       () => openShareModal('note', activeId));
document.getElementById('share-link-toggle').addEventListener('change', e => setShareLinkEnabled(e.target.checked));
document.getElementById('copy-link-btn').addEventListener('click',   copyShareLink);
document.getElementById('native-share-btn').addEventListener('click', nativeShare);
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

editorEl.addEventListener('beforeinput', e => {
  if (typeof protectConversationAnchorDeletion === 'function' && protectConversationAnchorDeletion(e, editorEl)) {
    e.preventDefault();
    return;
  }
  refreshUndoSnapshotSelection();
  if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
    _capitalizeNext = true;
  }
});

editorEl.addEventListener('input', e => {
  const tableTitleInput = e.target.closest?.('[data-table-title-input]');
  if (tableTitleInput) tableTitleInput.setAttribute('value', tableTitleInput.value || '');
  if (_capitalizeNext && e.inputType === 'insertText' && e.data) {
    if (/[a-z]/.test(e.data[0])) capitalizeCurrentChar(e.data.length);
    _capitalizeNext = false;
  } else if (_capitalizeNext && e.inputType && e.inputType !== 'insertParagraph' && e.inputType !== 'insertLineBreak') {
    _capitalizeNext = false;
  }
  cleanupLiveInlineCodeBoundaries(editorEl, e);
  decorateTables(editorEl);
  decorateNoteImages(editorEl);
  recomputeCollapsedSections();
  refreshEmpty(editorEl);
  if (!syncActiveNoteFromEditor()) return;
  markEditorHistoryTouched();
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('alarms');
  renderMentionPopover();
  scheduleUndoSnapshot();
  scheduleMentionSync();
  scheduleSave();
});

editorEl.addEventListener('blur', () => {
  setTimeout(hideMentionPopover, 120);
  if (hasLinkifiableTextNodes(editorEl)) pushUndo();
  const changed = linkifyTextNodes(editorEl);
  ensureLinkAttrs(editorEl);
  refreshEmpty(editorEl);
  if (changed && syncActiveNoteFromEditor()) {
    scheduleUndoSnapshot();
    scheduleSave();
  } else if (_undoTransactionOpen) {
    scheduleUndoSnapshot();
  }
});

editorEl.addEventListener('keyup', () => {
  renderMentionPopover();
  refreshUndoSnapshotSelection();
  scheduleConversationSelectionPopover();
});
editorEl.addEventListener('mouseup', () => {
  refreshUndoSnapshotSelection();
  scheduleConversationSelectionPopover();
});
editorEl.addEventListener('scroll', hideConversationSelectionPopover);
document.addEventListener('selectionchange', () => {
  if (typeof syncSelectedNoteImageState === 'function') syncSelectedNoteImageState(editorEl);
  scheduleConversationSelectionPopover();
});

editorEl.addEventListener('pointerdown', e => {
  const imageResizeHandle = e.target.closest?.('[data-note-image-resize]');
  if (imageResizeHandle && editorEl.contains(imageResizeHandle)) {
    startNoteImageResize(e, imageResizeHandle);
    return;
  }
  const reorderHandle = e.target.closest?.('[data-table-reorder]');
  if (reorderHandle && editorEl.contains(reorderHandle)) {
    startTableReorder(e, reorderHandle);
    return;
  }
  const resizeHandle = e.target.closest?.('[data-table-resize]');
  if (!resizeHandle || !editorEl.contains(resizeHandle)) return;
  startTableColumnResize(e, resizeHandle);
});

editorEl.addEventListener('mousedown', e => {
  const tableBtn = e.target.closest('[data-table-action]');
  if (!tableBtn || !editorEl.contains(tableBtn)) return;
  e.preventDefault();
  e.stopPropagation();
  handleTableControl(tableBtn);
});

editorEl.addEventListener('click', e => {
  const imageResizeHandle = e.target.closest?.('[data-note-image-resize]');
  if (imageResizeHandle && editorEl.contains(imageResizeHandle)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const reorderHandle = e.target.closest?.('[data-table-reorder]');
  if (reorderHandle && editorEl.contains(reorderHandle)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const tableBtn = e.target.closest('[data-table-action]');
  if (tableBtn && editorEl.contains(tableBtn)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const imageBlock = e.target.closest?.('.note-image-block');
  if (imageBlock && editorEl.contains(imageBlock) && typeof selectNoteImageBlock === 'function') {
    e.preventDefault();
    e.stopPropagation();
    selectNoteImageBlock(imageBlock);
    return;
  }
  if (typeof clearSelectedNoteImages === 'function') clearSelectedNoteImages(editorEl);
  const li = e.target.closest('ul.checklist > li');
  if (li && editorEl.contains(li)) {
    const relX = e.clientX - li.getBoundingClientRect().left;
    if (relX >= 0 && relX <= 20) {
      e.preventDefault();
      pushUndo();
      const ul = li.closest('ul.checklist');
      li.classList.toggle('checked');
      if (li.classList.contains('checked')) {
        ul.appendChild(li);
      } else {
        const firstChecked = ul.querySelector('li.checked');
        firstChecked ? ul.insertBefore(li, firstChecked) : ul.prepend(li);
      }
      scheduleUndoSnapshot();
      if (syncActiveNoteFromEditor()) scheduleSave();
      return;
    }
  }
  const heading = e.target.closest('h1, h2, h3, h4');
  if (heading && editorEl.contains(heading)) {
    const rect = heading.getBoundingClientRect();
    if (e.clientX - rect.left < 20) {
      e.preventDefault();
      heading.toggleAttribute('data-collapsed');
      recomputeCollapsedSections();
      saveCollapsedState(activeId);
      return;
    }
  }
  const alarmMark = e.target.closest('.note-alarm');
  if (alarmMark && editorEl.contains(alarmMark)) {
    const rect = alarmMark.getBoundingClientRect();
    if (e.clientX - rect.left <= 24 && canEditNote(notes[activeId])) {
      e.preventDefault();
      e.stopPropagation();
      selectAlarmMarkText(alarmMark);
      openNoteAlarmModal(activeId);
      return;
    }
  }
  const conversationMark = e.target.closest('.note-conversation-anchor');
  if (conversationMark && editorEl.contains(conversationMark) && typeof openConversationFromMarker === 'function') {
    e.preventDefault();
    e.stopPropagation();
    openConversationFromMarker(conversationMark);
    return;
  }
  const link = e.target.closest('a[href]');
  if (!link) return;
  e.preventDefault();
  window.open(link.href, '_blank', 'noopener,noreferrer');
});

editorEl.addEventListener('keydown', e => {
  if (e.target.closest?.('[data-table-title-input]')) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
    e.stopPropagation();
    return;
  }
  if (handleMentionKeydown(e)) return;
  const inTable = isSelectionInTable();
  const plainArrowKey = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.isComposing;

  if (plainArrowKey && e.key === 'ArrowDown') {
    if (!inTable && moveCaretBeyondHeaderDomainEnd()) {
      e.preventDefault();
      return;
    }
    if (insertCleanLineBelowCaret()) {
      e.preventDefault();
      return;
    }
  }

  if (plainArrowKey && e.key === 'ArrowUp') {
    if (insertCleanLineAboveCaret()) {
      e.preventDefault();
      return;
    }
  }

  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === ' ' && !e.isComposing) {
    if (inTable) return;
    if (applyMarkdownShortcut()) {
      e.preventDefault();
      refreshEmpty(editorEl);
      scheduleUndoSnapshot();
      if (syncActiveNoteFromEditor()) scheduleSave();
      return;
    }
    if (autoLinkTokenBeforeCaret()) {
      e.preventDefault();
      const _sel = window.getSelection();
      if (_sel && _sel.rangeCount) {
        const _r = _sel.getRangeAt(0);
        const _sp = document.createTextNode(' ');
        _r.insertNode(_sp);
        _r.setStartAfter(_sp);
        _r.collapse(true);
        _sel.removeAllRanges();
        _sel.addRange(_r);
      }
      refreshEmpty(editorEl);
      scheduleUndoSnapshot();
      if (syncActiveNoteFromEditor()) scheduleSave();
      return;
    }
  }

  if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
    const backspaceSel = window.getSelection();
    if (backspaceSel && backspaceSel.rangeCount && backspaceSel.isCollapsed) {
      const li = ancestorOfType(['li']);
      if (li && isEmptyListItem(li)) {
        e.preventDefault();
        pushUndo();
        if (removeEmptyListItem(li)) editorEl.dispatchEvent(new Event('input'));
        return;
      }

      const list = li?.parentElement;
      const firstRegularListItem = li &&
        /^(UL|OL)$/.test(list?.tagName || '') &&
        !list.classList.contains('checklist') &&
        list.parentElement === editorEl &&
        !li.previousElementSibling;
      if (firstRegularListItem && isCaretAtStartOfListItem(li)) {
        e.preventDefault();
        pushUndo();
        if (unlistLeadingListItem(li)) editorEl.dispatchEvent(new Event('input'));
        return;
      }

      if (deletePreviousTabAtCaret()) {
        e.preventDefault();
        editorEl.dispatchEvent(new Event('input'));
        return;
      }
    }

    const h = ancestorOfType(['h1','h2','h3','h4']);
    if (h) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        // Check if cursor is at the very start of the heading (no text before it)
        const checkRange = document.createRange();
        checkRange.selectNodeContents(h);
        checkRange.setEnd(range.startContainer, range.startOffset);
        const textBeforeCursor = checkRange.toString();
        if (textBeforeCursor.length === 0) {
          e.preventDefault();
          pushUndo();
          const p = document.createElement('p');
          while (h.firstChild) p.appendChild(h.firstChild);
          if (!p.textContent && !p.querySelector('br')) p.appendChild(document.createElement('br'));
          h.replaceWith(p);
          placeCursorAtStart(p);
          if (syncActiveNoteFromEditor()) {
            scheduleUndoSnapshot();
            scheduleSave();
          }
          return;
        }
      }
    }
  }

  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    if (inTable) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      editorEl.dispatchEvent(new Event('input'));
      return;
    }
    const li = ancestorOfType(['li']);
    if (li && li.closest('ul.checklist')) {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);

      // If this li is empty, exit the checklist (like bullet lists do)
      const liText = li.textContent.replace(/\u00a0/g, '').trim();
      if (!liText) {
        pushUndo();
        const parentList = li.closest('ul.checklist');
        li.remove();
        // If the list is now empty, remove it too
        if (parentList && !parentList.hasChildNodes()) parentList.remove();
        // Create a new paragraph after the list (or in its place)
        const p = document.createElement('p');
        p.appendChild(document.createElement('br'));
        if (parentList && parentList.parentNode) {
          parentList.after(p);
        } else {
          getEd().appendChild(p);
        }
        const r = document.createRange();
        r.setStart(p, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        editorEl.dispatchEvent(new Event('input'));
        return;
      }

      pushUndo();
      // Delete any selected text first
      if (!range.collapsed) range.deleteContents();

      // Extract content from cursor position to end of the li (split point)
      const tailRange = document.createRange();
      tailRange.setStart(range.startContainer, range.startOffset);
      const directNestedListAfterCaret = [...li.children].find(child => {
        if (child.tagName !== 'UL' && child.tagName !== 'OL') return false;
        if (!child.classList.contains('checklist')) return false;
        if (child.contains(range.startContainer)) return false;
        try { return range.comparePoint(child, 0) > 0; }
        catch (_) { return true; }
      });
      if (directNestedListAfterCaret) tailRange.setEndBefore(directNestedListAfterCaret);
      else tailRange.setEnd(li, li.childNodes.length);
      const tailContent = tailRange.extractContents();

      // Build new li with the extracted trailing content
      const newLi = document.createElement('li');
      newLi.appendChild(tailContent);
      // Ensure new li is focusable when tail was empty
      if (!newLi.textContent && !newLi.querySelector('br, img')) {
        newLi.appendChild(document.createElement('br'));
      }
      // Ensure original li is also focusable when it became empty
      if (!li.hasChildNodes()) {
        li.appendChild(document.createElement('br'));
      }

      li.after(newLi);
      normalizeChecklistStructure(editorEl);

      const r = document.createRange();
      r.selectNodeContents(newLi);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      _capitalizeNext = true;
      editorEl.dispatchEvent(new Event('input'));
      return;
    }
    const h = ancestorOfType(['h1','h2','h3','h4']);
    if (h) {
      e.preventDefault();
      pushUndo();
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      if (!range.collapsed) range.deleteContents();
      // Extract content after cursor into a new paragraph
      const tailRange = document.createRange();
      tailRange.setStart(range.startContainer, range.startOffset);
      tailRange.setEndAfter(h.lastChild || h);
      const tailContent = tailRange.extractContents();
      const p = document.createElement('p');
      p.appendChild(tailContent);
      if (!p.textContent && !p.querySelector('br, img')) {
        p.appendChild(document.createElement('br'));
      }
      // Ensure heading still has content
      if (!h.textContent && !h.querySelector('br, img')) {
        h.appendChild(document.createElement('br'));
      }
      // If the heading is collapsed, insert after the whole collapsed section
      // so new content lands outside the header's domain
      const isCollapsed = h.hasAttribute('data-collapsed');
      let insertAfter = h;
      if (isCollapsed) {
        const level = parseInt(h.tagName[1]);
        let sibling = h.nextElementSibling;
        while (sibling) {
          const t = sibling.tagName;
          if (/^H[1-4]$/.test(t) && parseInt(t[1]) <= level) break;
          insertAfter = sibling;
          sibling = sibling.nextElementSibling;
        }
        p.setAttribute('data-outside-collapse', level.toString());
      }
      insertAfter.after(p);
      const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      _capitalizeNext = true;
      editorEl.dispatchEvent(new Event('input'));
      return;
    }
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (inTable) {
      if (moveTableSelection(e.shiftKey ? -1 : 1)) editorEl.dispatchEvent(new Event('input'));
      return;
    }
    pushUndo();
    const checklistLi = currentChecklistItemFromSelection();
    if (checklistLi) {
      // Use custom DOM-based indent/outdent so the checklist class is preserved
      if (e.shiftKey ? checklistOutdent(checklistLi) : checklistIndent(checklistLi)) {
        getEd().dispatchEvent(new Event('input'));
      }
    } else {
      const li = ancestorOfType(['li']);
      if (li) e.shiftKey ? document.execCommand('outdent') : document.execCommand('indent');
      else document.execCommand('insertText', false, '\t');
      getEd().dispatchEvent(new Event('input'));
    }
    scheduleUndoSnapshot();
    return;
  }
});

editorEl.addEventListener('copy', e => {
  if (typeof copySelectedNoteImage === 'function' && copySelectedNoteImage(e.clipboardData)) {
    e.preventDefault();
  }
});

editorEl.addEventListener('cut', e => {
  if (typeof cutSelectedNoteImage === 'function' && cutSelectedNoteImage(e.clipboardData)) {
    e.preventDefault();
  }
});

editorEl.addEventListener('paste', e => {
  const imageFile = clipboardImageFile(e.clipboardData);
  if (imageFile) {
    e.preventDefault();
    const range = getEditorSelectionRange()?.cloneRange();
    const pastedNoteId = activeId;
    pushUndo();
    insertPastedImageFile(imageFile, range, pastedNoteId).then(ok => {
      if (!ok) scheduleUndoSnapshot();
    });
    return;
  }
  e.preventDefault();
  pushUndo();
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  const pastedHref = normalizeHttpUrlValue(text);
  if (pastedHref && applyLinkToSelection(pastedHref)) {
    editorEl.dispatchEvent(new Event('input'));
    return;
  }
  if (isSelectionInTable()) {
    let plain = text;
    if (!plain && html) {
      const temp = document.createElement('div');
      temp.innerHTML = html;
      plain = temp.innerText || temp.textContent || '';
    }
    document.execCommand('insertText', false, plain);
    editorEl.dispatchEvent(new Event('input'));
    return;
  }
  if (html) {
    // Sanitize: strip scripts, event handlers, dangerous elements and protocols
    const temp = document.createElement('div');
    temp.innerHTML = html;
    temp.querySelectorAll('script, style, iframe, object, embed, meta, link, form').forEach(el => el.remove());
    temp.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('on') || attr.name === 'srcdoc') {
          el.removeAttribute(attr.name);
        }
      }
      // Strip dangerous URI protocols from href, src, action, formaction, xlink:href
      ['href', 'src', 'action', 'formaction', 'xlink:href'].forEach(attrName => {
        const val = el.getAttribute(attrName);
        if (val && /^\s*(javascript|vbscript|data):/i.test(val)) {
          if (attrName === 'src' && safeNoteImageSrc(val)) return;
          el.removeAttribute(attrName);
        }
      });
    });
    normalizeThemeTextStyles(temp);
    stripNoteImageEditorChrome(temp);
    document.execCommand('insertHTML', false, temp.innerHTML);
  } else if (text) {
    document.execCommand('insertText', false, text);
  }
  editorEl.dispatchEvent(new Event('input'));
});

document.getElementById('toolbar').addEventListener('mousedown', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.preventDefault();
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
  if (shouldBlockTableAction(btn.dataset.action)) {
    showToast('Tables Support Simple Text Only', 'error');
    return;
  }
  if (!['link', 'alarm', 'conversation'].includes(btn.dataset.action)) pushUndo();
  ACTIONS[btn.dataset.action]?.();
  if (!['link', 'alarm', 'conversation'].includes(btn.dataset.action)) scheduleUndoSnapshot();
});

document.getElementById('doc-title').addEventListener('focus', () => {
  _docTitleUndoState = activeId && notes[activeId]
    ? { noteId: activeId, title: notes[activeId].title || 'Untitled Note' }
    : null;
});
document.getElementById('doc-title').addEventListener('input', () => {
  if (!activeId || !notes[activeId]) return;
  if (!canEditNote(notes[activeId])) return;
  notes[activeId].title    = document.getElementById('doc-title').value;
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
  scheduleSave();
});

let _searchTimer;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => renderSidebar(e.target.value), 150);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && handleEscapeNavigation()) {
    e.preventDefault();
    return;
  }
  const mod = /Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  const activeEl = document.activeElement;
  const isNativeTextUndoTarget = activeEl && activeEl !== editorEl && (
    activeEl.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName)
  );
  if (document.activeElement === editorEl) {
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (_lastUndoDomain === 'app' && appUndoStack.length) performAppUndo();
      else performUndo();
      return;
    }
    if (key === 'z' && e.shiftKey) {
      e.preventDefault();
      if (_lastRedoDomain === 'app' && appRedoStack.length) performAppRedo();
      else performRedo();
      return;
    }
    if (key === 'y') {
      e.preventDefault();
      if (_lastRedoDomain === 'app' && appRedoStack.length) performAppRedo();
      else performRedo();
      return;
    }
    if (key === 'b') { e.preventDefault(); pushUndo(); cmd('bold'); scheduleUndoSnapshot(); }
    if (key === 'i') { e.preventDefault(); pushUndo(); cmd('italic'); scheduleUndoSnapshot(); }
    if (key === 'e') { e.preventDefault(); pushUndo(); ACTIONS.code(); scheduleUndoSnapshot(); return; }
    if (key === 's' && e.shiftKey) { e.preventDefault(); pushUndo(); cmd('strikeThrough'); scheduleUndoSnapshot(); }
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
  if (key === 'p' && window.desktop?.isElectron && typeof window.openActiveDesktopNoteWindow === 'function') {
    e.preventDefault();
    window.openActiveDesktopNoteWindow();
    return;
  }
  if (key === 'n') { e.preventDefault(); openModal(); }
});

let _sx = 0;
document.addEventListener('touchstart', e => { _sx = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend',   e => {
  const dx = e.changedTouches[0].clientX - _sx;
  if (Math.abs(dx) > 52) { dx > 0 && _sx < 30 ? openDrawer() : closeDrawer(); }
}, { passive: true });

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
initSettings();
initFolderColorPicker();
renderNotificationButton();
renderAlarmButton();
renderProfileConnectionUI();
updateAppNavigationButtons();
// Apply persisted sidebar collapsed state (desktop only)
sidebarMinimized = localStorage.getItem('notas_sidebar_minimized') === '1';
if (sidebarMinimized && !isMobile()) setSidebarMinimized(true);

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
    if (intendedW < SIDEBAR_ICON_SAFE_WIDTH) {
      localStorage.removeItem(STORAGE_KEY);
      finishSidebarResize();
      setSidebarMinimized(true);
      return;
    }
    const w = Math.min(SIDEBAR_MAX, intendedW);
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
