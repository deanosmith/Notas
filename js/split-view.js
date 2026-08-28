/* Editable split-note workspace and sidebar drag controller. */

const NOTE_SPLIT_MIN_WIDTH = 960;
const NOTE_SPLIT_SAVE_DELAY = 500;
const NOTE_SPLIT_DIVIDER_WIDTH = 12;
const NOTE_SPLIT_MIN_PANE_WIDTH = 260;
const NOTE_SPLIT_STORAGE_KEY = 'notas_split_view';

let _noteSplitInitialised = false;
let _noteSplitRenderToken = 0;
let _noteSplitDrag = null;
let _noteSplitSaveTimer = null;
let _noteSplitResize = null;
let _noteSplitPeerSelection = null;
let _noteSplitRestorePending = false;
let _noteSplitRestoreState = null;
let _noteSplitFallbackState = { peerId: '', side: 'right', awaiting: false, activePane: 'live', dividerRatio: .5 };

function noteSplitState() {
  if (typeof noteSplitView !== 'undefined' && noteSplitView && typeof noteSplitView === 'object') {
    return noteSplitView;
  }
  return _noteSplitFallbackState;
}

function normaliseNoteSplitSide(side) {
  return side === 'left' ? 'left' : 'right';
}

function getNoteSplitPeerId() {
  return String(noteSplitState().peerId || '').trim();
}

function noteSplitIsAwaiting() {
  return noteSplitState().awaiting === true;
}

function noteSplitHasPane() {
  return !!getNoteSplitPeerId() || noteSplitIsAwaiting();
}

function getNoteSplitActivePane() {
  const state = noteSplitState();
  return state.activePane === 'peer' && !!getNoteSplitPeerId() ? 'peer' : 'live';
}

function setNoteSplitActivePane(pane = 'live') {
  const state = noteSplitState();
  const nextPane = pane === 'peer' && !!getNoteSplitPeerId() ? 'peer' : 'live';
  state.activePane = nextPane;
  const { editorView } = noteSplitElements();
  editorView?.classList.toggle('split-peer-active', nextPane === 'peer');
  editorView?.classList.toggle('split-live-active', nextPane === 'live');
  persistNoteSplitState();
  return nextPane;
}

function getNoteSplitActiveEditor() {
  const { peerBody } = noteSplitElements();
  if (getNoteSplitActivePane() === 'peer' && peerBody) return peerBody;
  return document.getElementById('editor');
}

function getNoteSplitActiveNoteId() {
  return getNoteSplitActivePane() === 'peer' ? getNoteSplitPeerId() : activeId;
}

function focusNoteSplitPane(pane = 'live') {
  const nextPane = setNoteSplitActivePane(pane);
  const { peerBody, peerTitle } = noteSplitElements();
  const target = nextPane === 'peer' ? (peerBody || peerTitle) : document.getElementById('editor');
  target?.focus({ preventScroll: true });
  return nextPane;
}

function setNoteSplitState(peerId = '', side = 'right', awaiting = false) {
  const state = noteSplitState();
  state.peerId = String(peerId || '').trim();
  state.side = normaliseNoteSplitSide(side || state.side);
  state.awaiting = !!awaiting && !state.peerId;
  state.activePane = state.activePane === 'peer' ? 'peer' : 'live';
  state.dividerRatio = Number.isFinite(Number(state.dividerRatio)) ? Number(state.dividerRatio) : .5;
  persistNoteSplitState();
  return state;
}

function readPersistedNoteSplitState() {
  try {
    const raw = localStorage.getItem(NOTE_SPLIT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      peerId: String(parsed.peerId || '').trim(),
      side: normaliseNoteSplitSide(parsed.side),
      awaiting: parsed.awaiting === true,
      activePane: parsed.activePane === 'peer' ? 'peer' : 'live',
      dividerRatio: Number.isFinite(Number(parsed.dividerRatio)) ? Number(parsed.dividerRatio) : .5,
      liveId: String(parsed.liveId || '').trim()
    };
  } catch {
    return null;
  }
}

function persistNoteSplitState() {
  if (_noteSplitRestorePending) return;
  try {
    if (!noteSplitHasPane()) {
      localStorage.removeItem(NOTE_SPLIT_STORAGE_KEY);
      return;
    }
    const state = noteSplitState();
    localStorage.setItem(NOTE_SPLIT_STORAGE_KEY, JSON.stringify({
      peerId: state.peerId || '',
      side: normaliseNoteSplitSide(state.side),
      awaiting: !!state.awaiting,
      activePane: state.activePane === 'peer' ? 'peer' : 'live',
      dividerRatio: Number.isFinite(Number(state.dividerRatio)) ? Number(state.dividerRatio) : .5,
      liveId: String(activeId || '').trim()
    }));
  } catch (_) {}
}

function beginInitialNoteSplitRestore() {
  if (_noteSplitRestorePending || _noteSplitRestoreState) return;
  if (document.body?.classList.contains('desktop-note-window')) return;
  if (new URLSearchParams(location.search).get('desktopWindow') === 'note') return;
  _noteSplitRestoreState = readPersistedNoteSplitState();
  _noteSplitRestorePending = !!_noteSplitRestoreState && (!!_noteSplitRestoreState.peerId || _noteSplitRestoreState.awaiting);
}

function tryRestorePersistedNoteSplit() {
  if (!_noteSplitRestorePending || !_noteSplitRestoreState) return false;
  if (!activeId || !canUseNoteSplit(false)) return false;
  const saved = _noteSplitRestoreState;
  const peerId = String(saved.peerId || '').trim();
  if (peerId) {
    if (!notes?.[peerId]) return false;
    if (!canRenderSplitPeer(peerId)) {
      _noteSplitRestorePending = false;
      _noteSplitRestoreState = null;
      localStorage.removeItem(NOTE_SPLIT_STORAGE_KEY);
      return false;
    }
    _noteSplitRestorePending = false;
    _noteSplitRestoreState = null;
    const state = setNoteSplitState(peerId, saved.side, false);
    state.dividerRatio = normaliseNoteSplitRatio(saved.dividerRatio);
    refreshNoteSplitView();
    if (saved.activePane === 'peer') setNoteSplitActivePane('peer');
    return true;
  }
  if (saved.awaiting) {
    _noteSplitRestorePending = false;
    _noteSplitRestoreState = null;
    openEmptyNoteSplit(saved.side);
    applyNoteSplitRatio(saved.dividerRatio);
    return true;
  }
  _noteSplitRestorePending = false;
  _noteSplitRestoreState = null;
  return false;
}

function selectionBelongsToRoot(root) {
  if (!root) return false;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const owner = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return !!(owner && root.contains(owner));
}

function noteSplitElements() {
  return {
    editorView: document.getElementById('editorView'),
    workspace: document.getElementById('note-workspace'),
    peerPane: document.getElementById('note-split-peer-pane'),
    peerTitle: document.getElementById('note-split-peer-title'),
    peerArea: document.getElementById('note-split-peer-area'),
    peerBody: document.getElementById('note-split-peer-body'),
    closeButton: document.getElementById('note-split-close-btn'),
    peerFocusButton: document.getElementById('note-split-peer-focus-btn'),
    toggleButton: document.getElementById('note-split-toggle-btn'),
    divider: document.getElementById('note-split-divider'),
    dropOverlay: document.getElementById('note-split-drop-overlay')
  };
}

async function focusNoteSplitPeerFullscreen() {
  const peerId = getNoteSplitPeerId();
  if (!peerId || !notes?.[peerId]) {
    if (typeof showToast === 'function') showToast('Open A Note In Split View First', 'error');
    return false;
  }
  flushSplitPeerSave();
  if (typeof openNote === 'function') await openNote(peerId);
  if (typeof setNoteFocusMode === 'function') setNoteFocusMode(true);
  return true;
}

function noteSplitRatioBounds() {
  const { workspace } = noteSplitElements();
  const width = Math.max(0, workspace?.getBoundingClientRect().width || 0);
  const available = width - NOTE_SPLIT_DIVIDER_WIDTH;
  if (available <= 0) return { min: .2, max: .8 };
  const paneMinimum = Math.min(NOTE_SPLIT_MIN_PANE_WIDTH, available * .45);
  const min = Math.max(.2, Math.min(.45, paneMinimum / available));
  return { min, max: 1 - min };
}

function normaliseNoteSplitRatio(value) {
  const ratio = Number.isFinite(Number(value)) ? Number(value) : .5;
  const { min, max } = noteSplitRatioBounds();
  return Math.min(max, Math.max(min, ratio));
}

function applyNoteSplitRatio(value = noteSplitState().dividerRatio) {
  const ratio = normaliseNoteSplitRatio(value);
  const state = noteSplitState();
  const { editorView, divider } = noteSplitElements();
  state.dividerRatio = ratio;
  // Fractional units keep both panes filling the workspace when the sidebar
  // folds/expands or the window size changes.
  editorView?.style.setProperty('--note-split-left-size', ratio + 'fr');
  editorView?.style.setProperty('--note-split-right-size', (1 - ratio) + 'fr');
  divider?.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  persistNoteSplitState();
  return ratio;
}

function noteSplitBlockedReason() {
  if (typeof isGuestReadOnly === 'function' && isGuestReadOnly()) return 'Split View Is Not Available For Read Only Notes';
  if (window.innerWidth < NOTE_SPLIT_MIN_WIDTH) return 'Split View Requires A Wider Window';
  if (typeof isNoteFocusMode === 'function' && isNoteFocusMode()) return 'Exit Focus Mode To Use Split View';
  if (document.body?.classList.contains('desktop-note-window')) return 'Split View Is Not Available In Pop Out Notes';
  if (new URLSearchParams(location.search).get('desktopWindow') === 'note') return 'Split View Is Not Available In Pop Out Notes';
  return '';
}

function canUseNoteSplit(notify = false) {
  const reason = noteSplitBlockedReason();
  if (reason && notify && typeof showToast === 'function') showToast(reason, 'error');
  return !reason;
}

function noteSplitNoteAvailable(noteId) {
  const note = notes?.[noteId];
  return !!note && !(typeof isTrashedNote === 'function' && isTrashedNote(note));
}

function canRenderSplitPeer(peerId) {
  return noteSplitNoteAvailable(peerId) && peerId !== activeId;
}

function updateNoteSplitToggleButton() {
  const { toggleButton, editorView } = noteSplitElements();
  if (!toggleButton) return;
  const canOpen = !!activeId && editorView?.style.display !== 'none' && canUseNoteSplit(false);
  const open = noteSplitHasPane();
  toggleButton.disabled = !canOpen;
  toggleButton.classList.toggle('active', open);
  toggleButton.title = open ? 'Close Note' : 'Open Split View';
  toggleButton.setAttribute('aria-label', toggleButton.title);
  toggleButton.setAttribute('aria-pressed', String(open));
  const icon = toggleButton.querySelector('i');
  if (icon) icon.className = 'fa-solid ' + (open ? 'fa-xmark' : 'fa-table-columns');
}

function setSplitPaneVisible(visible, side = 'right') {
  const { editorView, peerPane, divider } = noteSplitElements();
  if (!editorView || !peerPane) return;
  editorView.classList.toggle('split-active', visible);
  editorView.classList.toggle('split-left', visible && side === 'left');
  editorView.classList.toggle('split-right', visible && side !== 'left');
  peerPane.hidden = false;
  peerPane.classList.toggle('is-visible', visible);
  peerPane.setAttribute('aria-hidden', String(!visible));
  if ('inert' in peerPane) peerPane.inert = !visible;
  if (divider) {
    divider.tabIndex = visible ? 0 : -1;
    divider.setAttribute('aria-hidden', String(!visible));
  }
  if (visible) applyNoteSplitRatio();
}

function clearSplitPeerBody() {
  const { peerPane, peerTitle, peerBody, peerFocusButton } = noteSplitElements();
  if (peerTitle) {
    peerTitle.value = '';
    peerTitle.readOnly = true;
    peerTitle.disabled = true;
  }
  if (peerBody) {
    peerBody.replaceChildren();
    peerBody.contentEditable = 'false';
    peerBody.classList.remove('is-loading', 'is-empty');
  }
  if (peerFocusButton) peerFocusButton.disabled = true;
  if (peerPane) {
    peerPane.classList.remove('is-loading', 'is-awaiting');
    delete peerPane.dataset.noteId;
  }
}

function cleanSplitPeerHTML(root) {
  const clone = root.cloneNode(true);
  try { clone.querySelectorAll('[data-collapsed]').forEach(el => el.removeAttribute('data-collapsed')); } catch (_) {}
  try { clone.querySelectorAll('[' + HEADER_DOMAIN_END_ATTR + ']').forEach(el => el.removeAttribute(HEADER_DOMAIN_END_ATTR)); } catch (_) {}
  try { clone.querySelectorAll('.note-alarm').forEach(el => { el.classList.remove('alarm-due'); if (!el.classList.length) el.removeAttribute('class'); }); } catch (_) {}
  try { clone.querySelectorAll('.note-conversation-anchor').forEach(el => el.classList.remove('conversation-anchor-focused')); } catch (_) {}
  try { if (typeof cleanupInlineCodePlaceholders === 'function') cleanupInlineCodePlaceholders(clone); } catch (_) {}
  try { if (typeof stripZeroWidthText === 'function') stripZeroWidthText(clone); } catch (_) {}
  try { if (typeof normalizeThemeTextStyles === 'function') normalizeThemeTextStyles(clone); } catch (_) {}
  try { if (typeof normalizeCodeThemeStyles === 'function') normalizeCodeThemeStyles(clone); } catch (_) {}
  try { if (typeof normalizeChecklistStructure === 'function') normalizeChecklistStructure(clone); } catch (_) {}
  try { if (typeof stripTableEditorChrome === 'function') stripTableEditorChrome(clone); } catch (_) {}
  try { if (typeof stripNoteImageEditorChrome === 'function') stripNoteImageEditorChrome(clone); } catch (_) {}
  try { if (typeof sanitizeEditorTables === 'function') sanitizeEditorTables(clone); } catch (_) {}
  try { clone.querySelectorAll('[style]').forEach(el => { el.style.display = ''; if (!el.getAttribute('style')) el.removeAttribute('style'); }); } catch (_) {}
  return clone.innerHTML;
}

function syncSplitPeerNote() {
  const peerId = getNoteSplitPeerId();
  const note = notes?.[peerId];
  const { peerBody, peerTitle } = noteSplitElements();
  if (!note || !peerBody || !peerTitle || !canEditNote(note) || !note._bodyLoaded) return false;
  const title = String(peerTitle.value || '').trim() || 'Untitled Note';
  const content = cleanSplitPeerHTML(peerBody);
  note.title = title;
  note.modified = new Date().toISOString();
  applyNoteBodyContent(peerId, content, { text: peerBody.innerText || peerBody.textContent || '' });
  document.querySelectorAll('.sidebar-item[data-id]').forEach(item => {
    if (item.dataset.id !== peerId) return;
    const name = item.querySelector('.item-name');
    const preview = item.querySelector('.item-preview');
    if (name) name.textContent = title;
    if (preview) preview.textContent = notePreviewText(note);
  });
  return true;
}

function flushSplitPeerSave() {
  clearTimeout(_noteSplitSaveTimer);
  _noteSplitSaveTimer = null;
  const peerId = getNoteSplitPeerId();
  const note = notes?.[peerId];
  if (!note || !syncSplitPeerNote()) return false;
  void saveDoc(note);
  return true;
}

function scheduleSplitPeerSave() {
  clearTimeout(_noteSplitSaveTimer);
  _noteSplitSaveTimer = setTimeout(flushSplitPeerSave, NOTE_SPLIT_SAVE_DELAY);
}

function rememberNoteSplitPeerSelection() {
  const { peerBody } = noteSplitElements();
  if (!peerBody || typeof captureEditorSelection !== 'function') return null;
  _noteSplitPeerSelection = captureEditorSelection(peerBody);
  return _noteSplitPeerSelection;
}

function restoreNoteSplitPeerSelection() {
  const { peerBody } = noteSplitElements();
  if (!peerBody) return false;
  if (typeof restoreEditorSelection === 'function') {
    try {
      restoreEditorSelection(peerBody, _noteSplitPeerSelection);
      return true;
    } catch (_) {}
  }
  peerBody.focus({ preventScroll: true });
  return false;
}

function applyNoteSplitToolbarAction(action) {
  const peerId = getNoteSplitPeerId();
  const { peerBody } = noteSplitElements();
  if (!peerId || !peerBody || noteSplitIsAwaiting()) return false;
  const note = notes?.[peerId];
  if (!note || !canEditNote(note) || peerBody.contentEditable !== 'true') return false;

  const selectionInPeer = selectionBelongsToRoot(peerBody);
  if (getNoteSplitActivePane() !== 'peer' && !selectionInPeer) return false;

  setNoteSplitActivePane('peer');
  if (action === 'alarm') {
    if (selectionInPeer) rememberNoteSplitPeerSelection();
    restoreNoteSplitPeerSelection();
    if (typeof runEditorOperationOnRoot === 'function') {
      runEditorOperationOnRoot(peerBody, () => openNoteAlarmModal?.(peerId));
    } else {
      openNoteAlarmModal?.(peerId);
    }
    return true;
  }
  if (action === 'conversation') {
    if (selectionInPeer) rememberNoteSplitPeerSelection();
    restoreNoteSplitPeerSelection();
    if (typeof openConversationComposerFromSelection === 'function') {
      if (typeof runEditorOperationOnRoot === 'function') {
        runEditorOperationOnRoot(peerBody, () => openConversationComposerFromSelection());
      } else {
        openConversationComposerFromSelection();
      }
    }
    return true;
  }

  if (selectionInPeer) rememberNoteSplitPeerSelection();
  restoreNoteSplitPeerSelection();
  if (typeof runEditorActionOnRoot !== 'function' || !runEditorActionOnRoot(peerBody, action)) return false;
  rememberNoteSplitPeerSelection();
  try { if (typeof decorateTables === 'function') decorateTables(peerBody); } catch (_) {}
  try { if (typeof decorateNoteImages === 'function') decorateNoteImages(peerBody); } catch (_) {}
  if (typeof refreshEmpty === 'function') refreshEmpty(peerBody);
  if (syncSplitPeerNote()) scheduleSplitPeerSave();
  return true;
}

function renderSplitAwaitingPane() {
  const { peerPane, peerTitle, peerBody, peerFocusButton } = noteSplitElements();
  if (!peerPane || !peerTitle || !peerBody) return;
  peerPane.classList.remove('is-loading');
  peerPane.classList.add('is-awaiting');
  delete peerPane.dataset.noteId;
  peerTitle.value = 'Split View';
  peerTitle.disabled = true;
  peerTitle.readOnly = true;
  peerBody.contentEditable = 'false';
  peerBody.classList.remove('is-loading', 'is-empty');
  peerBody.innerHTML = '<div class="note-split-placeholder"><i class="fa-solid fa-table-columns"></i><span>Drag A Note Here</span></div>';
  if (peerFocusButton) peerFocusButton.disabled = true;
}

function renderSplitPeerBody(root, content) {
  if (!root) return;
  const peerId = typeof getNoteSplitPeerId === 'function' ? getNoteSplitPeerId() : '';
  if (typeof renderMarkdownContent === 'function') root.innerHTML = renderMarkdownContent(content || '');
  else root.textContent = String(content || '');
  try { if (typeof normalizeThemeTextStyles === 'function') normalizeThemeTextStyles(root); } catch (_) {}
  try { if (typeof normalizeCodeThemeStyles === 'function') normalizeCodeThemeStyles(root); } catch (_) {}
  try { if (typeof linkifyTextNodes === 'function') linkifyTextNodes(root); } catch (_) {}
  try { if (typeof ensureLinkAttrs === 'function') ensureLinkAttrs(root); } catch (_) {}
  try { if (typeof restoreChecklistState === 'function') restoreChecklistState(root); } catch (_) {}
  try { if (typeof restoreAlarmMarks === 'function') restoreAlarmMarks(root); } catch (_) {}
  try { if (typeof restoreConversationAnchorMarks === 'function') restoreConversationAnchorMarks(root); } catch (_) {}
  try { if (typeof decorateTables === 'function') decorateTables(root); } catch (_) {}
  try { if (typeof decorateNoteImages === 'function') decorateNoteImages(root); } catch (_) {}
  try {
    if (typeof restoreCollapsedState === 'function' && peerId) {
      if (typeof runEditorOperationOnRoot === 'function') runEditorOperationOnRoot(root, () => restoreCollapsedState(peerId, root));
      else restoreCollapsedState(peerId, root);
    }
  } catch (_) {}
  try { if (typeof refreshEmpty === 'function') refreshEmpty(root); } catch (_) {}
  try { if (typeof initPeerUndoSnapshot === 'function') initPeerUndoSnapshot(root); } catch (_) {}
}

async function readSplitPeerBody(note, peerId) {
  if (note?._bodyLoaded) return String(note.content || '');
  const content = typeof readNoteBodyContent === 'function'
    ? await readNoteBodyContent(peerId)
    : String(note?.content || '');
  applyNoteBodyContent(peerId, content);
  return String(content || '');
}

function refreshNoteSplitView() {
  const peerId = getNoteSplitPeerId();
  const state = noteSplitState();
  const { peerPane, peerTitle, peerBody, peerFocusButton } = noteSplitElements();
  if (!peerPane || !peerTitle || !peerBody) return false;

  if (!peerId && !state.awaiting) {
    setSplitPaneVisible(false);
    clearSplitPeerBody();
    updateNoteSplitToggleButton();
    return false;
  }
  if (!canUseNoteSplit(false) || !activeId || (peerId && !canRenderSplitPeer(peerId))) {
    clearNoteSplitView();
    return false;
  }

  setSplitPaneVisible(true, normaliseNoteSplitSide(state.side));
  if (!peerId) {
    renderSplitAwaitingPane();
    updateNoteSplitToggleButton();
    return true;
  }

  const note = notes[peerId];
  const token = ++_noteSplitRenderToken;
  const editable = canEditNote(note);
  peerPane.classList.remove('is-awaiting');
  peerPane.classList.add('is-loading');
  peerPane.dataset.noteId = peerId;
  peerTitle.value = note.title || 'Untitled Note';
  peerTitle.disabled = false;
  peerTitle.readOnly = !editable;
  peerBody.contentEditable = 'false';
  peerBody.classList.add('is-loading');
  peerBody.classList.remove('is-empty');
  peerBody.innerHTML = '<div class="note-split-peer-loading" role="status">Loading Note</div>';
  if (peerFocusButton) peerFocusButton.disabled = false;
  updateNoteSplitToggleButton();

  void readSplitPeerBody(note, peerId)
    .then(content => {
      if (token !== _noteSplitRenderToken || getNoteSplitPeerId() !== peerId || activeId === peerId) return;
      peerBody.contentEditable = editable ? 'true' : 'false';
      peerBody.setAttribute('aria-readonly', String(!editable));
      renderSplitPeerBody(peerBody, content);
      peerPane.classList.remove('is-loading');
      peerBody.classList.remove('is-loading');
    })
    .catch(err => {
      console.warn('split peer body:', err);
      if (token !== _noteSplitRenderToken || getNoteSplitPeerId() !== peerId) return;
      peerBody.contentEditable = 'false';
      peerBody.innerHTML = '<div class="note-split-peer-error" role="status">Could Not Load Note</div>';
      peerPane.classList.remove('is-loading');
      peerBody.classList.remove('is-loading');
    });
  return true;
}

function clearNoteSplitView() {
  flushSplitPeerSave();
  finishNoteSplitResize();
  _noteSplitRenderToken += 1;
  _noteSplitPeerSelection = null;
  setNoteSplitState('', 'right', false);
  setNoteSplitActivePane('live');
  setSplitPaneVisible(false);
  clearSplitPeerBody();
  updateNoteSplitToggleButton();
  return true;
}

function openEmptyNoteSplit(side = 'right') {
  if (!activeId || !canUseNoteSplit(true)) return false;
  flushSplitPeerSave();
  setNoteSplitState('', side, true);
  setNoteSplitActivePane('live');
  return refreshNoteSplitView();
}

async function closeNoteSplitLivePane() {
  if (!noteSplitHasPane()) return false;
  const peerId = getNoteSplitPeerId();
  flushSplitPeerSave();
  if (peerId && notes?.[peerId] && typeof openNote === 'function') {
    // Opening the peer as primary clears split via afterOpenNoteSplit.
    await openNote(peerId);
    return true;
  }
  return clearNoteSplitView();
}

function closeNoteSplitPeerPane() {
  return clearNoteSplitView();
}

function toggleNoteSplitView() {
  if (noteSplitHasPane()) {
    void closeNoteSplitLivePane();
    return true;
  }
  return openEmptyNoteSplit();
}

function setNoteSplitView(peerId, side = 'right') {
  const id = String(peerId || '').trim();
  if (!canUseNoteSplit(true) || !id || !notes?.[id]) return false;
  if (id === activeId || id === getNoteSplitPeerId()) return false;
  if (!noteSplitNoteAvailable(id)) return false;
  flushSplitPeerSave();
  setNoteSplitState(id, side, false);
  return refreshNoteSplitView();
}

function routeSidebarNoteOpenInSplit(noteId) {
  const id = String(noteId || '').trim();
  const peerId = getNoteSplitPeerId();
  if (!id || !peerId || noteSplitIsAwaiting() || !noteSplitNoteAvailable(id)) return false;
  if (id === activeId) {
    focusNoteSplitPane('live');
    return true;
  }
  if (id === peerId) {
    focusNoteSplitPane('peer');
    return true;
  }
  if (getNoteSplitActivePane() !== 'peer') {
    setNoteSplitActivePane('live');
    return false;
  }
  flushSplitPeerSave();
  setNoteSplitState(id, noteSplitState().side, false);
  setNoteSplitActivePane('peer');
  return refreshNoteSplitView();
}

function beforeOpenNoteSplit() {
  // Sidebar note selection is routed before this hook so each pane keeps its identity.
}

function afterOpenNoteSplit() {
  if (getNoteSplitPeerId() === activeId) {
    clearNoteSplitView();
    return false;
  }
  return refreshNoteSplitView();
}

function pointInRect(clientX, clientY, rect) {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function getNoteSplitDropSide(clientX, clientY) {
  const { dropOverlay, peerArea, peerBody } = noteSplitElements();
  if (!dropOverlay) return '';
  const zones = [...dropOverlay.querySelectorAll('.note-split-drop-zone')];
  for (const zone of zones) {
    if (pointInRect(clientX, clientY, zone.getBoundingClientRect())) {
      return zone.classList.contains('split-left') ? 'left' : 'right';
    }
  }
  const dropTarget = peerArea || peerBody;
  if (noteSplitIsAwaiting() && dropTarget && pointInRect(clientX, clientY, dropTarget.getBoundingClientRect())) {
    return normaliseNoteSplitSide(noteSplitState().side);
  }
  return '';
}

function setNoteSplitDropTarget(side) {
  const { editorView } = noteSplitElements();
  if (!editorView) return;
  if (_noteSplitDrag?.duplicate) side = '';
  editorView.classList.toggle('split-drop-left', side === 'left');
  editorView.classList.toggle('split-drop-right', side === 'right');
}

function noteIsAlreadyInSplit(noteId) {
  const id = String(noteId || '').trim();
  return !!id && (id === activeId || id === getNoteSplitPeerId());
}

function updateNoteSplitDropZones(disabled = false) {
  const { dropOverlay } = noteSplitElements();
  if (!dropOverlay) return;
  dropOverlay.querySelectorAll('.note-split-drop-zone').forEach(zone => {
    zone.classList.toggle('is-disabled', disabled);
    zone.setAttribute('aria-disabled', String(disabled));
    const label = zone.querySelector('span');
    if (label) label.textContent = disabled ? 'Already Open' : (zone.classList.contains('split-left') ? 'Split Left' : 'Split Right');
    const icon = zone.querySelector('i');
    if (icon) icon.className = 'fa-solid ' + (disabled ? 'fa-ban' : 'fa-table-columns');
  });
}

function beginNoteSplitDrag(noteId) {
  const { editorView } = noteSplitElements();
  if (!editorView || !noteSplitNoteAvailable(noteId) || !canUseNoteSplit(false)) return false;
  _noteSplitDrag = { noteId: String(noteId), side: '', duplicate: noteIsAlreadyInSplit(noteId) };
  editorView.classList.add('split-dragging');
  editorView.classList.toggle('split-drag-duplicate', _noteSplitDrag.duplicate);
  updateNoteSplitDropZones(_noteSplitDrag.duplicate);
  return true;
}

function finishNoteSplitDrag() {
  _noteSplitDrag = null;
  const { editorView } = noteSplitElements();
  editorView?.classList.remove('split-dragging', 'split-drag-duplicate', 'split-drop-left', 'split-drop-right');
  updateNoteSplitDropZones(false);
}

function startNoteSplitSidebarDrag(event, noteId) {
  if (!event?.dataTransfer || !beginNoteSplitDrag(noteId)) return false;
  event.dataTransfer.effectAllowed = 'copyMove';
  return true;
}

function handleNoteSplitDragOver(event) {
  if (!_noteSplitDrag) return;
  if (_noteSplitDrag.duplicate) {
    event.preventDefault();
    _noteSplitDrag.side = '';
    setNoteSplitDropTarget('');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    return;
  }
  const side = getNoteSplitDropSide(event.clientX, event.clientY);
  _noteSplitDrag.side = side;
  setNoteSplitDropTarget(side);
  if (!side) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function handleNoteSplitDrop(event) {
  const drag = _noteSplitDrag;
  if (!drag) return;
  if (drag.duplicate) {
    event.preventDefault();
    finishNoteSplitDrag();
    return;
  }
  const side = getNoteSplitDropSide(event.clientX, event.clientY) || drag.side;
  if (side) {
    event.preventDefault();
    setNoteSplitView(drag.noteId, side);
  }
  finishNoteSplitDrag();
}

function beginNoteSplitResize(event) {
  const { editorView, workspace, divider } = noteSplitElements();
  if (!editorView || !workspace || !divider || !noteSplitHasPane()) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const rect = workspace.getBoundingClientRect();
  if (rect.width <= NOTE_SPLIT_DIVIDER_WIDTH + NOTE_SPLIT_MIN_PANE_WIDTH * 2) return;
  event.preventDefault();
  _noteSplitResize = { pointerId: event.pointerId };
  editorView.classList.add('split-resizing');
  try { divider.setPointerCapture(event.pointerId); } catch (_) {}
}

function moveNoteSplitResize(event) {
  if (!_noteSplitResize || event.pointerId !== _noteSplitResize.pointerId) return;
  const { workspace } = noteSplitElements();
  const rect = workspace?.getBoundingClientRect();
  if (!rect) return;
  const available = Math.max(1, rect.width - NOTE_SPLIT_DIVIDER_WIDTH);
  applyNoteSplitRatio((event.clientX - rect.left) / available);
}

function finishNoteSplitResize(event) {
  if (!_noteSplitResize || (event?.pointerId != null && event.pointerId !== _noteSplitResize.pointerId)) return;
  const pointerId = _noteSplitResize.pointerId;
  _noteSplitResize = null;
  const { editorView, divider } = noteSplitElements();
  editorView?.classList.remove('split-resizing');
  try {
    if (divider?.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
  } catch (_) {}
}

function handleNoteSplitDividerKeydown(event) {
  if (!noteSplitHasPane()) return;
  let nextRatio = noteSplitState().dividerRatio;
  if (event.key === 'ArrowLeft') nextRatio -= .04;
  else if (event.key === 'ArrowRight') nextRatio += .04;
  else if (event.key === 'Home') nextRatio = noteSplitRatioBounds().min;
  else if (event.key === 'End') nextRatio = noteSplitRatioBounds().max;
  else return;
  event.preventDefault();
  applyNoteSplitRatio(nextRatio);
}

function runNoteSplitPeerTableOperation(operation) {
  const peerId = getNoteSplitPeerId();
  const { peerBody } = noteSplitElements();
  const note = notes?.[peerId];
  if (!peerId || !peerBody || !note || !canEditNote(note) || peerBody.contentEditable !== 'true') return false;
  if (typeof runEditorOperationOnRoot !== 'function') return false;
  runEditorOperationOnRoot(peerBody, operation);
  return true;
}

function syncSplitPeerTableTitleInput(input) {
  if (!input) return;
  input.setAttribute('value', input.value || '');
  const table = input.closest?.('.note-table-wrap')?.querySelector(':scope > .note-table-scroll > table, :scope > table');
  if (table && typeof setTableCaptionText === 'function') setTableCaptionText(table, input.value || '');
}

function initNoteSplitView() {
  if (_noteSplitInitialised) return true;
  const { peerPane, peerBody, peerTitle, closeButton, peerFocusButton, toggleButton, divider } = noteSplitElements();
  if (!peerPane || !peerBody || !peerTitle) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNoteSplitView, { once: true });
    return false;
  }
  _noteSplitInitialised = true;
  peerPane.hidden = false;
  const liveBody = document.getElementById('editor');
  const liveTitle = document.getElementById('doc-title');
  const markLiveActive = () => setNoteSplitActivePane('live');
  const markPeerActive = () => {
    setNoteSplitActivePane('peer');
    rememberNoteSplitPeerSelection();
  };
  [liveBody, liveTitle].filter(Boolean).forEach(el => {
    el.addEventListener('focusin', markLiveActive);
    el.addEventListener('pointerdown', markLiveActive);
    el.addEventListener('keyup', markLiveActive);
    el.addEventListener('mouseup', markLiveActive);
  });
  [peerBody, peerTitle].forEach(el => {
    el.addEventListener('focusin', markPeerActive);
    el.addEventListener('pointerdown', () => setNoteSplitActivePane('peer'));
    el.addEventListener('keyup', markPeerActive);
    el.addEventListener('mouseup', markPeerActive);
  });
  closeButton?.addEventListener('click', event => {
    event.preventDefault();
    closeNoteSplitPeerPane();
  });
  peerFocusButton?.addEventListener('click', event => {
    event.preventDefault();
    void focusNoteSplitPeerFullscreen();
  });
  toggleButton?.addEventListener('click', event => {
    event.preventDefault();
    toggleNoteSplitView();
  });
  divider?.addEventListener('pointerdown', beginNoteSplitResize);
  divider?.addEventListener('pointermove', moveNoteSplitResize);
  divider?.addEventListener('pointerup', finishNoteSplitResize);
  divider?.addEventListener('pointercancel', finishNoteSplitResize);
  divider?.addEventListener('keydown', handleNoteSplitDividerKeydown);
  if (typeof bindEditorRootListeners === 'function') bindEditorRootListeners(peerBody);
  peerBody.addEventListener('beforeinput', () => setNoteSplitActivePane('peer'));
  peerBody.addEventListener('input', () => {
    setNoteSplitActivePane('peer');
    rememberNoteSplitPeerSelection();
  });
  peerBody.addEventListener('mouseup', () => {
    setNoteSplitActivePane('peer');
    rememberNoteSplitPeerSelection();
  });
  peerBody.addEventListener('keyup', () => {
    setNoteSplitActivePane('peer');
    rememberNoteSplitPeerSelection();
  });
  peerTitle.addEventListener('input', () => {
    setNoteSplitActivePane('peer');
    const note = notes?.[getNoteSplitPeerId()];
    if (!note || !canEditNote(note)) return;
    note.title = String(peerTitle.value || '').trim() || 'Untitled Note';
    scheduleSplitPeerSave();
  });
  peerTitle.addEventListener('blur', () => {
    if (peerTitle.readOnly || peerTitle.disabled) return;
    peerTitle.value = String(peerTitle.value || '').trim() || 'Untitled Note';
    flushSplitPeerSave();
    if (typeof renderSidebar === 'function') renderSidebar();
  });
  peerBody.addEventListener('blur', flushSplitPeerSave);
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const owner = range?.commonAncestorContainer?.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range?.commonAncestorContainer?.parentElement;
    if (owner && peerBody.contains(owner)) {
      markPeerActive();
      rememberNoteSplitPeerSelection();
    }
  });
  document.addEventListener('dragover', handleNoteSplitDragOver);
  document.addEventListener('drop', handleNoteSplitDrop);
  document.addEventListener('dragend', finishNoteSplitDrag);
  window.addEventListener('blur', finishNoteSplitDrag);
  window.addEventListener('resize', () => {
    if (noteSplitHasPane() && !canUseNoteSplit(false)) clearNoteSplitView();
    else if (noteSplitHasPane()) applyNoteSplitRatio();
    else tryRestorePersistedNoteSplit();
  });
  const { workspace } = noteSplitElements();
  if (workspace && typeof ResizeObserver === 'function') {
    let resizeFrame = 0;
    const workspaceObserver = new ResizeObserver(() => {
      if (!noteSplitHasPane()) return;
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (noteSplitHasPane() && canUseNoteSplit(false)) applyNoteSplitRatio();
        else if (noteSplitHasPane()) clearNoteSplitView();
      });
    });
    workspaceObserver.observe(workspace);
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !_noteSplitDrag) return;
    finishNoteSplitDrag();
  }, true);
  if (window.MutationObserver && document.body) {
    new MutationObserver(() => {
      if (noteSplitHasPane() && !canUseNoteSplit(false)) clearNoteSplitView();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  beginInitialNoteSplitRestore();
  clearNoteSplitView();
  return true;
}
