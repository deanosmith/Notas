/* Editor helpers, toolbar actions, reminders, and mentions. */
function makeUndoSnapshot(ed = getEd()) {
  if (!ed) return null;
  return {
    html: ed.innerHTML,
    selection: captureEditorSelection(ed),
    scrollTop: ed.scrollTop || 0
  };
}

function sameUndoSnapshot(a, b) {
  return !!a && !!b && a.html === b.html;
}

function pushUndoState(stack, snapshot) {
  if (!snapshot) return;
  const top = stack[stack.length - 1];
  if (!sameUndoSnapshot(top, snapshot)) {
    stack.push({ ...snapshot });
    if (stack.length > UNDO_LIMIT) stack.shift();
  }
}

function markEditorHistoryTouched() {
  if (_appHistoryApplying) return;
  _lastUndoDomain = 'editor';
  _lastRedoDomain = '';
  appRedoStack.length = 0;
}

function refreshUndoSnapshotSelection() {
  const ed = getEd();
  if (!ed) return;
  const current = makeUndoSnapshot(ed);
  if (!_lastUndoSnapshot || current.html === _lastUndoSnapshot.html) {
    _lastUndoSnapshot = current;
  }
}

function pushUndo() {
  const ed = getEd();
  if (!ed) return;
  clearTimeout(_undoDebounceTimer);
  const current = makeUndoSnapshot(ed);
  markEditorHistoryTouched();
  if (!_lastUndoSnapshot) {
    _lastUndoSnapshot = current;
  } else if (current.html !== _lastUndoSnapshot.html) {
    pushUndoState(undoStack, _lastUndoSnapshot);
    _lastUndoSnapshot = current;
    redoStack.length = 0;
  } else {
    _lastUndoSnapshot = current;
  }
  pushUndoState(undoStack, _lastUndoSnapshot);
  _undoTransactionOpen = true;
}

function initUndoSnapshot() {
  const ed = getEd();
  _lastUndoSnapshot = ed ? makeUndoSnapshot(ed) : null;
  undoStack.length = 0;
  redoStack.length = 0;
  clearTimeout(_undoDebounceTimer);
  _undoTransactionOpen = false;
}

function commitUndoSnapshot() {
  const ed = getEd();
  if (!ed) return;
  const current = makeUndoSnapshot(ed);
  if (!_lastUndoSnapshot) {
    _lastUndoSnapshot = current;
    _undoTransactionOpen = false;
    return;
  }
  if (current.html === _lastUndoSnapshot.html) {
    _lastUndoSnapshot = current;
    if (_undoTransactionOpen && sameUndoSnapshot(undoStack[undoStack.length - 1], current)) {
      undoStack.pop();
    }
    _undoTransactionOpen = false;
    return;
  }
  markEditorHistoryTouched();
  if (_undoTransactionOpen) {
    _lastUndoSnapshot = current;
    redoStack.length = 0;
    _undoTransactionOpen = false;
    return;
  }
  pushUndoState(undoStack, _lastUndoSnapshot);
  _lastUndoSnapshot = current;
  redoStack.length = 0;
}

function flushUndoSnapshot() {
  clearTimeout(_undoDebounceTimer);
  commitUndoSnapshot();
}

function restoreUndoSnapshot(snapshot) {
  const ed = getEd();
  if (!ed || !snapshot) return;
  ed.innerHTML = snapshot.html;
  normalizeCodeThemeStyles(ed);
  restoreChecklistState(ed);
  restoreAlarmMarks(ed);
  decorateTables(ed);
  decorateNoteImages(ed);
  recomputeCollapsedSections();
  refreshEmpty(ed);
  restoreEditorSelection(ed, snapshot.selection);
  ed.scrollTop = Math.min(snapshot.scrollTop || 0, ed.scrollHeight);
}

function performUndo() {
  flushUndoSnapshot();
  if (!undoStack.length) return;
  const ed = getEd();
  pushUndoState(redoStack, makeUndoSnapshot(ed));
  restoreUndoSnapshot(undoStack.pop());
  _lastUndoSnapshot = makeUndoSnapshot(ed);
  _undoTransactionOpen = false;
  _lastUndoDomain = 'editor';
  _lastRedoDomain = 'editor';
  if (syncActiveNoteFromEditor()) scheduleSave();
}

function performRedo() {
  flushUndoSnapshot();
  if (!redoStack.length) return;
  const ed = getEd();
  pushUndoState(undoStack, makeUndoSnapshot(ed));
  restoreUndoSnapshot(redoStack.pop());
  _lastUndoSnapshot = makeUndoSnapshot(ed);
  _undoTransactionOpen = false;
  _lastUndoDomain = 'editor';
  _lastRedoDomain = 'editor';
  if (syncActiveNoteFromEditor()) scheduleSave();
}

function recordAppHistoryAction(action) {
  if (_appHistoryApplying || !action?.type) return;
  const normalized = { ...action };
  if (normalized.type === 'note-rename' || normalized.type === 'folder-rename') {
    const fallbackTitle = normalized.type === 'folder-rename' ? 'Untitled Folder' : 'Untitled Note';
    normalized.beforeTitle = String(normalized.beforeTitle || '').trim() || fallbackTitle;
    normalized.afterTitle = String(normalized.afterTitle || '').trim() || fallbackTitle;
    if (normalized.beforeTitle === normalized.afterTitle) return;
  }
  if (normalized.type === 'note-move') {
    normalized.beforeFolderId = normalized.beforeFolderId || null;
    normalized.afterFolderId = normalized.afterFolderId || null;
    if (normalized.beforeFolderId === normalized.afterFolderId) return;
  }
  if (normalized.type === 'folder-move') {
    if (!Array.isArray(normalized.beforeOrder) || !Array.isArray(normalized.afterOrder)) return;
    const before = JSON.stringify(normalized.beforeOrder);
    const after = JSON.stringify(normalized.afterOrder);
    if (before === after) return;
  }
  appUndoStack.push(normalized);
  if (appUndoStack.length > APP_UNDO_LIMIT) appUndoStack.shift();
  appRedoStack.length = 0;
  _lastUndoDomain = 'app';
  _lastRedoDomain = '';
}

async function applyNoteTitleHistory(action, title) {
  const note = notes[action.noteId];
  if (!note || !canEditNote(note)) return false;
  if (activeId === note.id) syncActiveNoteFromEditor();
  note.title = String(title || '').trim() || 'Untitled Note';
  note.modified = new Date().toISOString();
  if (activeId === note.id) {
    const titleEl = document.getElementById('doc-title');
    if (titleEl) titleEl.value = note.title;
  }
  renderSidebar();
  updateActiveNoteAccessAvatars();
  return await saveDoc(note);
}

async function applyFolderTitleHistory(action, title) {
  const folder = folders[action.folderId];
  if (!folder || !isOwnedFolder(folder)) return false;
  const previousTitle = folder.title;
  const previousModified = folder.modified;
  folder.title = String(title || '').trim() || 'Untitled Folder';
  folder.modified = new Date().toISOString();
  renderSidebar();
  try {
    await setDoc(doc(fsDb, 'folders', folder.id), {
      title: folder.title,
      modified: serverTimestamp()
    }, { merge: true });
    return true;
  } catch (err) {
    folder.title = previousTitle;
    folder.modified = previousModified;
    renderSidebar();
    throw err;
  }
}

async function applyNoteMoveHistory(action, folderId) {
  if (!notes[action.noteId]) return false;
  const targetFolderId = folderId || null;
  if ((notes[action.noteId].folderId || null) === targetFolderId) return true;
  if (targetFolderId && !folders[targetFolderId]) {
    showToast('Folder No Longer Exists', 'error');
    return false;
  }
  await moveNoteToFolder(action.noteId, targetFolderId);
  return (notes[action.noteId]?.folderId || null) === targetFolderId;
}

async function applyFolderOrderHistory(entries) {
  const available = (entries || []).filter(entry => folders[entry.id]);
  if (!available.length) return false;
  const previous = available.map(entry => ({
    id: entry.id,
    order: folders[entry.id].order,
    modified: folders[entry.id].modified
  }));
  available.forEach(entry => {
    const folder = folders[entry.id];
    folder.order = Number.isFinite(Number(entry.order)) ? Number(entry.order) : null;
    folder.modified = new Date().toISOString();
  });
  renderSidebar();
  try {
    await Promise.all(available.map(entry => {
      const order = Number.isFinite(Number(entry.order)) ? Number(entry.order) : deleteField();
      return setDoc(doc(fsDb, 'folders', entry.id), {
        order,
        modified: serverTimestamp()
      }, { merge: true });
    }));
    return true;
  } catch (err) {
    previous.forEach(entry => {
      if (!folders[entry.id]) return;
      folders[entry.id].order = entry.order;
      folders[entry.id].modified = entry.modified;
    });
    renderSidebar();
    throw err;
  }
}

async function applyAppHistoryAction(action, direction) {
  if (action.type === 'note-rename') {
    return applyNoteTitleHistory(action, direction === 'undo' ? action.beforeTitle : action.afterTitle);
  }
  if (action.type === 'folder-rename') {
    return applyFolderTitleHistory(action, direction === 'undo' ? action.beforeTitle : action.afterTitle);
  }
  if (action.type === 'note-move') {
    return applyNoteMoveHistory(action, direction === 'undo' ? action.beforeFolderId : action.afterFolderId);
  }
  if (action.type === 'folder-move') {
    return applyFolderOrderHistory(direction === 'undo' ? action.beforeOrder : action.afterOrder);
  }
  return false;
}

async function performAppUndo() {
  if (_appHistoryBusy || !appUndoStack.length) return false;
  const action = appUndoStack.pop();
  _appHistoryBusy = true;
  _appHistoryApplying = true;
  try {
    const ok = await applyAppHistoryAction(action, 'undo');
    if (ok) {
      appRedoStack.push(action);
      _lastUndoDomain = 'app';
      _lastRedoDomain = 'app';
      return true;
    }
    appUndoStack.push(action);
    return false;
  } catch (err) {
    console.error('app undo:', err);
    appUndoStack.push(action);
    showToast('Could Not Undo', 'error');
    return false;
  } finally {
    _appHistoryApplying = false;
    _appHistoryBusy = false;
  }
}

async function performAppRedo() {
  if (_appHistoryBusy || !appRedoStack.length) return false;
  const action = appRedoStack.pop();
  _appHistoryBusy = true;
  _appHistoryApplying = true;
  try {
    const ok = await applyAppHistoryAction(action, 'redo');
    if (ok) {
      appUndoStack.push(action);
      _lastUndoDomain = 'app';
      _lastRedoDomain = 'app';
      return true;
    }
    appRedoStack.push(action);
    return false;
  } catch (err) {
    console.error('app redo:', err);
    appRedoStack.push(action);
    showToast('Could Not Redo', 'error');
    return false;
  } finally {
    _appHistoryApplying = false;
    _appHistoryBusy = false;
  }
}

// Debounced snapshot for regular typing — captures state periodically
function scheduleUndoSnapshot() {
  clearTimeout(_undoDebounceTimer);
  _undoDebounceTimer = setTimeout(() => {
    commitUndoSnapshot();
  }, 600);
}

/* Helpers */
const esc = s =>
  s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const looksLikeHtml = s => /<\/?[a-z][^>]*>/i.test(s);
const noteTime = value => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};
const isPinnedNote = note => !!normalizePinnedAt(note?.pinnedAt);
const pinScopeForNote = note => isPinnedNote(note) ? (note?.pinScope === 'minor' ? 'minor' : 'major') : '';
const isMajorPinnedNote = note => isPinnedNote(note) && (pinScopeForNote(note) === 'major' || !hasVisibleFolder(note));
const compareNotes = (a, b) => {
  const ap = isPinnedNote(a), bp = isPinnedNote(b);
  if (ap !== bp) return ap ? -1 : 1;
  if (ap && bp) {
    const pinDiff = noteTime(b.pinnedAt) - noteTime(a.pinnedAt);
    if (pinDiff) return pinDiff;
  }
  const modifiedDiff = noteTime(b.modified) - noteTime(a.modified);
  if (modifiedDiff) return modifiedDiff;
  return String(a?.title || '').localeCompare(String(b?.title || ''));
};
const sortedIds = () =>
  Object.keys(notes).filter(id => !isTrashedNote(notes[id])).sort((a, b) => compareNotes(notes[a], notes[b]));
const trashSortedIds = () =>
  Object.keys(notes)
    .filter(id => isOwnedNote(notes[id]) && isTrashedNote(notes[id]))
    .sort((a, b) => noteTime(notes[b].deletedAt) - noteTime(notes[a].deletedAt));
const isMobile = () => window.innerWidth <= 767;

function renderMarkdownContent(content) {
  if (!content) return '';
  if (looksLikeHtml(content)) return content;
  if (window.marked?.parse) return window.marked.parse(content);
  return esc(content).replace(/\n/g, '<br>');
}

const NOTE_IMAGE_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const NOTE_IMAGE_MAX_EMBED_BYTES = 760 * 1024;
const NOTE_IMAGE_MAX_DIMENSION = 1600;
const NOTE_IMAGE_DEFAULT_WIDTH = 720;
const NOTE_IMAGE_MIN_WIDTH = 120;

function clipboardImageFile(data) {
  if (!data) return null;
  const items = Array.from(data.items || []);
  for (const item of items) {
    if (item.kind === 'file' && /^image\//i.test(item.type || '')) {
      const file = item.getAsFile?.();
      if (file) return file;
    }
  }
  return Array.from(data.files || []).find(file => /^image\//i.test(file.type || '')) || null;
}

function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  return Math.ceil(base64.length * 3 / 4);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('image-read-failed'));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('image-read-failed'));
    reader.readAsDataURL(blob);
  });
}

function loadImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = dataUrl;
  });
}

function canvasToImageDataUrl(canvas, type, quality) {
  return new Promise(resolve => {
    if (!canvas.toBlob) {
      resolve(canvas.toDataURL(type, quality));
      return;
    }
    canvas.toBlob(blob => {
      if (!blob) {
        resolve(canvas.toDataURL(type, quality));
        return;
      }
      blobToDataUrl(blob).then(resolve, () => resolve(canvas.toDataURL(type, quality)));
    }, type, quality);
  });
}

function drawImageToCanvas(image, maxDimension) {
  const sourceWidth = image.naturalWidth || image.width || NOTE_IMAGE_DEFAULT_WIDTH;
  const sourceHeight = image.naturalHeight || image.height || sourceWidth;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, width, height };
}

async function preparePastedImage(file) {
  if (!file || !/^image\//i.test(file.type || '')) throw new Error('image-unsupported');
  if (file.size > NOTE_IMAGE_MAX_SOURCE_BYTES) throw new Error('image-source-too-large');
  const original = await fileToDataUrl(file);
  const originalBytes = dataUrlByteLength(original);
  if (/^image\/gif$/i.test(file.type || '')) {
    if (originalBytes <= NOTE_IMAGE_MAX_EMBED_BYTES) return { src: original, width: null, height: null };
    throw new Error('image-too-large');
  }
  const image = await loadImageDataUrl(original);
  const naturalWidth = image.naturalWidth || image.width || NOTE_IMAGE_DEFAULT_WIDTH;
  const naturalHeight = image.naturalHeight || image.height || naturalWidth;
  if (originalBytes <= NOTE_IMAGE_MAX_EMBED_BYTES && Math.max(naturalWidth, naturalHeight) <= NOTE_IMAGE_MAX_DIMENSION) {
    return { src: original, width: naturalWidth, height: naturalHeight };
  }

  for (const maxDimension of [NOTE_IMAGE_MAX_DIMENSION, 1280, 1024, 860]) {
    const { canvas, width, height } = drawImageToCanvas(image, maxDimension);
    for (const quality of [.86, .74, .62]) {
      const src = await canvasToImageDataUrl(canvas, 'image/webp', quality);
      if (dataUrlByteLength(src) <= NOTE_IMAGE_MAX_EMBED_BYTES) return { src, width, height };
    }
  }
  throw new Error('image-too-large');
}

function safeNoteImageSrc(src) {
  return /^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(String(src || '').trim());
}

function normalizedImageWidth(value) {
  const width = Math.round(parseFloat(value));
  return Number.isFinite(width) && width >= NOTE_IMAGE_MIN_WIDTH ? width : null;
}

function normalizeNoteImageElement(img) {
  if (!img) return null;
  const src = img.getAttribute('src') || '';
  if (!safeNoteImageSrc(src)) {
    img.remove();
    return null;
  }
  const styledWidth = normalizedImageWidth(img.style?.width);
  if (styledWidth && !img.getAttribute('width')) img.setAttribute('width', String(styledWidth));
  img.classList.add('note-image');
  img.dataset.noteImage = '1';
  img.removeAttribute('height');
  img.removeAttribute('contenteditable');
  img.setAttribute('draggable', 'false');
  return img;
}

function createNoteImageElement(src, name, width) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = name ? 'Pasted image: ' + name : 'Pasted image';
  normalizeNoteImageElement(img);
  const displayWidth = normalizedImageWidth(width) || NOTE_IMAGE_DEFAULT_WIDTH;
  img.setAttribute('width', String(Math.min(displayWidth, NOTE_IMAGE_DEFAULT_WIDTH)));
  return img;
}

function createNoteImageBlock(img) {
  const block = document.createElement('span');
  block.className = 'note-image-block';
  block.appendChild(img);
  return block;
}

function editorContainsRange(ed, range) {
  if (!ed || !range) return false;
  const common = range.commonAncestorContainer;
  return common === ed || ed.contains(common.nodeType === Node.ELEMENT_NODE ? common : common.parentNode);
}

function insertNoteImageElement(img, range) {
  const ed = getEd();
  if (!ed || !img) return false;
  const targetRange = editorContainsRange(ed, range) ? range : getEditorSelectionRange();
  if (!targetRange) return false;
  const block = createNoteImageBlock(img);
  const marker = document.createTextNode('\u200b');
  const frag = document.createDocumentFragment();
  frag.appendChild(block);
  frag.appendChild(marker);
  targetRange.deleteContents();
  targetRange.insertNode(frag);
  decorateNoteImages(ed);
  const caret = document.createRange();
  caret.setStart(marker, 1);
  caret.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(caret);
  ed.focus();
  return true;
}

async function insertPastedImageFile(file, range = null, noteId = activeId) {
  if (isSelectionInTable()) {
    showToast('Tables Support Simple Text Only', 'error');
    return false;
  }
  try {
    const prepared = await preparePastedImage(file);
    if (noteId && activeId !== noteId) return false;
    const img = createNoteImageElement(prepared.src, file.name || '', prepared.width);
    if (!insertNoteImageElement(img, range)) return false;
    getEd().dispatchEvent(new Event('input'));
    return true;
  } catch (err) {
    console.error('paste image:', err);
    const message = err?.message === 'image-too-large' || err?.message === 'image-source-too-large'
      ? 'Image Too Large For This Note'
      : 'Could Not Paste Image';
    showToast(message, 'error');
    return false;
  }
}

function ensureNoteImageBlock(img) {
  let block = img.closest('.note-image-block');
  if (block && block.contains(img)) return block;
  block = document.createElement('span');
  block.className = 'note-image-block';
  img.before(block);
  block.appendChild(img);
  return block;
}

function createNoteImageResizeHandle() {
  const handle = document.createElement('span');
  handle.className = 'note-image-resize-handle';
  handle.dataset.noteImageResize = '1';
  handle.setAttribute('contenteditable', 'false');
  handle.setAttribute('aria-hidden', 'true');
  return handle;
}

function decorateNoteImages(root = getEd()) {
  if (!root) return false;
  let changed = false;
  const editable = root.isContentEditable || root.getAttribute?.('contenteditable') === 'true';
  [...root.querySelectorAll('img')].forEach(img => {
    if (img.closest('.note-image-resize-handle')) return;
    const normalized = normalizeNoteImageElement(img);
    if (!normalized) {
      changed = true;
      return;
    }
    const existingBlock = img.closest('.note-image-block');
    const block = existingBlock && existingBlock.contains(img) ? existingBlock : ensureNoteImageBlock(img);
    if (!existingBlock) changed = true;
    block.classList.add('note-image-block');
    block.classList.toggle('has-image-controls', editable);
    if (editable) block.setAttribute('contenteditable', 'false');
    else block.removeAttribute('contenteditable');
    block.querySelectorAll(':scope > .note-image-resize-handle').forEach((handle, index) => {
      if (index > 0 || !editable) {
        handle.remove();
        changed = true;
      }
    });
    if (editable && !block.querySelector(':scope > .note-image-resize-handle')) {
      block.appendChild(createNoteImageResizeHandle());
      changed = true;
    }
  });
  return changed;
}

function stripNoteImageEditorChrome(root) {
  root.querySelectorAll('.note-image-resize-handle').forEach(el => el.remove());
  root.querySelectorAll('img').forEach(img => {
    normalizeNoteImageElement(img);
    img.removeAttribute('draggable');
  });
  root.querySelectorAll('.note-image-block').forEach(block => {
    block.classList.remove('has-image-controls');
    block.removeAttribute('contenteditable');
    if (!block.querySelector('img')) {
      block.remove();
    }
  });
}

function startNoteImageResize(e, handle) {
  if (!activeId || !canEditNote(notes[activeId])) return;
  const block = handle?.closest?.('.note-image-block');
  const img = block?.querySelector?.('img.note-image');
  if (!block || !img) return;
  e.preventDefault();
  e.stopPropagation();
  pushUndo();
  const startRect = img.getBoundingClientRect();
  const editorRect = getEd().getBoundingClientRect();
  const startWidth = Math.max(NOTE_IMAGE_MIN_WIDTH, startRect.width || normalizedImageWidth(img.getAttribute('width')) || NOTE_IMAGE_DEFAULT_WIDTH);
  const maxWidth = Math.max(NOTE_IMAGE_MIN_WIDTH, Math.min(NOTE_IMAGE_DEFAULT_WIDTH * 2, editorRect.width - 42));
  document.body.style.cursor = 'nwse-resize';
  document.body.style.userSelect = 'none';
  block.classList.add('image-resizing');
  try { handle.setPointerCapture?.(e.pointerId); } catch (_) {}

  const move = evt => {
    evt.preventDefault();
    const delta = evt.clientX - e.clientX;
    const width = Math.max(NOTE_IMAGE_MIN_WIDTH, Math.min(maxWidth, Math.round(startWidth + delta)));
    img.setAttribute('width', String(width));
  };

  const finish = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    try { handle.releasePointerCapture?.(e.pointerId); } catch (_) {}
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    block.classList.remove('image-resizing');
    getEd().dispatchEvent(new Event('input'));
    scheduleUndoSnapshot();
  };

  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

function normalizeCodeThemeStyles(root = getEd()) {
  root.querySelectorAll?.('code, pre, code [style], pre [style]').forEach(el => {
    el.style.color = '';
    el.style.background = '';
    el.style.backgroundColor = '';
    el.style.borderColor = '';
    el.style.fontFamily = '';
    el.style.fontSize = '';
    if (!el.getAttribute('style')) el.removeAttribute('style');
  });
}

function restoreChecklistState(root) {
  root.querySelectorAll('ul.checklist > li').forEach(li => {
    // remove legacy check-box spans (visual now handled by CSS ::before)
    li.querySelectorAll('.check-box').forEach(el => el.remove());
    // migrate old format that used input[type=checkbox]
    const oldCb = li.querySelector('input[type="checkbox"]');
    if (oldCb) { if (oldCb.checked) li.classList.add('checked'); oldCb.remove(); }
  });
  normalizeChecklistStructure(root);
}

function listItemOwnContentFragment(li) {
  const clone = li.cloneNode(true);
  clone.querySelectorAll(':scope > ul, :scope > ol').forEach(list => list.remove());
  return clone;
}

function listItemHasOwnContent(li) {
  const own = listItemOwnContentFragment(li);
  if (own.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim()) return true;
  return !![...own.childNodes].some(node => node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR');
}

function isChecklistPlaceholderNode(node) {
  if (!node) return false;
  if (node.nodeType === Node.TEXT_NODE) return !node.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim();
  return node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR';
}

function removePlaceholdersBeforeNestedChecklist(li) {
  let changed = false;
  [...li.children].forEach(child => {
    if (child.tagName !== 'UL' || !child.classList.contains('checklist')) return;
    let prev = child.previousSibling;
    while (isChecklistPlaceholderNode(prev)) {
      const remove = prev;
      prev = prev.previousSibling;
      remove.remove();
      changed = true;
    }
  });
  return changed;
}

function normalizeChecklistStructure(root) {
  if (!root) return false;
  let changed = false;

  root.querySelectorAll('ul.checklist').forEach(list => {
    [...list.children].forEach(child => {
      if (child.tagName !== 'UL' || !child.classList.contains('checklist')) return;
      const previousLi = child.previousElementSibling?.tagName === 'LI' ? child.previousElementSibling : null;
      if (!previousLi) return;
      previousLi.appendChild(child);
      changed = true;
    });
  });

  root.querySelectorAll('ul.checklist > li').forEach(li => {
    if (removePlaceholdersBeforeNestedChecklist(li)) changed = true;
    if (listItemHasOwnContent(li)) return;
    const nestedLists = [...li.children].filter(child => child.tagName === 'UL' && child.classList.contains('checklist'));
    const previousLi = li.previousElementSibling?.tagName === 'LI' ? li.previousElementSibling : null;
    if (!nestedLists.length || !previousLi) return;
    nestedLists.forEach(list => previousLi.appendChild(list));
    li.remove();
    changed = true;
  });

  return changed;
}

function checklistSelectionSnapshot() {
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  let caretLi = null;
  let caretOffset = 0;
  if (range?.collapsed) {
    const owner = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const li = owner?.closest?.('li');
    if (li?.parentElement?.classList.contains('checklist')) {
      caretLi = li;
      const beforeCaret = document.createRange();
      beforeCaret.selectNodeContents(li);
      beforeCaret.setEnd(range.startContainer, range.startOffset);
      caretOffset = beforeCaret.toString().length;
    }
  }
  return {
    range,
    collapsed: !!range?.collapsed,
    caretLi,
    caretOffset,
    bookmark: captureEditorSelection(getEd())
  };
}

function restoreChecklistSelection(snapshot, fallbackLi = null) {
  const ed = getEd();
  if (ed && snapshot?.collapsed) {
    const targetLi = snapshot.caretLi?.isConnected ? snapshot.caretLi : fallbackLi;
    if (targetLi?.isConnected) {
      const point = rangePointFromTextOffset(targetLi, snapshot.caretLi ? snapshot.caretOffset : 0);
      const range = document.createRange();
      range.setStart(point.node, point.offset);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ed.focus();
      refreshUndoSnapshotSelection();
      return;
    }
  }

  if (ed && snapshot?.bookmark) {
    restoreEditorSelection(ed, { ...snapshot.bookmark, startPath: null, endPath: null });
    return;
  }

  const sel = window.getSelection();
  const range = snapshot?.range;
  if (ed && sel && range) {
    const startOwner = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const endOwner = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer
      : range.endContainer.parentElement;
    if (startOwner && endOwner && ed.contains(startOwner) && ed.contains(endOwner)) {
      try {
        sel.removeAllRanges();
        sel.addRange(range);
        ed.focus();
        refreshUndoSnapshotSelection();
        return;
      } catch (_) {}
    }
  }
}

function getOrCreateNestedChecklist(li) {
  let nested = li.querySelector(':scope > ul.checklist');
  if (!nested) {
    nested = document.createElement('ul');
    nested.className = 'checklist';
    removePlaceholdersBeforeNestedChecklist(li);
    li.appendChild(nested);
  }
  return nested;
}

function normalizeChecklistCommandItems(items) {
  const first = items?.find(item => item?.tagName === 'LI' && item.parentElement?.classList.contains('checklist'));
  const parentList = first?.parentElement;
  if (!parentList) return [];
  const selected = new Set(items.filter(item => item?.parentElement === parentList));
  return [...parentList.children].filter(child => child.tagName === 'LI' && selected.has(child));
}

function checklistItemsForCommand(li) {
  if (!li || li.tagName !== 'LI' || !li.parentElement?.classList.contains('checklist')) return [];
  const sel = window.getSelection();
  const ed = getEd();
  if (!sel || !sel.rangeCount || sel.isCollapsed || !ed) return [li];

  const range = sel.getRangeAt(0);
  const owner = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!owner || !ed.contains(owner)) return [li];

  const parentList = li.parentElement;
  const items = [...parentList.children].filter(item => {
    if (item.tagName !== 'LI') return false;
    try { return range.intersectsNode(item); }
    catch (_) { return false; }
  });
  return items.length ? items : [li];
}

function checklistLiFromCollapsedElementRange(range) {
  const container = range?.startContainer;
  if (!container || container.nodeType !== Node.ELEMENT_NODE) return null;
  if (container.tagName === 'LI' && container.parentElement?.classList.contains('checklist')) return container;

  if (container.tagName === 'UL' && container.classList.contains('checklist')) {
    const children = [...container.children].filter(child => child.tagName === 'LI');
    if (!children.length) return null;

    const childAtOffset = container.childNodes[range.startOffset];
    const childBeforeOffset = container.childNodes[Math.max(0, range.startOffset - 1)];
    if (childAtOffset?.tagName === 'LI') return childAtOffset;
    if (childBeforeOffset?.tagName === 'LI') return childBeforeOffset;

    const nodeIndex = node => [...container.childNodes].indexOf(node);
    return children.find(child => nodeIndex(child) >= range.startOffset) || children[children.length - 1];
  }

  const childAtOffset = container.childNodes[range.startOffset];
  const childBeforeOffset = container.childNodes[Math.max(0, range.startOffset - 1)];
  const list = [childAtOffset, childBeforeOffset].find(node =>
    node?.nodeType === Node.ELEMENT_NODE &&
    node.tagName === 'UL' &&
    node.classList.contains('checklist')
  );
  return list?.querySelector(':scope > li') || null;
}

function currentChecklistItemFromSelection() {
  const li = ancestorOfType(['li']);
  if (li && li.closest('ul.checklist')) return li;

  const sel = window.getSelection();
  const ed = getEd();
  if (!sel || !sel.rangeCount || !ed) return null;
  const range = sel.getRangeAt(0);
  if (sel.isCollapsed) return checklistLiFromCollapsedElementRange(range);

  const owner = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!owner || !ed.contains(owner)) return null;

  const candidates = [...ed.querySelectorAll('ul.checklist > li')].filter(item => {
    try { return range.intersectsNode(item); }
    catch (_) { return false; }
  });
  return candidates.find(item => !candidates.some(other => other !== item && item.contains(other))) || null;
}

function checklistIndentItems(items) {
  const commandItems = normalizeChecklistCommandItems(items);
  if (!commandItems.length) return false;

  let anchor = commandItems[0].previousElementSibling;
  let itemsToMove = commandItems;
  if (!anchor && commandItems.length > 1) {
    anchor = commandItems[0];
    itemsToMove = commandItems.slice(1);
  }
  if (!anchor || !itemsToMove.length) return false;

  const snapshot = checklistSelectionSnapshot();
  const nested = getOrCreateNestedChecklist(anchor);
  itemsToMove.forEach(item => nested.appendChild(item));
  normalizeChecklistStructure(anchor.closest('ul.checklist') || getEd());
  restoreChecklistSelection(snapshot, itemsToMove[0]);
  return true;
}

function checklistOutdentItems(items) {
  const commandItems = normalizeChecklistCommandItems(items);
  if (!commandItems.length) return false;

  const parentList = commandItems[0].parentElement;
  const parentLi = parentList.parentElement;
  if (!parentLi || parentLi.tagName !== 'LI') return false;
  const grandParent = parentLi.parentElement;
  if (!grandParent) return false;

  const snapshot = checklistSelectionSnapshot();
  const lastMoved = commandItems[commandItems.length - 1];
  const followingSiblings = [];
  let next = lastMoved.nextElementSibling;
  while (next) {
    followingSiblings.push(next);
    next = next.nextElementSibling;
  }

  const insertBefore = parentLi.nextSibling;
  commandItems.forEach(item => grandParent.insertBefore(item, insertBefore));

  if (followingSiblings.length) {
    const nested = getOrCreateNestedChecklist(lastMoved);
    followingSiblings.forEach(sibling => nested.appendChild(sibling));
  }

  if (!parentList.querySelector(':scope > li')) parentList.remove();
  normalizeChecklistStructure(grandParent);
  restoreChecklistSelection(snapshot, commandItems[0]);
  return true;
}

// Custom indent for a checklist li: move it into a nested ul.checklist under its
// previous sibling. Relies on pure DOM manipulation — not execCommand — so the
// checklist class is never lost.
function checklistIndent(li) {
  return checklistIndentItems(checklistItemsForCommand(li));
}

// Custom outdent for a checklist li: move it to after its parent li in the
// grandparent checklist. Siblings that come after it stay as a sub-list.
function checklistOutdent(li) {
  return checklistOutdentItems(checklistItemsForCommand(li));
}

// Extract a single li from its parent list into a new <ul> with the given class.
// Items before li stay in a new copy of the original list; items after do the same.
// The cursor (saved selection) is preserved across the DOM restructuring.
function splitListAtLi(li, newListClass) {
  const parentList = li.parentElement;
  const grandParent = parentList.parentElement;
  if (!grandParent) return;

  const sel = window.getSelection();
  const savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;

  const siblings = [...parentList.children];
  const idx = siblings.indexOf(li);
  const before = siblings.slice(0, idx);
  const after  = siblings.slice(idx + 1);

  const origTag   = parentList.tagName.toLowerCase();
  const origClass = parentList.className;

  // Items before the current li stay in a list of the same original type
  if (before.length) {
    const bl = document.createElement(origTag);
    bl.className = origClass;
    before.forEach(n => bl.appendChild(n));
    grandParent.insertBefore(bl, parentList);
  }

  // The extracted li goes into a new <ul> with the requested class
  const newList = document.createElement('ul');
  if (newListClass) newList.className = newListClass;
  if (newListClass !== 'checklist') li.classList.remove('checked');
  newList.appendChild(li);
  grandParent.insertBefore(newList, parentList);

  // Items after the current li stay in a list of the same original type
  if (after.length) {
    const al = document.createElement(origTag);
    al.className = origClass;
    after.forEach(n => al.appendChild(n));
    grandParent.insertBefore(al, parentList);
  }

  // Original list is now empty — remove it
  parentList.remove();

  if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
}

function refreshEmpty(el) {
  const hasText = !!el.innerText.trim();
  const hasStructure = !!el.querySelector('ul, ol, hr, h1, h2, h3, h4, blockquote, pre, table');
  el.classList.toggle('is-empty', !hasText && !hasStructure);
}

function capitalizeCurrentChar(charLen) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const node   = sel.anchorNode;
  const offset = sel.anchorOffset;
  if (!node || node.nodeType !== Node.TEXT_NODE || offset < charLen) return;
  const text = node.textContent;
  const pos  = offset - charLen;
  if (/[a-z]/.test(text[pos])) {
    node.textContent = text.slice(0, pos) + text[pos].toUpperCase() + text.slice(pos + 1);
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

function placeCursorAtStart(el) {
  const range = document.createRange(), sel = window.getSelection();
  range.selectNodeContents(el); range.collapse(true);
  getEd().focus();
  sel.removeAllRanges(); sel.addRange(range);
  refreshUndoSnapshotSelection();
}

function placeCursorAtEnd(el) {
  const range = document.createRange(), sel = window.getSelection();
  range.selectNodeContents(el); range.collapse(false);
  sel.removeAllRanges(); sel.addRange(range); el.focus();
  refreshUndoSnapshotSelection();
}

function nodePathFromRoot(root, node) {
  const path = [];
  let cur = node;
  while (cur && cur !== root) {
    const parent = cur.parentNode;
    if (!parent) return null;
    path.unshift([...parent.childNodes].indexOf(cur));
    cur = parent;
  }
  return cur === root ? path : null;
}

function nodeFromRootPath(root, path) {
  if (!Array.isArray(path)) return null;
  let node = root;
  for (const index of path) {
    if (!node?.childNodes || index < 0 || index >= node.childNodes.length) return null;
    node = node.childNodes[index];
  }
  return node;
}

function clampRangeOffset(node, offset) {
  const max = node.nodeType === Node.TEXT_NODE ? node.textContent.length : node.childNodes.length;
  return Math.max(0, Math.min(Number(offset) || 0, max));
}

function captureEditorSelection(root = getEd()) {
  const sel = window.getSelection();
  if (!root || !sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const startOwner = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const endOwner = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  if (!startOwner || !endOwner || !root.contains(startOwner) || !root.contains(endOwner)) return null;

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
}

function rangePointFromTextOffset(root, offset) {
  const target = Math.max(0, Number(offset) || 0);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = target;
  let lastText = null;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    lastText = node;
    const len = node.textContent.length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
  }

  if (lastText) return { node: lastText, offset: lastText.textContent.length };
  return { node: root, offset: root.childNodes.length };
}

function restoreEditorSelection(root = getEd(), bookmark) {
  if (!root) return;
  if (!bookmark) { placeCursorAtEnd(root); return; }
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const startNode = nodeFromRootPath(root, bookmark.startPath);
  const endNode = nodeFromRootPath(root, bookmark.collapsed ? bookmark.startPath : bookmark.endPath);
  if (startNode && endNode) {
    try {
      range.setStart(startNode, clampRangeOffset(startNode, bookmark.startOffset));
      range.setEnd(endNode, clampRangeOffset(endNode, bookmark.collapsed ? bookmark.startOffset : bookmark.endOffset));
    } catch (_) {
      const start = rangePointFromTextOffset(root, bookmark.start);
      const end = rangePointFromTextOffset(root, bookmark.collapsed ? bookmark.start : bookmark.end);
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    }
  } else {
    const start = rangePointFromTextOffset(root, bookmark.start);
    const end = rangePointFromTextOffset(root, bookmark.collapsed ? bookmark.start : bookmark.end);
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  }
  sel.removeAllRanges();
  sel.addRange(range);
  root.focus();
  refreshUndoSnapshotSelection();
}

function placeCaretAfterTabDelete(block, textNode, offset) {
  const sel = window.getSelection();
  if (!sel) return;

  if (block && block !== getEd() && !block.textContent && !block.querySelector('img, hr, ul, ol')) {
    block.innerHTML = '';
    block.appendChild(document.createElement('br'));
    placeCursorAtStart(block);
    return;
  }

  const next = document.createRange();
  if (textNode?.isConnected) {
    next.setStart(textNode, Math.max(0, Math.min(offset, textNode.textContent.length)));
  } else if (block && block.isConnected) {
    next.setStart(block, 0);
  } else {
    next.setStart(getEd(), 0);
  }
  next.collapse(true);
  sel.removeAllRanges();
  sel.addRange(next);
}

function deletePreviousTabAtCaret() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const offset = range.startOffset;
  const block = currentBlockFromSelection();

  if (node.nodeType === Node.TEXT_NODE && offset > 0 && node.textContent[offset - 1] === '\t') {
    pushUndo();
    node.textContent = node.textContent.slice(0, offset - 1) + node.textContent.slice(offset);
    placeCaretAfterTabDelete(block, node, offset - 1);
    return true;
  }

  if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
    const prev = node.childNodes[offset - 1];
    if (prev?.nodeType === Node.TEXT_NODE && prev.textContent.endsWith('\t')) {
      pushUndo();
      prev.textContent = prev.textContent.slice(0, -1);
      placeCaretAfterTabDelete(block, prev, prev.textContent.length);
      return true;
    }
  }

  return false;
}

function isEmptyListItem(li) {
  if (!li || li.tagName !== 'LI' || li.querySelector(':scope > ul, :scope > ol')) return false;
  return !li.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim();
}

function removeEmptyListItem(li) {
  const list = li.parentElement;
  if (!list || !/^(UL|OL)$/.test(list.tagName)) return false;

  const prev = li.previousElementSibling;
  const next = li.nextElementSibling;
  const parentLi = list.parentElement?.tagName === 'LI' ? list.parentElement : null;
  li.remove();

  if (!list.querySelector(':scope > li')) {
    if (parentLi) {
      list.remove();
      placeCursorAtEnd(parentLi);
    } else {
      const p = createEmptyBlock('p');
      list.replaceWith(p);
      placeCursorAtStart(p);
    }
  } else if (prev) {
    placeCursorAtEnd(prev);
  } else if (next) {
    placeCursorAtStart(next);
  }

  return true;
}

function fragmentHasMeaningfulContent(fragment) {
  if (!fragment) return false;
  if (fragment.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim()) return true;
  return !!fragment.querySelector?.('img, table, hr, pre, blockquote, .note-image-block, .note-alarm, .mention, .note-conversation-anchor');
}

function isCaretAtStartOfListItem(li) {
  const sel = window.getSelection();
  if (!li || !sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const owner = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  if (!owner || !li.contains(owner)) return false;

  const beforeCaret = document.createRange();
  beforeCaret.selectNodeContents(li);
  try {
    beforeCaret.setEnd(range.startContainer, range.startOffset);
  } catch (_) {
    return false;
  }
  return !fragmentHasMeaningfulContent(beforeCaret.cloneContents());
}

function unlistLeadingListItem(li) {
  const list = li?.parentElement;
  if (!list || !/^(UL|OL)$/.test(list.tagName) || list.classList.contains('checklist')) return false;
  if (list.parentElement !== getEd()) return false;
  if (li.previousElementSibling) return false;

  const p = document.createElement('p');
  const trailingLists = [];
  while (li.firstChild) {
    const child = li.firstChild;
    if (child.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(child.tagName)) {
      trailingLists.push(child);
      child.remove();
    } else {
      p.appendChild(child);
    }
  }
  if (!fragmentHasMeaningfulContent(p)) p.appendChild(document.createElement('br'));

  const inserts = [p, ...trailingLists];
  if (list.children.length === 1) {
    list.replaceWith(...inserts);
  } else {
    list.before(...inserts);
    li.remove();
  }

  placeCursorAtStart(p);
  return true;
}

function decorateLink(link, href) {
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
}

function normalizeHttpUrlValue(raw) {
  const value = String(raw || '').trim();
  if (!value || /\s/.test(value)) return '';
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

function unwrapElement(el) {
  const frag = document.createDocumentFragment();
  while (el.firstChild) frag.appendChild(el.firstChild);
  el.replaceWith(frag);
}

function applyLinkToSelection(href) {
  const safeHref = normalizeHttpUrlValue(href);
  const range = getEditorSelectionRange();
  if (!safeHref || !range || range.collapsed) return false;

  const link = document.createElement('a');
  decorateLink(link, safeHref);
  const contents = range.extractContents();
  contents.querySelectorAll?.('a').forEach(unwrapElement);
  link.appendChild(contents);

  range.insertNode(link);
  range.setStartAfter(link);
  range.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return true;
}

function ensureLinkAttrs(root) {
  root.querySelectorAll('a[href]').forEach(link => decorateLink(link, link.getAttribute('href')));
}

function buildLinkFragment(text) {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/gi;
  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  let changed = false;
  let match;

  while ((match = pattern.exec(text))) {
    changed = true;
    if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    const href = match[2] || match[3];
    const link = document.createElement('a');
    decorateLink(link, href);
    link.textContent = match[1] || href;
    frag.appendChild(link);
    lastIndex = match.index + match[0].length;
  }

  if (!changed) return null;
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  return frag;
}

function linkifyTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentNode;
      if (!parent || parent.closest('a, code, pre, script, style')) return NodeFilter.FILTER_REJECT;
      return /(https?:\/\/[^\s<]+|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/i.test(node.textContent)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  while (walker.nextNode()) nodes.push(walker.currentNode);

  let changed = false;
  nodes.forEach(node => {
    const frag = buildLinkFragment(node.textContent);
    if (!frag) return;
    changed = true;
    node.parentNode.replaceChild(frag, node);
  });

  if (changed) ensureLinkAttrs(root);
  return changed;
}

function hasLinkifiableTextNodes(root) {
  if (!root) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentNode;
      if (!parent || parent.closest('a, code, pre, script, style')) return NodeFilter.FILTER_REJECT;
      return /(https?:\/\/[^\s<]+|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/i.test(node.textContent)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });
  return !!walker.nextNode();
}

function setSaveState(s) {
  const dot = document.getElementById('save-dot');
  const lbl = document.getElementById('save-label');
  const cfg = { saved:['saved','Saved'], unsaved:['unsaved','Saving'], saving:['saving','Saving...'], error:['error','Error'], local:['local','Local'], readonly:['local','Read Only'] };
  const [cls, txt] = cfg[s] || cfg.local;
  dot.className = 'save-dot ' + cls; lbl.textContent = txt;
}

function updateCounts() {
  const txt   = (document.getElementById('editor').innerText || '').replace(/\u200b/g, '');
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  const chars = txt.length;
  document.getElementById('word-count').textContent = words + (words === 1 ? ' Word' : ' Words');
  document.getElementById('char-count').textContent = chars + (chars === 1 ? ' Character' : ' Characters');
}

function showEditorView(show) {
  document.getElementById('empty-state').style.display = show ? 'none' : 'flex';
  document.getElementById('editorView').style.display  = show ? 'flex' : 'none';
  if (!show && typeof listenToConversationsForNote === 'function') listenToConversationsForNote(null);
}

/* Delete Modal */

const HEADER_DOMAIN_END_ATTR = 'data-header-domain-end';

function headingLevel(el) {
  return /^H[1-4]$/.test(el?.tagName || '') ? parseInt(el.tagName[1], 10) : null;
}

function outsideCollapseLevel(el) {
  const level = parseInt(el?.getAttribute?.('data-outside-collapse') || '', 10);
  return Number.isFinite(level) ? level : null;
}

function clearHeaderDomainEnds(root = getEd()) {
  root?.querySelectorAll?.('[' + HEADER_DOMAIN_END_ATTR + ']').forEach(el => {
    el.removeAttribute(HEADER_DOMAIN_END_ATTR);
  });
}

function addHeaderDomainEnds(root = getEd()) {
  if (!root) return;
  const children = [...root.children];
  children.forEach((heading, index) => {
    const level = headingLevel(heading);
    if (!level || heading.hasAttribute('data-collapsed')) return;

    let lastVisible = null;
    for (let i = index + 1; i < children.length; i++) {
      const child = children[i];
      const childLevel = headingLevel(child);
      if (childLevel && childLevel <= level) break;
      const childOutsideLevel = outsideCollapseLevel(child);
      if (childOutsideLevel && childOutsideLevel <= level) break;
      if (child.style.display !== 'none') lastVisible = child;
    }
    if (!lastVisible) return;

    const levels = new Set(
      String(lastVisible.getAttribute(HEADER_DOMAIN_END_ATTR) || '')
        .split(/\s+/)
        .filter(Boolean)
    );
    levels.add(String(level));
    lastVisible.setAttribute(HEADER_DOMAIN_END_ATTR, [...levels].sort().join(' '));
  });
}

function recomputeCollapsedSections() {
  const ed = getEd();
  if (!ed) return;
  clearHeaderDomainEnds(ed);
  let collapsedLevel = Infinity;
  for (const el of ed.children) {
    const level = headingLevel(el);
    const isHeading = !!level;
    if (el.hasAttribute('data-outside-collapse')) {
      const outsideLevel = parseInt(el.getAttribute('data-outside-collapse'));
      if (collapsedLevel >= outsideLevel) {
        collapsedLevel = Infinity;
      }
    }
    if (isHeading) {
      if (level <= collapsedLevel) {
        collapsedLevel = Infinity;
        el.style.display = '';
        if (el.hasAttribute('data-collapsed')) collapsedLevel = level;
      } else {
        el.style.display = 'none';
      }
    } else {
      el.style.display = collapsedLevel < Infinity ? 'none' : '';
    }
  }
  addHeaderDomainEnds(ed);
}

function parseHeaderDomainEndLevels(el) {
  return String(el?.getAttribute?.(HEADER_DOMAIN_END_ATTR) || '')
    .split(/\s+/)
    .map(value => parseInt(value, 10))
    .filter(Number.isFinite);
}

function headerDomainEndFromSelection(range) {
  const ed = getEd();
  const node = range?.startContainer;
  const owner = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const marker = owner?.closest?.('[' + HEADER_DOMAIN_END_ATTR + ']');
  return marker && ed?.contains(marker) ? marker : null;
}

function rangeRect(range) {
  if (!range) return null;
  const rects = [...range.getClientRects()].filter(rect => rect.width || rect.height);
  if (rects.length) return rects[rects.length - 1];
  const rect = range.getBoundingClientRect?.();
  return rect && (rect.width || rect.height) ? rect : null;
}

function isCaretAtEndOfElement(el, range) {
  if (!el || !range?.collapsed) return false;
  const afterCaret = document.createRange();
  afterCaret.selectNodeContents(el);
  try {
    afterCaret.setStart(range.startContainer, range.startOffset);
  } catch (_) {
    return false;
  }
  return !fragmentHasMeaningfulContent(afterCaret.cloneContents());
}

function isCaretOnLastVisualLineOfElement(el, range) {
  if (!el || !range?.collapsed) return false;
  const contentRange = document.createRange();
  contentRange.selectNodeContents(el);
  const contentRects = [...contentRange.getClientRects()].filter(rect => rect.width || rect.height);
  const caret = rangeRect(range);
  if (!caret || !contentRects.length) return isCaretAtEndOfElement(el, range);
  const lastBottom = Math.max(...contentRects.map(rect => rect.bottom));
  return caret.bottom >= lastBottom - 4;
}

function nextOutsideHeaderDomainTarget(el, level) {
  const next = el?.nextElementSibling;
  if (!next || next.style.display === 'none') return null;
  const nextOutsideLevel = outsideCollapseLevel(next);
  return nextOutsideLevel && nextOutsideLevel <= level ? next : null;
}

function moveCaretBeyondHeaderDomainEnd() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const marker = headerDomainEndFromSelection(range);
  if (!marker || !isCaretOnLastVisualLineOfElement(marker, range)) return false;

  const levels = parseHeaderDomainEndLevels(marker);
  if (!levels.length) return false;
  const exitLevel = Math.max(...levels);
  const existingTarget = nextOutsideHeaderDomainTarget(marker, exitLevel);
  if (existingTarget) {
    placeCursorAtStart(existingTarget);
    return true;
  }

  pushUndo();
  const p = createEmptyBlock('p');
  p.setAttribute('data-outside-collapse', String(exitLevel));
  marker.after(p);
  recomputeCollapsedSections();
  placeCursorAtStart(p);
  getEd().dispatchEvent(new Event('input'));
  return true;
}

function outermostListForItem(li) {
  const ed = getEd();
  let list = li?.parentElement;
  if (!list || !/^(UL|OL)$/.test(list.tagName) || !ed?.contains(list)) return null;
  let outer = list;
  while (outer.parentElement && outer.parentElement !== ed) {
    const parentList = outer.parentElement.closest?.('ul, ol');
    if (!parentList || !ed.contains(parentList)) break;
    outer = parentList;
  }
  return outer;
}

function cleanLineInsertionInfo(block) {
  const ed = getEd();
  if (!ed || !block || block === ed) return { boundary: ed, visual: ed, outsideLevel: 0 };

  const li = block.closest?.('li');
  if (li && ed.contains(li)) {
    const list = outermostListForItem(li);
    const listBoundary = list || li;
    const styledContainer = listBoundary.closest?.('blockquote, pre');
    const boundary = styledContainer && ed.contains(styledContainer) ? styledContainer : listBoundary;
    return { boundary, visual: boundary, outsideLevel: 0 };
  }

  const container = block.closest?.('blockquote, pre') || block;
  const heading = container.matches?.('h1,h2,h3,h4') ? container : null;
  if (heading?.hasAttribute('data-collapsed')) {
    const level = parseInt(heading.tagName[1], 10);
    let boundary = heading;
    let sibling = heading.nextElementSibling;
    while (sibling) {
      const siblingLevel = headingLevel(sibling);
      if (siblingLevel && siblingLevel <= level) break;
      boundary = sibling;
      sibling = sibling.nextElementSibling;
    }
    return { boundary, visual: heading, outsideLevel: level };
  }

  return {
    boundary: ed.contains(container) ? container : block,
    visual: ed.contains(container) ? container : block,
    outsideLevel: 0
  };
}

function reusableCleanParagraph(el, outsideLevel = 0) {
  if (!el || el.tagName !== 'P' || el.style.display === 'none') return false;
  if (outsideLevel && el.getAttribute('data-outside-collapse') !== String(outsideLevel)) return false;
  return !fragmentHasMeaningfulContent(el);
}

function insertCleanLineBelowCaret() {
  const ed = getEd();
  const sel = window.getSelection();
  if (!ed || !sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const owner = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  if (!owner || (owner !== ed && !ed.contains(owner))) return false;

  const block = currentBlockFromSelection();
  const info = cleanLineInsertionInfo(block);
  if (!info.boundary || !isCaretOnLastVisualLineOfElement(info.visual || info.boundary, range)) return false;

  pushUndo();
  let target = info.boundary === ed ? null : info.boundary.nextElementSibling;
  if (!reusableCleanParagraph(target, info.outsideLevel)) {
    target = createEmptyBlock('p');
    if (info.outsideLevel) target.setAttribute('data-outside-collapse', String(info.outsideLevel));
    if (info.boundary === ed) ed.appendChild(target);
    else info.boundary.after(target);
  }
  recomputeCollapsedSections();
  placeCursorAtStart(target);
  ed.dispatchEvent(new Event('input'));
  return true;
}

function saveCollapsedState(noteId) {
  if (!noteId) return;
  const headings = [...getEd().querySelectorAll('h1,h2,h3,h4')];
  const indices = headings.reduce((acc, h, i) => { if (h.hasAttribute('data-collapsed')) acc.push(i); return acc; }, []);
  if (indices.length) localStorage.setItem('notas_col_' + noteId, JSON.stringify(indices));
  else localStorage.removeItem('notas_col_' + noteId);
}

function restoreCollapsedState(noteId) {
  const raw = noteId ? localStorage.getItem('notas_col_' + noteId) : null;
  if (raw) {
    try {
      const indices = JSON.parse(raw);
      const headings = [...getEd().querySelectorAll('h1,h2,h3,h4')];
      indices.forEach(i => { if (headings[i]) headings[i].setAttribute('data-collapsed', ''); });
    } catch (_) {}
  }
  recomputeCollapsedSections();
}

function getCleanHTML() {
  const clone = getEd().cloneNode(true);
  clone.querySelectorAll('[data-collapsed]').forEach(el => el.removeAttribute('data-collapsed'));
  clone.querySelectorAll('[' + HEADER_DOMAIN_END_ATTR + ']').forEach(el => el.removeAttribute(HEADER_DOMAIN_END_ATTR));
  clone.querySelectorAll('.note-alarm').forEach(el => {
    el.classList.remove('alarm-due');
    if (!el.classList.length) el.removeAttribute('class');
  });
  clone.querySelectorAll('.note-conversation-anchor').forEach(el => {
    el.classList.remove('conversation-anchor-focused');
  });
  cleanupInlineCodePlaceholders(clone);
  stripZeroWidthText(clone);
  normalizeCodeThemeStyles(clone);
  normalizeChecklistStructure(clone);
  stripTableEditorChrome(clone);
  stripNoteImageEditorChrome(clone);
  sanitizeEditorTables(clone);
  clone.querySelectorAll('[style]').forEach(el => { el.style.display = ''; if (!el.getAttribute('style')) el.removeAttribute('style'); });
  return clone.innerHTML;
}

function syncActiveNoteFromEditor() {
  if (!activeId || !notes[activeId]) return false;
  if (!canEditNote(notes[activeId])) return false;
  notes[activeId].content  = getCleanHTML();
  notes[activeId].modified = new Date().toISOString();
  updateCounts();
  const preview = document.querySelector('.sidebar-item.active .item-preview');
  if (preview) preview.textContent = editorEl.innerText.replace(/\u200b/g, '').replace(/\s+/g,' ').trim().slice(0,65) || 'Empty Note';
  return true;
}

let _toastTimer;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, 4000);
}


const getEd = () => document.getElementById('editor');
const cmd   = (command, value) => { getEd().focus(); document.execCommand(command, false, value || null); };

function currentBlockFromSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const edEl = getEd();
  while (node && node !== edEl) {
    if (node.nodeType === 1 && /^(P|DIV|LI|H1|H2|H3|H4|BLOCKQUOTE|PRE)$/.test(node.tagName)) return node;
    node = node.parentNode;
  }
  return edEl;
}

function swapBlock(block, nodes, caretTarget) {
  const replacements = Array.isArray(nodes) ? nodes : [nodes];
  if (block === getEd()) {
    block.innerHTML = '';
    replacements.forEach(node => block.appendChild(node));
  } else {
    block.replaceWith(...replacements);
  }
  placeCursorAtStart(caretTarget || replacements[0]);
}

function createEmptyBlock(tagName) {
  const el = document.createElement(tagName);
  el.appendChild(document.createElement('br'));
  return el;
}

function ancestorOfType(tags) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const edEl = getEd(), upper = tags.map(t => t.toUpperCase());
  while (node && node !== edEl) {
    if (node.nodeType === 1 && upper.includes(node.tagName)) return node;
    node = node.parentNode;
  }
  return null;
}

function toggleBlock(tag) {
  getEd().focus();
  document.execCommand('formatBlock', false, ancestorOfType([tag]) ? 'p' : tag);
}

function applyMarkdownShortcut() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;

  const range = sel.getRangeAt(0);
  const block = currentBlockFromSelection();
  if (!block) return false;

  const prefix = range.cloneRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(range.startContainer, range.startOffset);
  const marker = prefix.toString().replace(/\u00a0/g, ' ').trim();
  if (!marker) return false;

  if (block === getEd()) {
    const editorText = getEd().innerText.replace(/\u00a0/g, ' ').trim();
    if (editorText !== marker) return false;
  }

  // Extract trailing content (text after the marker) to preserve it
  function extractTrailingContent() {
    const tailRange = document.createRange();
    tailRange.setStart(range.startContainer, range.startOffset);
    tailRange.setEndAfter(block.lastChild || block);
    const frag = tailRange.extractContents();
    // Remove the marker prefix from the block
    prefix.deleteContents();
    return frag;
  }

  if (/^#{1,3}$/.test(marker)) {
    pushUndo();
    // Extract content after cursor, remove marker, build heading via DOM
    const tailRange = document.createRange();
    tailRange.setStart(range.startContainer, range.startOffset);
    if (block.lastChild) tailRange.setEndAfter(block.lastChild);
    else tailRange.setEnd(block, block.childNodes.length);
    const tail = tailRange.extractContents();
    prefix.deleteContents();
    const heading = document.createElement('h' + marker.length);
    if (tail.textContent || tail.childNodes.length > 0) heading.appendChild(tail);
    if (!heading.textContent && !heading.querySelector('br')) heading.appendChild(document.createElement('br'));
    if (block === getEd()) {
      // Remove any leftover empty nodes and prepend heading
      while (block.firstChild && !block.firstChild.textContent && block.firstChild.nodeName === 'BR') block.firstChild.remove();
      block.insertBefore(heading, block.firstChild);
    } else {
      block.replaceWith(heading);
    }
    placeCursorAtStart(heading);
    return true;
  }

  if (marker === '>') {
    pushUndo();
    const tail = extractTrailingContent();
    const quote = document.createElement('blockquote');
    if (tail.textContent || tail.childNodes.length > 0) quote.appendChild(tail);
    else quote.appendChild(document.createElement('br'));
    swapBlock(block, quote, quote);
    return true;
  }

  if (/^[-+*]$/.test(marker)) {
    pushUndo();
    const tail = extractTrailingContent();
    const list = document.createElement('ul');
    const item = document.createElement('li');
    if (tail.textContent || tail.childNodes.length > 0) item.appendChild(tail);
    else item.appendChild(document.createElement('br'));
    list.appendChild(item);
    swapBlock(block, list, item);
    return true;
  }

  if (/^\d+[.)]$/.test(marker)) {
    pushUndo();
    const tail = extractTrailingContent();
    const list = document.createElement('ol');
    const item = document.createElement('li');
    if (tail.textContent || tail.childNodes.length > 0) item.appendChild(tail);
    else item.appendChild(document.createElement('br'));
    list.appendChild(item);
    swapBlock(block, list, item);
    return true;
  }

  if (/^(-{3,}|\*{3,})$/.test(marker)) {
    pushUndo();
    const hr = document.createElement('hr');
    const paragraph = createEmptyBlock('p');
    swapBlock(block, [hr, paragraph], paragraph);
    return true;
  }

  return false;
}

function autoLinkTokenBeforeCaret() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;

  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  if (node.parentNode?.closest('a, code, pre')) return false;

  const before = node.textContent.slice(0, sel.anchorOffset);
  const after = node.textContent.slice(sel.anchorOffset);
  const markdownMatch = before.match(/(?:^|[\s(])(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))$/i);
  const urlMatch = markdownMatch ? null : before.match(/(?:^|[\s(])(https?:\/\/[^\s<]+)$/i);
  if (!markdownMatch && !urlMatch) return false;

  const token = markdownMatch ? markdownMatch[1] : urlMatch[1];
  const href = markdownMatch ? markdownMatch[3] : token;
  const label = markdownMatch ? markdownMatch[2] : href;
  const tokenStart = before.length - token.length;
  const head = before.slice(0, tokenStart);
  pushUndo();
  const link = document.createElement('a');
  decorateLink(link, href);
  link.textContent = label;

  const frag = document.createDocumentFragment();
  if (head) frag.appendChild(document.createTextNode(head));
  frag.appendChild(link);
  if (after) frag.appendChild(document.createTextNode(after));

  node.parentNode.replaceChild(frag, node);

  const range = document.createRange();
  range.setStartAfter(link);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function getEditorSelectionRange() {
  const sel = window.getSelection();
  const ed = getEd();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const owner = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (owner && ed.contains(owner)) return range;
  }
  ed.focus();
  return null;
}

function currentTableCellFromSelection() {
  const cell = ancestorOfType(['td', 'th']);
  return cell && getEd().contains(cell) ? cell : null;
}

function isSelectionInTable() {
  return !!currentTableCellFromSelection();
}

function closestInlineCodeFromSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  let code = node?.closest?.('code');
  if (!code && range.collapsed && range.startContainer.nodeType === Node.ELEMENT_NODE && range.startOffset > 0) {
    const previous = range.startContainer.childNodes[range.startOffset - 1];
    code = previous?.nodeType === Node.ELEMENT_NODE && previous.matches?.('code[data-inline-code-typing]')
      ? previous
      : null;
  }
  return code && !code.closest('pre') && getEd().contains(code) ? code : null;
}

function stripInlineCodePlaceholder(code) {
  if (!code) return;
  [...code.childNodes].forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) node.textContent = node.textContent.replace(/\u200b/g, '');
  });
  code.removeAttribute('data-inline-code-empty');
  code.removeAttribute('data-inline-code-typing');
}

function cleanupInlineCodePlaceholders(root = getEd()) {
  root.querySelectorAll?.('code[data-inline-code-empty]').forEach(code => {
    stripInlineCodePlaceholder(code);
    if (!code.textContent && !code.querySelector('img, br')) {
      const parent = code.parentNode;
      code.remove();
      parent?.normalize?.();
    }
  });
  root.querySelectorAll?.('code[data-inline-code-typing]').forEach(code => {
    code.removeAttribute('data-inline-code-typing');
  });
}

function stripZeroWidthText(root = getEd()) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.includes('\u200b')) nodes.push(walker.currentNode);
  }
  nodes.forEach(node => {
    node.textContent = node.textContent.replace(/\u200b/g, '');
    if (!node.textContent) node.remove();
  });
}

function textNodeIsInInlineCode(node) {
  const parent = node?.parentNode?.nodeType === Node.ELEMENT_NODE ? node.parentNode : null;
  const code = parent?.closest?.('code');
  return !!(code && !code.closest('pre'));
}

function cleanupLiveInlineCodeBoundaries(root = getEd(), inputEvent = null) {
  if (!root || !inputEvent?.inputType) return;
  const sel = window.getSelection();
  const anchor = sel?.rangeCount && sel.isCollapsed && root.contains(sel.anchorNode) ? sel.anchorNode : null;
  let restoredSelection = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent.includes('\u200b') && !textNodeIsInInlineCode(node)) nodes.push(node);
  }

  nodes.forEach(node => {
    const oldText = node.textContent;
    if (node === anchor) {
      const offset = sel.anchorOffset;
      const removedBeforeCaret = (oldText.slice(0, offset).match(/\u200b/g) || []).length;
      node.textContent = oldText.replace(/\u200b/g, '');
      const range = document.createRange();
      range.setStart(node, Math.max(0, Math.min(node.textContent.length, offset - removedBeforeCaret)));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      restoredSelection = true;
      return;
    }
    node.textContent = oldText.replace(/\u200b/g, '');
    if (!node.textContent) node.remove();
  });

  if (restoredSelection) root.focus();
}

function placeCaretAfterInlineCode(code) {
  const parent = code?.parentNode;
  if (!parent) return;
  let marker = code.nextSibling;
  if (marker?.nodeType === Node.TEXT_NODE) {
    if (!marker.textContent.startsWith('\u200b')) marker.textContent = '\u200b' + marker.textContent;
  } else {
    marker = document.createTextNode('\u200b');
    parent.insertBefore(marker, code.nextSibling);
  }
  const range = document.createRange();
  range.setStart(marker, 1);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  getEd().focus();
}

function exitInlineCode(code) {
  if (!code) return;
  stripInlineCodePlaceholder(code);
  const parent = code.parentNode;
  if (!code.textContent && !code.querySelector('img, br')) {
    const marker = document.createTextNode('\u200b');
    parent.insertBefore(marker, code);
    code.remove();
    const range = document.createRange();
    range.setStart(marker, 1);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    getEd().focus();
    return;
  }
  placeCaretAfterInlineCode(code);
}

function unwrapInlineCode(code) {
  const parent = code?.parentNode;
  if (!parent) return;
  const first = code.firstChild;
  const last = code.lastChild;
  while (code.firstChild) parent.insertBefore(code.firstChild, code);
  code.remove();
  parent.normalize?.();
  const range = document.createRange();
  if (first?.isConnected && last?.isConnected) {
    range.setStartBefore(first);
    range.setEndAfter(last);
  } else {
    range.selectNodeContents(parent);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function expandRangeToCurrentWord(range) {
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const node = range.startContainer;
  const text = node.textContent;
  let start = range.startOffset;
  let end = range.startOffset;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  while (end < text.length && !/\s/.test(text[end])) end++;
  if (start === end) return false;
  range.setStart(node, start);
  range.setEnd(node, end);
  return true;
}

function unwrapNestedInlineCode(root) {
  root.querySelectorAll?.('code').forEach(code => {
    if (code.closest('pre')) return;
    const parent = code.parentNode;
    while (code.firstChild) parent.insertBefore(code.firstChild, code);
    code.remove();
  });
}

function insertInlineCode() {
  const sel = window.getSelection();
  const existingCode = closestInlineCodeFromSelection();
  if (existingCode) {
    if (sel?.isCollapsed) exitInlineCode(existingCode);
    else unwrapInlineCode(existingCode);
    getEd().dispatchEvent(new Event('input'));
    return;
  }
  if (ancestorOfType(['pre'])) {
    insertCodeBlock();
    return;
  }

  const range = getEditorSelectionRange();
  if (!range) return;
  if (!range.collapsed && range.toString().includes('\n')) {
    insertCodeBlock();
    return;
  }

  const code  = document.createElement('code');
  if (range.collapsed) {
    const marker = document.createTextNode('\u200b');
    code.dataset.inlineCodeEmpty = '1';
    code.dataset.inlineCodeTyping = '1';
    code.appendChild(marker);
    range.insertNode(code);
    const r2 = document.createRange();
    r2.setStart(marker, marker.length);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    getEd().dispatchEvent(new Event('input'));
    return;
  } else {
    const fragment = range.extractContents();
    unwrapNestedInlineCode(fragment);
    code.appendChild(fragment);
  }
  range.insertNode(code);
  const r2 = document.createRange(); r2.selectNodeContents(code);
  sel.removeAllRanges(); sel.addRange(r2);
  getEd().dispatchEvent(new Event('input'));
}

function createCodeBlockElement(text = '') {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text || 'Code Block';
  pre.appendChild(code);
  return { pre, code };
}

function insertCodeBlock() {
  if (isSelectionInTable()) {
    showToast('Tables Support Simple Text Only', 'error');
    return;
  }
  const existingPre = ancestorOfType(['pre']);
  if (existingPre) {
    const p = document.createElement('p');
    p.textContent = existingPre.textContent || '';
    if (!p.textContent) p.appendChild(document.createElement('br'));
    existingPre.replaceWith(p);
    placeCursorAtEnd(p);
    getEd().dispatchEvent(new Event('input'));
    return;
  }

  const range = getEditorSelectionRange();
  if (!range) return;
  const sel = window.getSelection();
  const block = currentBlockFromSelection();
  const selectedText = range.collapsed ? '' : range.toString();
  const { pre, code } = createCodeBlockElement(selectedText || (block && block !== getEd() && block.tagName !== 'LI' ? block.textContent.trim() : ''));

  if (range.collapsed && block && block !== getEd() && !['LI', 'TD', 'TH'].includes(block.tagName)) {
    block.replaceWith(pre);
  } else {
    if (!range.collapsed) range.deleteContents();
    range.insertNode(pre);
  }

  if (!pre.nextElementSibling || pre.nextElementSibling.tagName !== 'P') {
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    pre.after(p);
  }
  const r2 = document.createRange();
  r2.selectNodeContents(code);
  sel.removeAllRanges(); sel.addRange(r2);
  getEd().dispatchEvent(new Event('input'));
}

function tableCaptionText(table) {
  return table?.caption?.textContent?.trim() || '';
}

function setTableCaptionText(table, text) {
  if (!table) return;
  const value = String(text || '').trim();
  if (!value) {
    table.caption?.remove();
    return;
  }
  const caption = table.caption || table.createCaption();
  caption.textContent = value;
}

function tableTitleInputHTML(title = '') {
  const cleanTitle = String(title || '').trim();
  return '<input class="table-title-input" data-table-title-input type="text" value="' + esc(cleanTitle) + '" aria-label="Table header" />';
}

function tableTitleButtonHTML() {
  return '<button class="table-title-add-btn" data-table-action="edit-title" type="button" title="Add Table Header" aria-label="Add Table Header"><i class="fa-solid fa-heading"></i></button>';
}

function createTableControls(title = '') {
  const cleanTitle = String(title || '').trim();
  const controls = document.createElement('div');
  controls.className = 'table-controls';
  controls.setAttribute('contenteditable', 'false');
  controls.innerHTML =
    (cleanTitle ? tableTitleInputHTML(cleanTitle) : tableTitleButtonHTML()) +
    '<button class="table-delete-btn" data-table-action="delete-table" type="button" title="Delete Table" aria-label="Delete Table"><i class="fa-solid fa-xmark"></i></button>' +
    '<div class="table-axis-controls table-row-controls" aria-label="Row controls">' +
      '<button class="table-btn" data-table-action="add-row" type="button" title="Add Row" aria-label="Add Row"><i class="fa-solid fa-plus"></i></button>' +
      '<button class="table-btn" data-table-action="remove-row" type="button" title="Remove Row" aria-label="Remove Row"><i class="fa-solid fa-minus"></i></button>' +
    '</div>' +
    '<div class="table-axis-controls table-column-controls" aria-label="Column controls">' +
      '<button class="table-btn" data-table-action="add-column" type="button" title="Add Column" aria-label="Add Column"><i class="fa-solid fa-plus"></i></button>' +
      '<button class="table-btn" data-table-action="remove-column" type="button" title="Remove Column" aria-label="Remove Column"><i class="fa-solid fa-minus"></i></button>' +
    '</div>';
  return controls;
}

function syncTableControls(wrap, table) {
  const controls = wrap?.querySelector?.(':scope > .table-controls');
  if (!controls || !table) return false;
  let changed = false;
  const caption = tableCaptionText(table);
  let titleInput = controls.querySelector('[data-table-title-input]');
  let titleBtn = controls.querySelector('[data-table-action="edit-title"]');
  if (titleInput && !tableCaptionText(table) && !String(titleInput.value || titleInput.getAttribute('value') || '').trim()) {
    titleInput.remove();
    titleInput = null;
    changed = true;
  }
  if (caption && !titleInput) {
    titleBtn?.remove();
    controls.insertAdjacentHTML('afterbegin', tableTitleInputHTML(caption));
    changed = true;
  } else if (!caption && !titleInput && !titleBtn) {
    controls.insertAdjacentHTML('afterbegin', tableTitleButtonHTML());
    changed = true;
  }
  return changed;
}

function showTableTitleInput(table) {
  const controls = table?.closest?.('.note-table-wrap')?.querySelector(':scope > .table-controls');
  if (!controls) return;
  let input = controls.querySelector('[data-table-title-input]');
  if (!input) {
    controls.querySelector('[data-table-action="edit-title"]')?.remove();
    controls.insertAdjacentHTML('afterbegin', tableTitleInputHTML(tableCaptionText(table)));
    input = controls.querySelector('[data-table-title-input]');
  }
  if (!input) return;
  input.addEventListener('blur', () => {
    if (String(input.value || '').trim() || tableCaptionText(table)) return;
    input.remove();
    if (!controls.querySelector('[data-table-action="edit-title"]')) {
      controls.insertAdjacentHTML('afterbegin', tableTitleButtonHTML());
    }
  }, { once: true });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

const TABLE_MIN_COLUMN_WIDTH = 72;
const TABLE_DEFAULT_COLUMN_WIDTH = 150;
const TABLE_EDGE_RESIZE_KEY = 'edge';
let _tableReorderState = null;

function tableDirectColgroup(table) {
  return table?.querySelector?.(':scope > colgroup') || null;
}

function tableColumnElements(table) {
  return [...(tableDirectColgroup(table)?.children || [])].filter(col => col.tagName === 'COL');
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function tableColumnRawWidth(col) {
  return String(col?.style?.width || col?.getAttribute?.('width') || '').trim();
}

function tableWidthBasis(table) {
  const tableWidth = table?.getBoundingClientRect?.().width || 0;
  if (Number.isFinite(tableWidth) && tableWidth > 0) return tableWidth;
  const scrollWrap = tableScrollWrapForTable(table);
  const wrapWidth = scrollWrap?.clientWidth || 0;
  if (Number.isFinite(wrapWidth) && wrapWidth > 0) return wrapWidth;
  return tableColumnCount(table) * TABLE_DEFAULT_COLUMN_WIDTH;
}

function normalizeTableColumnPercents(percents, count = percents.length) {
  const fallback = 100 / Math.max(1, count);
  const safe = Array.from({ length: Math.max(1, count) }, (_, index) => {
    const value = parseFloat(percents[index]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  });
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return safe.map(() => 100 / safe.length);
  return safe.map(value => (value / total) * 100);
}

function formatTableColumnPercent(percent) {
  const rounded = Math.round(percent * 1000) / 1000;
  return String(parseFloat(rounded.toFixed(3))) + '%';
}

function readTableColumnPercents(table, count = tableColumnCount(table)) {
  const safeCount = Math.max(1, count);
  const cols = tableColumnElements(table).slice(0, safeCount);
  const rawWidths = Array.from({ length: safeCount }, (_, index) => tableColumnRawWidth(cols[index]));
  const pxTotal = rawWidths.reduce((sum, raw) => {
    const value = parseFloat(raw);
    return raw && !/%$/.test(raw) && Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  const basis = tableWidthBasis(table);
  const fallback = 100 / safeCount;
  const percents = rawWidths.map(raw => {
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    if (/%$/.test(raw)) return value;
    if (pxTotal > 0) return (value / pxTotal) * 100;
    return basis > 0 ? (value / basis) * 100 : fallback;
  });
  return normalizeTableColumnPercents(percents, safeCount);
}

function updateTableWidthFromCols(table) {
  if (!table) return;
  if (!String(table.style.width || '').trim()) table.style.width = '100%';
  table.style.minWidth = '';
  applyTableChromeWidth(table);
}

function tablePixelStyleWidth(table) {
  const raw = String(table?.style?.width || '').trim();
  const value = parseFloat(raw);
  return /px$/i.test(raw) && Number.isFinite(value) && value > 0 ? value : 0;
}

function tableAvailableWidth(table) {
  const wrap = table?.closest?.('.note-table-wrap');
  const parent = wrap?.parentElement || getEd();
  const rectWidth = parent?.getBoundingClientRect?.().width || 0;
  const clientWidth = parent?.clientWidth || 0;
  return Math.max(TABLE_MIN_COLUMN_WIDTH, rectWidth || clientWidth || tableWidthBasis(table));
}

function tableMinimumResizeWidth(table) {
  const colCount = tableColumnCount(table);
  const preferred = Math.max(120, colCount * TABLE_MIN_COLUMN_WIDTH);
  return Math.min(tableAvailableWidth(table), preferred);
}

function applyTableChromeWidth(table) {
  const wrap = table?.closest?.('.note-table-wrap');
  if (!wrap) return;
  const pxWidth = tablePixelStyleWidth(table);
  wrap.style.width = pxWidth ? Math.round(pxWidth) + 'px' : '';
}

function setTablePixelWidth(table, width) {
  const nextWidth = Math.max(1, Math.round(width));
  table.style.width = nextWidth + 'px';
  table.style.minWidth = '';
  applyTableChromeWidth(table);
  updateTableScrollState(table);
}

function setTableColumnPercents(table, percents) {
  if (!table) return false;
  const count = Math.max(1, percents.length || tableColumnCount(table));
  let changed = false;
  let colgroup = tableDirectColgroup(table);
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
    changed = true;
  }
  while (colgroup.children.length < count) {
    colgroup.appendChild(document.createElement('col'));
    changed = true;
  }
  while (colgroup.children.length > count) {
    colgroup.lastElementChild.remove();
    changed = true;
  }

  normalizeTableColumnPercents(percents, count).forEach((percent, index) => {
    const col = colgroup.children[index];
    const nextWidth = formatTableColumnPercent(percent);
    if (col.style.width !== nextWidth) {
      col.style.width = nextWidth;
      changed = true;
    }
    if (col.hasAttribute('width')) {
      col.removeAttribute('width');
      changed = true;
    }
  });

  const previousWidth = table.style.width;
  const previousMinWidth = table.style.minWidth;
  updateTableWidthFromCols(table);
  if (table.style.width !== previousWidth || table.style.minWidth !== previousMinWidth) changed = true;
  return changed;
}

function ensureTableColumnWidths(table) {
  if (!table) return false;
  const colCount = tableColumnCount(table);
  let colgroup = tableDirectColgroup(table);
  let changed = false;
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
    changed = true;
  }
  while (colgroup.children.length < colCount) {
    colgroup.appendChild(document.createElement('col'));
    changed = true;
  }
  while (colgroup.children.length > colCount) {
    colgroup.lastElementChild.remove();
    changed = true;
  }
  const percents = readTableColumnPercents(table, colCount);
  if (setTableColumnPercents(table, percents)) changed = true;
  return changed;
}

function tableColumnPixelWidthsFromLayout(table) {
  ensureTableColumnWidths(table);
  const colCount = tableColumnCount(table);
  const firstRow = table.rows[0];
  const tableWidth = tableWidthBasis(table);
  const percents = readTableColumnPercents(table, colCount);
  return Array.from({ length: colCount }, (_, index) => {
    const width = firstRow?.cells[index]?.getBoundingClientRect?.().width || 0;
    if (Number.isFinite(width) && width > 0) return width;
    return Math.max(1, tableWidth * (percents[index] || 0) / 100);
  });
}

function setTableColumnWidthsFromLayout(table) {
  ensureTableColumnWidths(table);
  const widths = tableColumnPixelWidthsFromLayout(table);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total > 0) setTableColumnPercents(table, widths.map(width => (width / total) * 100));
}

function insertTableColumnWidth(table, insertIndex) {
  ensureTableColumnWidths(table);
  const existingCount = tableColumnElements(table).length;
  const percents = readTableColumnPercents(table, existingCount);
  const targetIndex = clampValue(insertIndex, 0, existingCount);
  const sourceIndex = clampValue(targetIndex - 1, 0, Math.max(0, existingCount - 1));
  const split = percents[sourceIndex] || (100 / (existingCount + 1));
  percents[sourceIndex] = split / 2;
  percents.splice(targetIndex, 0, split / 2);
  setTableColumnPercents(table, percents);
}

function removeTableColumnWidth(table, removeIndex) {
  ensureTableColumnWidths(table);
  const percents = readTableColumnPercents(table, tableColumnElements(table).length);
  if (percents.length <= 1) return;
  const targetIndex = clampValue(removeIndex, 0, percents.length - 1);
  const removed = percents.splice(targetIndex, 1)[0] || 0;
  if (percents.length) {
    const recipientIndex = clampValue(targetIndex, 0, percents.length - 1);
    percents[recipientIndex] += removed;
  }
  setTableColumnPercents(table, percents);
}

function tableScrollWrapForTable(table) {
  return table?.closest?.('.note-table-scroll') || null;
}

function updateTableScrollState(table) {
  const scrollWrap = tableScrollWrapForTable(table);
  if (!scrollWrap) return;
  applyTableChromeWidth(table);
  const canScroll = scrollWrap.scrollWidth - scrollWrap.clientWidth > 2;
  scrollWrap.classList.toggle('is-scrollable', canScroll);
  if (!canScroll) scrollWrap.scrollLeft = 0;
}

function bindTableChromeScroll(scrollWrap) {
  if (!scrollWrap || scrollWrap.dataset.tableChromeScrollBound) return;
  scrollWrap.dataset.tableChromeScrollBound = '1';
  scrollWrap.addEventListener('scroll', () => {
    const currentTable = scrollWrap.querySelector(':scope > table');
    updateTableResizeHandles(currentTable);
    updateTableReorderHandles(currentTable);
  }, { passive: true });
}

function ensureTableScrollWrap(wrap, table) {
  if (!wrap || !table) return false;
  let changed = false;
  let scrollWrap = tableScrollWrapForTable(table);
  if (!scrollWrap || scrollWrap.parentElement !== wrap) {
    scrollWrap = wrap.querySelector(':scope > .note-table-scroll');
    if (!scrollWrap) {
      scrollWrap = document.createElement('div');
      scrollWrap.className = 'note-table-scroll';
      changed = true;
    }
    if (scrollWrap.parentElement !== wrap) {
      wrap.appendChild(scrollWrap);
      changed = true;
    }
    scrollWrap.appendChild(table);
    changed = true;
  }
  let resizeControls = scrollWrap.querySelector(':scope > .table-resize-controls');
  if (!resizeControls) {
    resizeControls = document.createElement('div');
    resizeControls.className = 'table-resize-controls';
    resizeControls.setAttribute('contenteditable', 'false');
    scrollWrap.appendChild(resizeControls);
    changed = true;
  }
  let reorderControls = scrollWrap.querySelector(':scope > .table-reorder-controls');
  if (!reorderControls) {
    reorderControls = document.createElement('div');
    reorderControls.className = 'table-reorder-controls';
    reorderControls.setAttribute('contenteditable', 'false');
    scrollWrap.appendChild(reorderControls);
    changed = true;
  }
  bindTableChromeScroll(scrollWrap);
  applyTableChromeWidth(table);
  return changed;
}

function updateTableResizeHandles(table) {
  const scrollWrap = tableScrollWrapForTable(table);
  const controls = scrollWrap?.querySelector(':scope > .table-resize-controls');
  if (!table || !scrollWrap || !controls) return;
  updateTableScrollState(table);
  const colCount = tableColumnCount(table);
  if (!getEd()?.isContentEditable) {
    controls.replaceChildren();
    return;
  }
  const firstRow = table.rows[0];
  if (!firstRow) return;
  const scrollRect = scrollWrap.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  controls.style.width = Math.max(scrollWrap.clientWidth, tableRect.width) + 'px';
  controls.style.height = tableRect.height + 'px';
  const draggingIndex = controls.querySelector(':scope > .table-resize-handle.dragging')?.dataset.tableResize || '';
  const existing = new Map(
    [...controls.querySelectorAll(':scope > .table-resize-handle')]
      .map(handle => [handle.dataset.tableResize, handle])
  );
  const keep = new Set();
  if (colCount > 1) {
    for (let index = 0; index < colCount - 1; index++) {
      const cell = firstRow.cells[index];
      if (!cell) continue;
      const left = cell.getBoundingClientRect().right - scrollRect.left + scrollWrap.scrollLeft;
      const key = String(index);
      const handle = existing.get(key) || document.createElement('span');
      const wasDragging = handle.classList.contains('dragging') || draggingIndex === key;
      handle.className = 'table-resize-handle';
      if (wasDragging) handle.classList.add('dragging');
      handle.dataset.tableResize = key;
      handle.setAttribute('contenteditable', 'false');
      handle.style.left = left + 'px';
      controls.appendChild(handle);
      keep.add(key);
    }
  }
  const edgeLeft = tableRect.right - scrollRect.left + scrollWrap.scrollLeft;
  const edgeHandle = existing.get(TABLE_EDGE_RESIZE_KEY) || document.createElement('span');
  const edgeWasDragging = edgeHandle.classList.contains('dragging') || draggingIndex === TABLE_EDGE_RESIZE_KEY;
  edgeHandle.className = 'table-resize-handle table-edge-resize-handle';
  if (edgeWasDragging) edgeHandle.classList.add('dragging');
  edgeHandle.dataset.tableResize = TABLE_EDGE_RESIZE_KEY;
  edgeHandle.setAttribute('contenteditable', 'false');
  edgeHandle.setAttribute('title', 'Resize Table');
  edgeHandle.setAttribute('aria-label', 'Resize Table');
  edgeHandle.style.left = edgeLeft + 'px';
  controls.appendChild(edgeHandle);
  keep.add(TABLE_EDGE_RESIZE_KEY);
  existing.forEach((handle, key) => {
    if (!keep.has(key)) handle.remove();
  });
}

function updateTableReorderHandles(table) {
  const scrollWrap = tableScrollWrapForTable(table);
  const controls = scrollWrap?.querySelector(':scope > .table-reorder-controls');
  if (!table || !scrollWrap || !controls) return;
  const rows = [...table.rows];
  const colCount = tableColumnCount(table);
  if (!rows.length || !getEd()?.isContentEditable) {
    controls.replaceChildren();
    return;
  }

  const firstRow = rows[0];
  const scrollRect = scrollWrap.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  controls.style.width = Math.max(scrollWrap.clientWidth, tableRect.width) + 'px';
  controls.style.height = tableRect.height + 'px';

  const existing = new Map(
    [...controls.querySelectorAll(':scope > .table-reorder-handle')]
      .map(handle => [handle.dataset.tableReorder + ':' + (handle.dataset.tableRowReorder || handle.dataset.tableColumnReorder), handle])
  );
  const keep = new Set();

  rows.forEach((row, index) => {
    const rect = row.getBoundingClientRect();
    const firstCellRect = row.cells[0]?.getBoundingClientRect?.() || tableRect;
    const key = 'row:' + index;
    const handle = existing.get(key) || document.createElement('button');
    const active = _tableReorderState?.type === 'row' && _tableReorderState.table === table && _tableReorderState.fromIndex === index;
    handle.className = 'table-reorder-handle table-row-reorder-handle';
    if (active) handle.classList.add('dragging');
    handle.type = 'button';
    handle.dataset.tableReorder = 'row';
    handle.dataset.tableRowReorder = String(index);
    handle.setAttribute('contenteditable', 'false');
    handle.setAttribute('title', 'Move Row');
    handle.setAttribute('aria-label', 'Move Row');
    handle.innerHTML = '<i class="fa-solid fa-arrows-up-down"></i>';
    handle.style.left = (firstCellRect.left - scrollRect.left + scrollWrap.scrollLeft + 9) + 'px';
    handle.style.top = (rect.top - scrollRect.top + scrollWrap.scrollTop + rect.height / 2) + 'px';
    controls.appendChild(handle);
    keep.add(key);
  });

  for (let index = 0; index < colCount; index++) {
    const cell = firstRow.cells[index];
    if (!cell) continue;
    const rect = cell.getBoundingClientRect();
    const key = 'column:' + index;
    const handle = existing.get(key) || document.createElement('button');
    const active = _tableReorderState?.type === 'column' && _tableReorderState.table === table && _tableReorderState.fromIndex === index;
    handle.className = 'table-reorder-handle table-column-reorder-handle';
    if (active) handle.classList.add('dragging');
    handle.type = 'button';
    handle.dataset.tableReorder = 'column';
    handle.dataset.tableColumnReorder = String(index);
    handle.setAttribute('contenteditable', 'false');
    handle.setAttribute('title', 'Move Column');
    handle.setAttribute('aria-label', 'Move Column');
    handle.innerHTML = '<i class="fa-solid fa-arrows-left-right"></i>';
    handle.style.left = (rect.left - scrollRect.left + scrollWrap.scrollLeft + rect.width / 2) + 'px';
    handle.style.top = (rect.top - scrollRect.top + scrollWrap.scrollTop + 9) + 'px';
    controls.appendChild(handle);
    keep.add(key);
  }

  existing.forEach((handle, key) => {
    if (!keep.has(key)) handle.remove();
  });
}

function refreshTableResizeHandles(root = getEd()) {
  root?.querySelectorAll?.('table').forEach(table => {
    updateTableScrollState(table);
    updateTableResizeHandles(table);
    updateTableReorderHandles(table);
  });
}

function ensureTableTrailingParagraph(wrap) {
  if (!wrap?.parentNode) return false;
  let next = wrap.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) next = next.nextSibling;
  if (next?.nodeType === Node.ELEMENT_NODE && next.tagName === 'P') return false;
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  if (next) wrap.parentNode.insertBefore(p, next);
  else wrap.after(p);
  return true;
}

function cellPlainTextFragment(text) {
  const frag = document.createDocumentFragment();
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    if (index) frag.appendChild(document.createElement('br'));
    frag.appendChild(document.createTextNode(line));
  });
  return frag;
}

function replaceElementWithPlainText(el) {
  const frag = cellPlainTextFragment(el.textContent || '');
  el.replaceWith(frag);
}

function replaceListWithPlainText(list) {
  const lines = [...list.querySelectorAll('li')]
    .map(li => li.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const frag = cellPlainTextFragment(lines.length ? lines.join('\n') : list.textContent || '');
  list.replaceWith(frag);
}

function sanitizeTableCell(cell) {
  if (!cell) return false;
  let changed = false;
  cell.querySelectorAll('.table-controls').forEach(el => { el.remove(); changed = true; });
  cell.querySelectorAll('.table-resize-controls').forEach(el => { el.remove(); changed = true; });
  cell.querySelectorAll('.table-reorder-controls').forEach(el => { el.remove(); changed = true; });
  cell.querySelectorAll('.table-reorder-indicator').forEach(el => { el.remove(); changed = true; });
  cell.querySelectorAll('table').forEach(table => { replaceElementWithPlainText(table); changed = true; });
  cell.querySelectorAll('ul, ol').forEach(list => { replaceListWithPlainText(list); changed = true; });
  cell.querySelectorAll('pre').forEach(pre => { replaceElementWithPlainText(pre); changed = true; });
  cell.querySelectorAll('h1,h2,h3,h4,blockquote').forEach(block => {
    const frag = document.createDocumentFragment();
    while (block.firstChild) frag.appendChild(block.firstChild);
    block.replaceWith(frag);
    changed = true;
  });
  if (!cell.childNodes.length) {
    cell.appendChild(document.createElement('br'));
    changed = true;
  }
  return changed;
}

function sanitizeEditorTables(root = getEd()) {
  if (!root) return false;
  let changed = false;
  root.querySelectorAll('td, th').forEach(cell => {
    if (sanitizeTableCell(cell)) changed = true;
  });
  return changed;
}

function createTableCell() {
  const td = document.createElement('td');
  td.appendChild(document.createElement('br'));
  return td;
}

function ensureTableShape(table) {
  let changed = false;
  if (!table.tBodies.length) {
    const tbody = document.createElement('tbody');
    [...table.rows].forEach(row => tbody.appendChild(row));
    table.appendChild(tbody);
    changed = true;
  }
  if (!table.rows.length) {
    const row = table.tBodies[0].insertRow();
    row.appendChild(createTableCell());
    changed = true;
  }
  const maxCols = Math.max(1, ...[...table.rows].map(row => row.cells.length));
  [...table.rows].forEach(row => {
    while (row.cells.length < maxCols) {
      row.appendChild(createTableCell());
      changed = true;
    }
    [...row.cells].forEach(cell => {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') return;
      if (sanitizeTableCell(cell)) changed = true;
    });
  });
  if (ensureTableColumnWidths(table)) changed = true;
  return changed;
}

function decorateTables(root = getEd()) {
  if (!root) return false;
  let changed = sanitizeEditorTables(root);
  const editable = root.isContentEditable || root.getAttribute?.('contenteditable') === 'true';
  root.querySelectorAll('table').forEach(table => {
    if (table.closest('.table-controls')) return;
    if (ensureTableShape(table)) changed = true;
    let wrap = table.closest('.note-table-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'note-table-wrap';
      table.before(wrap);
      wrap.appendChild(table);
      changed = true;
    }
    if (ensureTableScrollWrap(wrap, table)) changed = true;
    if (ensureTableTrailingParagraph(wrap)) changed = true;
    updateTableScrollState(table);
    wrap.dataset.noteTableReady = '1';
    if (!editable) {
      wrap.classList.remove('has-table-controls');
      const controls = wrap.querySelector(':scope > .table-controls');
      if (controls) {
        controls.remove();
        changed = true;
      }
      wrap.querySelectorAll('.table-resize-controls').forEach(el => {
        el.remove();
        changed = true;
      });
      wrap.querySelectorAll('.table-reorder-controls,.table-reorder-indicator').forEach(el => {
        el.remove();
        changed = true;
      });
      return;
    }
    wrap.classList.add('has-table-controls');
    if (!wrap.querySelector(':scope > .table-controls')) {
      wrap.insertBefore(createTableControls(tableCaptionText(table)), wrap.firstChild);
      changed = true;
    }
    if (syncTableControls(wrap, table)) changed = true;
    updateTableResizeHandles(table);
    updateTableReorderHandles(table);
  });
  return changed;
}

function stripTableEditorChrome(root) {
  root.querySelectorAll('.note-table-wrap').forEach(wrap => {
    const table = wrap.querySelector(':scope > .note-table-scroll > table, :scope > table');
    const titleInput = wrap.querySelector(':scope > .table-controls [data-table-title-input]');
    if (table && titleInput) setTableCaptionText(table, titleInput.value || titleInput.getAttribute('value') || '');
  });
  root.querySelectorAll('.table-controls').forEach(el => el.remove());
  root.querySelectorAll('.table-resize-controls').forEach(el => el.remove());
  root.querySelectorAll('.table-reorder-controls,.table-reorder-indicator').forEach(el => el.remove());
  root.querySelectorAll('.note-table-wrap').forEach(wrap => {
    wrap.classList.remove('has-table-controls');
    const table = wrap.querySelector(':scope > .note-table-scroll > table, :scope > table');
    if (table) {
      wrap.replaceWith(table);
      return;
    }
    const frag = document.createDocumentFragment();
    while (wrap.firstChild) frag.appendChild(wrap.firstChild);
    wrap.replaceWith(frag);
  });
  root.querySelectorAll('[data-note-table-ready]').forEach(el => el.removeAttribute('data-note-table-ready'));
}

function createNoteTable(rows = 2, cols = 2) {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');
  for (let c = 0; c < cols; c++) {
    const col = document.createElement('col');
    col.style.width = formatTableColumnPercent(100 / cols);
    colgroup.appendChild(col);
  }
  const tbody = document.createElement('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) tr.appendChild(createTableCell());
    tbody.appendChild(tr);
  }
  table.appendChild(colgroup);
  table.appendChild(tbody);
  updateTableWidthFromCols(table);
  return table;
}

function insertTable() {
  if (isSelectionInTable()) {
    showToast('Tables Cannot Be Nested', 'error');
    return;
  }
  const range = getEditorSelectionRange();
  if (!range) return;
  const table = createNoteTable();
  const wrap = document.createElement('div');
  wrap.className = 'note-table-wrap';
  wrap.dataset.noteTableReady = '1';
  wrap.classList.add('has-table-controls');
  wrap.appendChild(createTableControls());
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'note-table-scroll';
  const resizeControls = document.createElement('div');
  resizeControls.className = 'table-resize-controls';
  resizeControls.setAttribute('contenteditable', 'false');
  const reorderControls = document.createElement('div');
  reorderControls.className = 'table-reorder-controls';
  reorderControls.setAttribute('contenteditable', 'false');
  scrollWrap.appendChild(table);
  scrollWrap.appendChild(resizeControls);
  scrollWrap.appendChild(reorderControls);
  bindTableChromeScroll(scrollWrap);
  wrap.appendChild(scrollWrap);
  const block = currentBlockFromSelection();
  if (range.collapsed && block && block !== getEd() && !['LI', 'TD', 'TH', 'PRE'].includes(block.tagName)) {
    if (block.textContent.replace(/\u00a0/g, ' ').trim() || block.querySelector('img, table, ul, ol')) block.after(wrap);
    else block.replaceWith(wrap);
  } else {
    if (!range.collapsed) range.deleteContents();
    range.insertNode(wrap);
  }
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  wrap.after(p);
  updateTableResizeHandles(table);
  updateTableReorderHandles(table);
  placeCursorAtStart(table.rows[0].cells[0]);
  getEd().dispatchEvent(new Event('input'));
}

function tableForButton(btn) {
  return btn?.closest('.note-table-wrap')?.querySelector('table') || null;
}

function selectedCellInTable(table) {
  const cell = currentTableCellFromSelection();
  return cell && table?.contains(cell) ? cell : null;
}

function tableColumnCount(table) {
  return Math.max(1, ...[...table.rows].map(row => row.cells.length));
}

function placeCursorInTableCell(cell) {
  if (!cell) return;
  if (!cell.childNodes.length) cell.appendChild(document.createElement('br'));
  placeCursorAtStart(cell);
}

function addTableRow(table) {
  const selectedCell = selectedCellInTable(table);
  const insertIndex = selectedCell ? selectedCell.parentElement.rowIndex + 1 : table.rows.length;
  const cols = tableColumnCount(table);
  const row = table.tBodies[0].insertRow(Math.min(insertIndex, table.tBodies[0].rows.length));
  for (let i = 0; i < cols; i++) row.appendChild(createTableCell());
  placeCursorInTableCell(row.cells[Math.min(selectedCell?.cellIndex || 0, cols - 1)]);
}

function removeTableRow(table) {
  if (table.rows.length <= 1) {
    showToast('Keep At Least One Row', 'error');
    return;
  }
  const selectedCell = selectedCellInTable(table);
  const rowIndex = selectedCell ? selectedCell.parentElement.rowIndex : table.rows.length - 1;
  const nextIndex = Math.max(0, Math.min(rowIndex, table.rows.length - 2));
  const colIndex = selectedCell?.cellIndex || 0;
  table.deleteRow(rowIndex);
  placeCursorInTableCell(table.rows[nextIndex]?.cells[Math.min(colIndex, table.rows[nextIndex].cells.length - 1)]);
}

function addTableColumn(table) {
  ensureTableColumnWidths(table);
  const selectedCell = selectedCellInTable(table);
  const insertIndex = selectedCell ? selectedCell.cellIndex + 1 : tableColumnCount(table);
  insertTableColumnWidth(table, insertIndex);
  [...table.rows].forEach(row => {
    row.insertBefore(createTableCell(), row.cells[insertIndex] || null);
  });
  const targetRow = selectedCell?.parentElement || table.rows[0];
  placeCursorInTableCell(targetRow?.cells[Math.min(insertIndex, targetRow.cells.length - 1)]);
}

function removeTableColumn(table) {
  const cols = tableColumnCount(table);
  if (cols <= 1) {
    showToast('Keep At Least One Column', 'error');
    return;
  }
  const selectedCell = selectedCellInTable(table);
  const colIndex = selectedCell ? selectedCell.cellIndex : cols - 1;
  removeTableColumnWidth(table, colIndex);
  [...table.rows].forEach(row => row.cells[colIndex]?.remove());
  const targetRow = selectedCell?.parentElement?.isConnected ? selectedCell.parentElement : table.rows[0];
  placeCursorInTableCell(targetRow?.cells[Math.max(0, Math.min(colIndex, targetRow.cells.length - 1))]);
}

function tableReorderCount(table, type) {
  if (!table) return 0;
  return type === 'row' ? table.rows.length : tableColumnCount(table);
}

function tableReorderInsertionIndex(table, type, clientX, clientY) {
  const items = type === 'row' ? [...table.rows] : [...(table.rows[0]?.cells || [])];
  if (!items.length) return 0;
  for (let index = 0; index < items.length; index++) {
    const rect = items[index].getBoundingClientRect();
    const midpoint = type === 'row' ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    const pointer = type === 'row' ? clientY : clientX;
    if (pointer < midpoint) return index;
  }
  return items.length;
}

function tableReorderTargetIndex(fromIndex, insertionIndex, count) {
  if (count <= 1) return fromIndex;
  const adjusted = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
  return clampValue(adjusted, 0, count - 1);
}

function tableReorderIndicator(scrollWrap) {
  if (!scrollWrap) return null;
  let indicator = scrollWrap.querySelector(':scope > .table-reorder-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'table-reorder-indicator';
    indicator.setAttribute('contenteditable', 'false');
    scrollWrap.appendChild(indicator);
  }
  return indicator;
}

function updateTableReorderIndicator(table, type, insertionIndex) {
  const scrollWrap = tableScrollWrapForTable(table);
  const indicator = tableReorderIndicator(scrollWrap);
  if (!table || !scrollWrap || !indicator) return;
  const tableRect = table.getBoundingClientRect();
  const scrollRect = scrollWrap.getBoundingClientRect();
  indicator.className = 'table-reorder-indicator ' + (type === 'row' ? 'is-row' : 'is-column');

  if (type === 'row') {
    const rows = [...table.rows];
    if (!rows.length) return;
    const rowRect = insertionIndex >= rows.length
      ? rows[rows.length - 1].getBoundingClientRect()
      : rows[insertionIndex].getBoundingClientRect();
    const y = insertionIndex >= rows.length ? rowRect.bottom : rowRect.top;
    indicator.style.left = (tableRect.left - scrollRect.left + scrollWrap.scrollLeft) + 'px';
    indicator.style.top = (y - scrollRect.top + scrollWrap.scrollTop) + 'px';
    indicator.style.width = tableRect.width + 'px';
    indicator.style.height = '';
    return;
  }

  const cells = [...(table.rows[0]?.cells || [])];
  if (!cells.length) return;
  const cellRect = insertionIndex >= cells.length
    ? cells[cells.length - 1].getBoundingClientRect()
    : cells[insertionIndex].getBoundingClientRect();
  const x = insertionIndex >= cells.length ? cellRect.right : cellRect.left;
  indicator.style.left = (x - scrollRect.left + scrollWrap.scrollLeft) + 'px';
  indicator.style.top = (tableRect.top - scrollRect.top + scrollWrap.scrollTop) + 'px';
  indicator.style.width = '';
  indicator.style.height = tableRect.height + 'px';
}

function clearTableReorderIndicator(table) {
  tableScrollWrapForTable(table)?.querySelector(':scope > .table-reorder-indicator')?.remove();
}

function moveTableRow(table, fromIndex, toIndex) {
  const rows = [...table.rows];
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) return false;
  const row = rows[fromIndex];
  const target = rows[toIndex];
  if (!row || !target) return false;
  target.parentNode.insertBefore(row, fromIndex < toIndex ? target.nextSibling : target);
  return true;
}

function moveTableColumn(table, fromIndex, toIndex) {
  const colCount = tableColumnCount(table);
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= colCount || toIndex >= colCount) return false;
  ensureTableColumnWidths(table);
  const percents = readTableColumnPercents(table, colCount);
  const [movedPercent] = percents.splice(fromIndex, 1);
  percents.splice(toIndex, 0, movedPercent);
  [...table.rows].forEach(row => {
    const cells = [...row.cells];
    const cell = cells[fromIndex];
    if (!cell) return;
    const target = cells[toIndex];
    if (!target) row.appendChild(cell);
    else row.insertBefore(cell, fromIndex < toIndex ? target.nextSibling : target);
  });
  setTableColumnPercents(table, percents);
  return true;
}

function startTableReorder(e, handle) {
  if (!activeId || !canEditNote(notes[activeId])) return;
  const type = handle?.dataset?.tableReorder;
  if (type !== 'row' && type !== 'column') return;
  const table = handle.closest('.note-table-scroll')?.querySelector('table');
  const fromIndex = Number(type === 'row' ? handle.dataset.tableRowReorder : handle.dataset.tableColumnReorder);
  const count = tableReorderCount(table, type);
  if (!table || !Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= count || count <= 1) return;

  e.preventDefault();
  e.stopPropagation();
  pushUndo();
  if (type === 'column') setTableColumnWidthsFromLayout(table);

  _tableReorderState = {
    table,
    type,
    fromIndex,
    insertionIndex: tableReorderInsertionIndex(table, type, e.clientX, e.clientY)
  };
  handle.classList.add('dragging');
  table.closest('.note-table-wrap')?.classList.add('table-reordering');
  updateTableReorderIndicator(table, type, _tableReorderState.insertionIndex);
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  try { handle.setPointerCapture?.(e.pointerId); } catch (_) {}

  const move = evt => {
    evt.preventDefault();
    if (!_tableReorderState || _tableReorderState.table !== table) return;
    _tableReorderState.insertionIndex = tableReorderInsertionIndex(table, type, evt.clientX, evt.clientY);
    updateTableReorderIndicator(table, type, _tableReorderState.insertionIndex);
  };

  const finish = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    handle.classList.remove('dragging');
    try { handle.releasePointerCapture?.(e.pointerId); } catch (_) {}
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    table.closest('.note-table-wrap')?.classList.remove('table-reordering');

    const state = _tableReorderState;
    _tableReorderState = null;
    clearTableReorderIndicator(table);
    if (!state || state.table !== table) return;

    const nextCount = tableReorderCount(table, type);
    const toIndex = tableReorderTargetIndex(state.fromIndex, state.insertionIndex, nextCount);
    const moved = type === 'row'
      ? moveTableRow(table, state.fromIndex, toIndex)
      : moveTableColumn(table, state.fromIndex, toIndex);

    if (moved) {
      ensureTableShape(table);
      decorateTables(getEd());
      const targetCell = type === 'row'
        ? table.rows[toIndex]?.cells[0]
        : table.rows[0]?.cells[toIndex];
      placeCursorInTableCell(targetCell);
      getEd().dispatchEvent(new Event('input'));
    } else {
      updateTableResizeHandles(table);
      updateTableReorderHandles(table);
    }
    scheduleUndoSnapshot();
  };

  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

function deleteTable(table) {
  const wrap = table?.closest('.note-table-wrap');
  if (!wrap) return;
  let next = wrap.nextElementSibling;
  if (!next || next.tagName !== 'P') {
    next = document.createElement('p');
    next.appendChild(document.createElement('br'));
    wrap.after(next);
  }
  wrap.remove();
  placeCursorAtStart(next);
}

function openTableDeleteModal(table) {
  if (!table || !activeId || !canEditNote(notes[activeId])) return;
  _deletePending = { type: 'table', table };
  const titleEl = document.getElementById('delete-modal-title');
  const bodyEl = document.getElementById('delete-modal-body');
  const confirmBtn = document.getElementById('delete-modal-confirm');
  const name = tableCaptionText(table) || 'Table';
  titleEl.textContent = 'Delete Table?';
  bodyEl.className = 'delete-message';
  bodyEl.innerHTML =
    '<strong class="delete-target">' + esc(name) + '</strong>' +
    '<div class="delete-copy">Removes this table from the note. This cannot be undone.</div>';
  confirmBtn.innerHTML = '<i class="fa-solid fa-trash" style="margin-right:6px;"></i>Delete Table';
  document.getElementById('delete-modal').classList.add('open');
}

function confirmTableDelete(table) {
  if (!table || !activeId || !canEditNote(notes[activeId]) || !getEd().contains(table)) return;
  pushUndo();
  deleteTable(table);
  getEd().dispatchEvent(new Event('input'));
  scheduleUndoSnapshot();
}

function handleTableControl(btn) {
  if (!activeId || !canEditNote(notes[activeId])) return;
  const table = tableForButton(btn);
  if (!table) return;
  const action = btn.dataset.tableAction;
  if (action === 'delete-table') {
    openTableDeleteModal(table);
    return;
  }
  if (action === 'edit-title') {
    showTableTitleInput(table);
    return;
  }
  pushUndo();
  if (action === 'add-row') addTableRow(table);
  if (action === 'remove-row') removeTableRow(table);
  if (action === 'add-column') addTableColumn(table);
  if (action === 'remove-column') removeTableColumn(table);
  ensureTableShape(table);
  decorateTables(getEd());
  getEd().dispatchEvent(new Event('input'));
  scheduleUndoSnapshot();
}

function startTableColumnResize(e, handle) {
  if (!activeId || !canEditNote(notes[activeId])) return;
  if (handle?.dataset?.tableResize === TABLE_EDGE_RESIZE_KEY) {
    startTableWidthResize(e, handle);
    return;
  }
  const table = handle?.closest('.note-table-scroll')?.querySelector('table');
  const colIndex = Number(handle?.dataset?.tableResize);
  if (!table || !Number.isInteger(colIndex)) return;
  const colCount = tableColumnCount(table);
  if (colIndex < 0 || colIndex >= colCount - 1) return;

  e.preventDefault();
  e.stopPropagation();
  pushUndo();
  setTableColumnWidthsFromLayout(table);
  const startWidths = tableColumnPixelWidthsFromLayout(table);
  const totalWidth = startWidths.reduce((sum, width) => sum + width, 0);
  const leftStart = startWidths[colIndex];
  const rightStart = startWidths[colIndex + 1];
  const combinedWidth = leftStart + rightStart;
  if (totalWidth <= 0 || combinedWidth <= 0) return;
  const startX = e.clientX;
  const minWidth = Math.min(TABLE_MIN_COLUMN_WIDTH, Math.max(24, Math.floor(combinedWidth / 2)));
  const minDelta = minWidth - leftStart;
  const maxDelta = rightStart - minWidth;
  let latestX = startX;
  let frame = 0;
  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  try { handle.setPointerCapture?.(e.pointerId); } catch (_) {}

  const applyResize = clientX => {
    const delta = clampValue(clientX - startX, minDelta, maxDelta);
    const nextWidths = startWidths.slice();
    nextWidths[colIndex] = leftStart + delta;
    nextWidths[colIndex + 1] = rightStart - delta;
    setTableColumnPercents(table, nextWidths.map(width => (width / totalWidth) * 100));
    updateTableResizeHandles(table);
    updateTableReorderHandles(table);
  };

  const move = evt => {
    evt.preventDefault();
    latestX = evt.clientX;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      applyResize(latestX);
    });
  };

  const finish = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      applyResize(latestX);
    }
    handle.classList.remove('dragging');
    try { handle.releasePointerCapture?.(e.pointerId); } catch (_) {}
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    ensureTableShape(table);
    updateTableResizeHandles(table);
    getEd().dispatchEvent(new Event('input'));
    scheduleUndoSnapshot();
  };

  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

function startTableWidthResize(e, handle) {
  if (!activeId || !canEditNote(notes[activeId])) return;
  const table = handle?.closest('.note-table-scroll')?.querySelector('table');
  if (!table) return;

  e.preventDefault();
  e.stopPropagation();
  pushUndo();
  setTableColumnWidthsFromLayout(table);
  const startWidth = table.getBoundingClientRect().width || tableWidthBasis(table);
  const minWidth = Math.min(startWidth, tableMinimumResizeWidth(table));
  const maxWidth = Math.max(startWidth, tableAvailableWidth(table));
  const startX = e.clientX;
  let latestX = startX;
  let frame = 0;
  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  try { handle.setPointerCapture?.(e.pointerId); } catch (_) {}

  const applyResize = clientX => {
    const nextWidth = clampValue(startWidth + clientX - startX, minWidth, maxWidth);
    setTablePixelWidth(table, nextWidth);
    updateTableResizeHandles(table);
    updateTableReorderHandles(table);
  };

  const move = evt => {
    evt.preventDefault();
    latestX = evt.clientX;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      applyResize(latestX);
    });
  };

  const finish = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      applyResize(latestX);
    }
    handle.classList.remove('dragging');
    try { handle.releasePointerCapture?.(e.pointerId); } catch (_) {}
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    ensureTableShape(table);
    applyTableChromeWidth(table);
    updateTableResizeHandles(table);
    updateTableReorderHandles(table);
    getEd().dispatchEvent(new Event('input'));
    scheduleUndoSnapshot();
  };

  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

function moveTableSelection(delta) {
  const cell = currentTableCellFromSelection();
  const table = cell?.closest('table');
  if (!cell || !table) return false;
  const cells = [...table.querySelectorAll('td, th')];
  const currentIndex = cells.indexOf(cell);
  if (currentIndex < 0) return false;
  let nextIndex = currentIndex + delta;
  if (nextIndex >= cells.length) {
    pushUndo();
    addTableRow(table);
    return true;
  }
  nextIndex = Math.max(0, nextIndex);
  placeCursorInTableCell(cells[nextIndex]);
  return true;
}

let _linkSavedRange = null;
function insertLink() {
  const sel = window.getSelection();
  _linkSavedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
  document.getElementById('link-modal').classList.add('open');
  const inp = document.getElementById('link-modal-url');
  inp.value = 'https://';
  setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 120);
}

function _confirmInsertLink() {
  const raw = document.getElementById('link-modal-url').value.trim();
  document.getElementById('link-modal').classList.remove('open');
  if (!raw) return;
  const href = normalizeHttpUrlValue(raw);
  if (!href) return;
  getEd().focus();
  if (_linkSavedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_linkSavedRange);
  }
  pushUndo();
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !applyLinkToSelection(href)) {
    const link = document.createElement('a');
    decorateLink(link, href);
    link.textContent = href;
    const range = getEditorSelectionRange();
    if (!range) return;
    range.insertNode(link);
    range.setStartAfter(link);
    range.collapse(true);
    const nextSel = window.getSelection();
    if (nextSel) {
      nextSel.removeAllRanges();
      nextSel.addRange(range);
    }
  }
  scheduleUndoSnapshot();
  getEd().dispatchEvent(new Event('input'));
}

// Returns editor-level block elements covered by the current selection,
// or null if the selection is collapsed / covers only one block.
function getSelectedLineBlocks() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  const ed = getEd();
  const result = [];
  for (const child of ed.children) {
    if (!range.intersectsNode(child)) continue;
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      for (const li of child.children) {
        if (li.tagName === 'LI' && range.intersectsNode(li)) result.push(li);
      }
    } else {
      result.push(child);
    }
  }
  return result.length > 1 ? result : null;
}

// Convert an array of block/li elements to a target format
// ('ul', 'ol', 'checklist', 'h1', 'h2', 'h3', 'p', etc.)
function applyBlockFormatToBlocks(blocks, format) {
  if (!blocks || !blocks.length) return;
  const isList = format === 'ul' || format === 'ol' || format === 'checklist';

  // Helper: determine current format of a block element
  function blockFormat(b) {
    if (b.tagName === 'LI') {
      if (b.closest('ul.checklist')) return 'checklist';
      if (b.closest('ol')) return 'ol';
      return 'ul';
    }
    return b.tagName.toLowerCase();
  }
  // No-op: do nothing if every selected block is already in the target format
  if (blocks.every(b => blockFormat(b) === format)) return;

  pushUndo();
  const ed = getEd();

  // Walk up to find the direct child of #editor that contains el
  function editorAncestor(el) {
    let node = el;
    while (node && node.parentNode !== ed) node = node.parentNode;
    return node;
  }

  // Get the inline HTML of a block; preserve nested lists when targeting a list format
  function inlineHTML(block) {
    const clone = block.cloneNode(true);
    if (!isList) clone.querySelectorAll('ul, ol').forEach(l => l.remove());
    clone.removeAttribute('data-collapsed');
    return clone.innerHTML.replace(/(<br\s*\/?>)+\s*$/, '').trim() || '<br>';
  }

  const firstAnchor = editorAncestor(blocks[0]);

  if (isList) {
    // All selected lines become items in one new list
    const listEl = document.createElement(format === 'ol' ? 'ol' : 'ul');
    if (format === 'checklist') listEl.className = 'checklist';
    blocks.forEach(block => {
      const li = document.createElement('li');
      li.innerHTML = inlineHTML(block);
      listEl.appendChild(li);
    });
    firstAnchor.before(listEl);
  } else {
    // Each line becomes its own block element, inserted in order before their anchors
    blocks.forEach(block => {
      const el = document.createElement(format);
      el.innerHTML = inlineHTML(block);
      editorAncestor(block).before(el);
    });
  }

  // Remove the original source blocks
  blocks.forEach(block => {
    if (block.tagName === 'LI') {
      const parent = block.parentElement;
      block.remove();
      if (parent && !parent.hasChildNodes()) parent.remove();
    } else {
      block.remove();
    }
  });

  getEd().dispatchEvent(new Event('input'));
}

const TABLE_ALLOWED_ACTIONS = new Set(['bold', 'italic', 'strikethrough', 'code', 'link', 'conversation']);

function shouldBlockTableAction(action) {
  return isSelectionInTable() && !TABLE_ALLOWED_ACTIONS.has(action);
}

const ACTIONS = {
  bold:          () => cmd('bold'),
  italic:        () => cmd('italic'),
  strikethrough: () => cmd('strikeThrough'),
  h1:            () => {
    const blocks = getSelectedLineBlocks();
    if (blocks) { applyBlockFormatToBlocks(blocks, 'h1'); return; }
    toggleBlock('h1');
  },
  h2:            () => toggleBlock('h2'),
  h3:            () => toggleBlock('h3'),
  ul:            () => {
    const blocks = getSelectedLineBlocks();
    if (blocks) { applyBlockFormatToBlocks(blocks, 'ul'); return; }
    // If inside a checklist, convert only this item to a regular bullet
    const li = ancestorOfType(['li']);
    if (li) {
      const parentChecklist = li.closest('ul.checklist');
      if (parentChecklist) {
        splitListAtLi(li, '');
        getEd().focus();
        getEd().dispatchEvent(new Event('input'));
        return;
      }
    }
    cmd('insertUnorderedList'); getEd().focus();
  },
  ol:            () => {
    const blocks = getSelectedLineBlocks();
    if (blocks) { applyBlockFormatToBlocks(blocks, 'ol'); return; }
    cmd('insertOrderedList'); getEd().focus();
  },
  checklist:     () => {
    const blocks = getSelectedLineBlocks();
    if (blocks) { applyBlockFormatToBlocks(blocks, 'checklist'); return; }
    getEd().focus();
    // If inside any list, convert only the current item to/from a checklist
    const li = ancestorOfType(['li']);
    if (li) {
      const parentList = li.closest('ul, ol');
      if (parentList) {
        if (parentList.classList.contains('checklist')) {
          // Already a checklist item — convert only this item to a regular bullet
          splitListAtLi(li, '');
        } else {
          // Regular bullet or ordered item — convert only this item to a checklist item
          splitListAtLi(li, 'checklist');
        }
        getEd().dispatchEvent(new Event('input'));
        return;
      }
    }
    // Not in a list — wrap current block's content in a new checklist item
    const block = currentBlockFromSelection();
    const list  = document.createElement('ul');
    list.className = 'checklist';
    const item  = document.createElement('li');
    if (block && block !== getEd()) {
      // Transfer existing text/nodes into the new li
      while (block.firstChild) item.appendChild(block.firstChild);
    }
    list.appendChild(item);
    if (block && block !== getEd()) {
      block.replaceWith(list);
    } else {
      getEd().appendChild(list);
    }
    placeCursorAtEnd(item);
    getEd().dispatchEvent(new Event('input'));
  },
  quote:         () => toggleBlock('blockquote'),
  code:          insertInlineCode,
  codeblock:     insertCodeBlock,
  table:         insertTable,
  link:          insertLink,
  alarm:         () => openNoteAlarmModal(activeId),
  conversation:  () => openConversationComposerFromSelection(),
  hr:            () => { cmd('insertHorizontalRule'); getEd().focus(); },
  indentLeft:    () => {
    const checklistLi = currentChecklistItemFromSelection();
    if (checklistLi) {
      if (checklistOutdent(checklistLi)) getEd().dispatchEvent(new Event('input'));
    } else {
      document.execCommand('outdent');
    }
    getEd().focus();
  },
  indentRight:   () => {
    const checklistLi = currentChecklistItemFromSelection();
    if (checklistLi) {
      if (checklistIndent(checklistLi)) getEd().dispatchEvent(new Event('input'));
    } else {
      document.execCommand('indent');
    }
    getEd().focus();
  }
};

function makeAlarmId() {
  return 'alarm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function formatAlarmDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Invalid reminder';
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function alarmTextFromMark(mark) {
  return (mark?.textContent || '').replace(/\u200b/g, ' ').replace(/\s+/g, ' ').trim() || 'Reminder';
}

function createAlarmMark(alarmAt, alarmId = makeAlarmId()) {
  const mark = document.createElement('span');
  mark.className = 'note-alarm';
  mark.dataset.alarmId = alarmId;
  mark.dataset.alarmAt = alarmAt;
  updateAlarmMarkDisplay(mark);
  return mark;
}

function unwrapAlarmMark(mark) {
  const parent = mark?.parentNode;
  if (!parent) return;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  mark.remove();
  parent.normalize?.();
}

function updateAlarmMarkDisplay(mark) {
  if (!mark) return false;
  const alarmAt = normalizeAlarmAt(mark.dataset.alarmAt);
  if (!alarmAt) return false;
  if (!mark.dataset.alarmId) mark.dataset.alarmId = makeAlarmId();
  const isSent = mark.dataset.alarmDirection === 'sent';
  const sentTarget = mark.dataset.alarmTargetName || 'Friend';
  mark.dataset.alarmAt = alarmAt;
  mark.classList.add('note-alarm');
  mark.classList.toggle('alarm-sent', isSent);
  mark.classList.toggle('alarm-due', !isSent && new Date(alarmAt).getTime() <= Date.now());
  mark.title = (isSent ? 'Sent Reminder To ' + sentTarget + ': ' : 'Reminder: ') + formatAlarmDateTime(alarmAt);
  return true;
}

function restoreAlarmMarks(root) {
  root.querySelectorAll('.note-alarm').forEach(mark => {
    if (!updateAlarmMarkDisplay(mark)) unwrapAlarmMark(mark);
  });
}

function findAlarmMark(root, alarmId) {
  if (!root || !alarmId) return null;
  return [...root.querySelectorAll('.note-alarm')].find(mark => mark.dataset.alarmId === alarmId) || null;
}

function closestAlarmMark(node) {
  const ed = getEd();
  if (!node || !ed) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const mark = el?.closest?.('.note-alarm');
  return mark && ed.contains(mark) ? mark : null;
}

function alarmMarkForRange(range) {
  if (!range) return null;
  const startMark = closestAlarmMark(range.startContainer);
  const endMark = closestAlarmMark(range.endContainer);
  if (range.collapsed) return startMark;
  return startMark && startMark === endMark ? startMark : null;
}

function selectAlarmMarkText(mark) {
  if (!mark) return;
  const range = document.createRange();
  range.selectNodeContents(mark);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  getEd().focus();
}

function placeCursorAfterNode(node) {
  if (!node) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  getEd().focus();
}

function alarmItemsFromNote(note) {
  if (!note) return [];
  const root = document.createElement('div');
  root.innerHTML = note.content || '';
  return [...root.querySelectorAll('.note-alarm')]
    .map((mark, index) => {
      if (mark.dataset.alarmDirection === 'sent') return null;
      const alarmAt = normalizeAlarmAt(mark.dataset.alarmAt);
      if (!alarmAt) return null;
      return {
        kind: 'inline',
        direction: 'mine',
        noteId: note.id,
        alarmId: mark.dataset.alarmId || note.id + '_alarm_' + index,
        alarmAt,
        title: note.title || 'Untitled Note',
        text: alarmTextFromMark(mark),
        due: new Date(alarmAt).getTime() <= Date.now()
      };
    })
    .filter(Boolean);
}

function getAlarmItems() {
  const items = [];
  Object.values(notes).forEach(note => items.push(...alarmItemsFromNote(note)));
  Object.keys(noteAlarms).forEach(noteId => {
    const alarmAt = normalizeAlarmAt(noteAlarms[noteId]);
    const note = notes[noteId];
    if (!alarmAt || !note) return;
    items.push({
      kind: 'legacy',
      direction: 'mine',
      noteId,
      alarmId: '',
      alarmAt,
      title: note.title || 'Untitled Note',
      text: note.title || 'Untitled Note',
      due: new Date(alarmAt).getTime() <= Date.now()
    });
  });
  Object.values(profileShareNotifications || {}).forEach(reminder => {
    if (reminder.type !== 'reminder') return;
    if (typeof isReminderCleared === 'function' && isReminderCleared(reminder)) return;
    const alarmAt = normalizeAlarmAt(reminder.reminderAt || reminder.alarmAt);
    if (!alarmAt) return;
    items.push({
      kind: 'received',
      direction: 'received',
      noteId: reminder.noteId || '',
      alarmId: reminder.id,
      alarmAt,
      title: reminder.noteTitle || 'Untitled Note',
      text: reminder.reminderText || reminder.noteTitle || 'Reminder',
      fromName: reminder.fromName || 'Someone',
      due: new Date(alarmAt).getTime() <= Date.now()
    });
  });
  Object.keys(sentReminders || {}).forEach(reminderId => {
    const normalized = normalizeSentReminder(reminderId, sentReminders[reminderId]);
    if (!normalized) return;
    if (!sentReminders[normalized.id]?.id) sentReminders[normalized.id] = normalized;
    items.push({
      kind: 'sent',
      direction: 'sent',
      noteId: normalized.noteId,
      alarmId: normalized.id,
      alarmAt: normalized.reminderAt,
      title: normalized.noteTitle || 'Untitled Note',
      text: normalized.reminderText || normalized.noteTitle || 'Reminder',
      targetUid: normalized.targetUid,
      targetName: normalized.targetName || 'Friend',
      due: false
    });
  });
  return items
    .map(normalizeReminderListItem)
    .sort((a, b) => new Date(a.alarmAt) - new Date(b.alarmAt));
}

function scheduleAlarmRefresh(items = getAlarmItems()) {
  clearTimeout(_alarmRefreshTimer);
  const now = Date.now();
  const next = items
    .map(item => new Date(item.alarmAt).getTime())
    .filter(time => Number.isFinite(time) && time > now)
    .sort((a, b) => a - b)[0];
  if (!next) {
    _alarmRefreshTimer = null;
    return;
  }
  const delay = Math.max(1000, Math.min(next - now + 250, 2147483647));
  _alarmRefreshTimer = setTimeout(() => {
    restoreAlarmMarks(getEd());
    renderAlarmButton();
    if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
    refreshOpenSidebarPage('alarms');
  }, delay);
}

function renderAlarmButton() {
  const badge = document.getElementById('alarm-badge');
  if (!badge) return;
  const items = getAlarmItems();
  const count = items.filter(item => item.due && item.direction !== 'sent').length;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
  scheduleAlarmRefresh(items);
}

function reminderSectionLabel(direction) {
  if (direction === 'received') return 'From Friends';
  if (direction === 'sent') return 'Sent';
  return 'Mine';
}

function reminderItemMeta(item) {
  const meta = [];
  if (item.direction === 'received') meta.push('From ' + (item.fromName || 'Someone'));
  if (item.direction === 'sent') meta.push('To ' + (item.targetName || 'Friend'));
  if (item.title) meta.push(item.title);
  return meta.join(' · ');
}

function reminderItemIcon(item) {
  if (item.direction === 'sent') return 'fa-solid fa-paper-plane';
  if (item.direction === 'received') return 'fa-solid fa-user-clock';
  return 'fa-solid fa-clock';
}

function reminderItemKey(item) {
  return [item.kind || '', item.noteId || '', item.alarmId || ''].join('::');
}

function reminderItemReadKeys(item) {
  if (item?.kind !== 'received' || !item.alarmId || typeof notificationReadKeys !== 'function') return [];
  const notification = profileShareNotifications[item.alarmId] || {
    id: item.alarmId,
    type: 'reminder',
    reminderId: item.alarmId,
    noteId: item.noteId || ''
  };
  return notificationReadKeys(notification);
}

function normalizeReminderListItem(item) {
  const readKeys = reminderItemReadKeys(item);
  const readable = readKeys.length > 0;
  return {
    ...item,
    key: reminderItemKey(item),
    readable,
    read: readable ? readKeys.some(key => !!readNotifications[key]) : false
  };
}

function renderReminderItem(item) {
  return '<div class="profile-row alarm-row sidebar-selectable-row' + (item.due ? ' due' : '') + (item.readable && !item.read ? ' unread' : '') + '" data-alarm-note-id="' + esc(item.noteId) + '" data-alarm-id="' + esc(item.alarmId) + '" data-alarm-kind="' + esc(item.kind) + '" data-alarm-key="' + esc(item.key) + '">' +
    (typeof renderSidebarSelectionCheckbox === 'function' ? renderSidebarSelectionCheckbox(item.key, 'Select reminder') : '') +
    '<span class="alarm-icon"><i class="' + reminderItemIcon(item) + '"></i></span>' +
    '<div class="profile-main">' +
      '<div class="alarm-text">' + esc(item.text) + '</div>' +
      '<div class="alarm-note-title">' + esc(reminderItemMeta(item)) + '</div>' +
      '<div class="notification-time">' + esc(formatAlarmDateTime(item.alarmAt)) + (item.due ? ' · Due' : '') + '</div>' +
    '</div>' +
  '</div>';
}

function renderAlarmsList(target = 'alarms-list') {
  const list = typeof target === 'string' ? document.getElementById(target) : target;
  if (!list) return;
  const items = getAlarmItems();
  if (!items.length) {
    list.innerHTML = '<div class="profile-empty">No reminders set.</div>';
    if (typeof attachSidebarSelectionHandlers === 'function') attachSidebarSelectionHandlers(list);
    return;
  }

  list.innerHTML = ['mine', 'received', 'sent'].map(direction => {
    const sectionItems = items.filter(item => item.direction === direction);
    if (!sectionItems.length) return '';
    return '<div class="reminder-section">' +
      '<div class="sidebar-section-label">' + reminderSectionLabel(direction) + '</div>' +
      sectionItems.map(renderReminderItem).join('') +
    '</div>';
  }).join('');
  if (typeof attachSidebarSelectionHandlers === 'function') attachSidebarSelectionHandlers(list);

  list.querySelectorAll('[data-alarm-note-id]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-clear-alarm-note]')) return;
      if (e.target.closest('[data-select-key]')) return;
      openAlarmFromList(row.dataset.alarmNoteId, row.dataset.alarmId, row.dataset.alarmKind);
    });
  });
  list.querySelectorAll('[data-clear-alarm-note]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      clearNoteAlarm(btn.dataset.clearAlarmNote, btn.dataset.clearAlarmId, btn.dataset.clearAlarmKind);
    });
  });
}

function reminderItemsForKeys(keys = []) {
  const selected = new Set((keys || []).filter(Boolean));
  return getAlarmItems().filter(item => selected.has(item.key));
}

async function markReminderItemsRead(keys = []) {
  const selected = new Set((keys || []).filter(Boolean));
  const targets = getAlarmItems().filter(item =>
    item.readable &&
    (selected.size ? selected.has(item.key) : !item.read)
  );
  const readKeys = targets.flatMap(reminderItemReadKeys);
  if (!readKeys.length) {
    showToast(selected.size ? 'No Selected Reminders To Read' : 'No Unread Reminders', 'success');
    return;
  }
  if (typeof persistNotificationReads === 'function') await persistNotificationReads(readKeys);
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('alarms');
}

async function markReminderItemsUnread(keys = []) {
  const selected = new Set((keys || []).filter(Boolean));
  if (!selected.size) {
    showToast('No Selected Reminders', 'success');
    return;
  }
  const targets = reminderItemsForKeys([...selected]).filter(item => item.readable);
  const readKeys = targets.flatMap(reminderItemReadKeys);
  if (!readKeys.length) {
    showToast('No Selected Read Reminders', 'success');
    return;
  }
  if (typeof persistNotificationUnreads === 'function') await persistNotificationUnreads(readKeys);
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('alarms');
  showToast(targets.length === 1 ? 'Reminder Marked Unread' : 'Reminders Marked Unread', 'success');
}

async function deleteReadReminderItems(keys = []) {
  const selected = new Set((keys || []).filter(Boolean));
  const targets = selected.size
    ? reminderItemsForKeys([...selected])
    : getAlarmItems().filter(item => item.readable && item.read);
  if (!targets.length) {
    showToast(selected.size ? 'No Selected Reminders' : 'No Read Reminders', 'success');
    return;
  }
  const commitDelete = async () => {
    for (const item of targets) {
      await clearNoteAlarm(item.noteId, item.alarmId, item.kind);
    }
    showToast(targets.length === 1 ? 'Reminder Deleted' : 'Reminders Deleted', 'success');
  };
  if (typeof openDeleteConfirmationModal === 'function') {
    openDeleteConfirmationModal({
      title: selected.size ? 'Delete Selected Reminders?' : 'Delete Read Reminders?',
      target: targets.length === 1 ? (targets[0].text || 'Reminder') : targets.length + ' Reminders',
      copy: 'Deletes the reminder items from this list. The related notes stay available.',
      confirmLabel: targets.length === 1 ? 'Delete Reminder' : 'Delete Reminders',
      onConfirm: commitDelete
    });
    return;
  }
  await commitDelete();
}

async function openAlarmFromList(noteId, alarmId, kind) {
  document.getElementById('alarms-modal')?.classList.remove('open');
  if (!notes[noteId]) {
    if (kind === 'received' && noteId && typeof openDirectSharedNote === 'function' && await openDirectSharedNote(noteId)) return;
    showToast('That Note Is Not Available', 'error');
    return;
  }
  openNote(noteId);
  if ((kind === 'inline' || kind === 'sent') && alarmId) {
    setTimeout(() => {
      const mark = findAlarmMark(getEd(), alarmId);
      if (mark) selectAlarmMarkText(mark);
    }, 90);
  }
}

function openAlarmsModal() {
  setSidebarView('alarms');
}

function localDateParts(date) {
  const pad = n => String(n).padStart(2, '0');
  return {
    date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()),
    time: pad(date.getHours()) + ':' + pad(date.getMinutes())
  };
}

function defaultAlarmParts() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return localDateParts(date);
}

function parseAlarmInput(dateValue, timeValue) {
  const dateText = String(dateValue || '').trim();
  const timeText = String(timeValue || '').trim();
  if (!dateText && !timeText) return '';

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let day = now.getDate();
  let hour = dateText && !timeText ? 9 : now.getHours();
  let minute = dateText && !timeText ? 0 : now.getMinutes();

  if (dateText) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
    if (!dateMatch) return '';
    year = Number(dateMatch[1]);
    month = Number(dateMatch[2]) - 1;
    day = Number(dateMatch[3]);
  }

  if (timeText) {
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeText);
    if (!timeMatch) return '';
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
  }

  const date = new Date(year, month, day, hour, minute, 0, 0);
  if (!Number.isFinite(date.getTime())) return '';
  if (!dateText && timeText && date <= now) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function updateAlarmSummary() {
  const summary = document.getElementById('alarm-summary');
  const alarmAt = parseAlarmInput(
    document.getElementById('alarm-date-input')?.value,
    document.getElementById('alarm-time-input')?.value
  );
  if (summary) {
    const targetUid = selectedAlarmRecipientUid();
    const prefix = targetUid ? ('For ' + alarmRecipientName(targetUid) + ': ') : '';
    summary.textContent = alarmAt ? prefix + formatAlarmDateTime(alarmAt) : '';
  }
}

function selectedAlarmRecipientUid() {
  const value = document.getElementById('alarm-recipient-select')?.value || 'me';
  return value && value !== 'me' ? value : '';
}

function alarmRecipientName(uid) {
  if (!uid) return 'Me';
  const friend = friends[uid] || linkedProfiles[uid];
  return friend?.displayName || friend?.email || 'Friend';
}

function currentAlarmRecipientProfile() {
  const photos = profilePhotoFields(
    currentProfile?.photoURL,
    currentProfile?.photoURLCandidates,
    photoCandidatesFromUser(auth.currentUser)
  );
  const email = normalizeEmail(currentProfile?.email || auth.currentUser?.email || '');
  return {
    uid: 'me',
    displayName: currentProfile?.displayName || auth.currentUser?.displayName || 'Me',
    email,
    photoURL: photos.photoURL,
    photoURLCandidates: photos.photoURLCandidates
  };
}

function canSendFriendReminderForNote(note) {
  return !!(note && (!note.owner || note.owner === userId));
}

function renderAlarmRecipientOption(value, profile, subtitle, selected) {
  return '<button class="alarm-recipient-option' + (selected ? ' active' : '') + '" data-alarm-recipient-option="' + esc(value) + '" type="button" role="radio" aria-checked="' + (selected ? 'true' : 'false') + '">' +
    renderProfileAvatar(profile) +
    '<span class="alarm-recipient-copy">' +
      '<span class="alarm-recipient-name">' + esc(profile.displayName || profile.email || (value === 'me' ? 'Me' : 'Friend')) + '</span>' +
      '<span class="alarm-recipient-sub">' + esc(subtitle || profile.email || '') + '</span>' +
    '</span>' +
  '</button>';
}

function updateAlarmRecipientOptionState() {
  const list = document.getElementById('alarm-recipient-options');
  const select = document.getElementById('alarm-recipient-select');
  if (!list || !select) return;
  list.querySelectorAll('[data-alarm-recipient-option]').forEach(btn => {
    const active = btn.dataset.alarmRecipientOption === select.value;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

function setAlarmRecipientValue(value) {
  const select = document.getElementById('alarm-recipient-select');
  if (!select) return;
  const allowed = [...select.options].some(option => option.value === value);
  select.value = allowed ? value : 'me';
  updateAlarmRecipientOptionState();
  updateAlarmRecipientState();
  updateAlarmSummary();
}

function populateAlarmRecipientOptions(note, selectedUid = '') {
  const select = document.getElementById('alarm-recipient-select');
  const list = document.getElementById('alarm-recipient-options');
  if (!select) return;
  const friendOptions = canSendFriendReminderForNote(note) ? friendArray() : [];
  const selectedValue = selectedUid && friendOptions.some(friend => friend.uid === selectedUid) ? selectedUid : 'me';
  select.innerHTML = '<option value="me">Me</option>' + friendOptions.map(friend =>
    '<option value="' + esc(friend.uid) + '">' + esc(friend.displayName || friend.email || 'Friend') + '</option>'
  ).join('');
  select.value = selectedValue;
  if (!list) return;
  list.innerHTML = renderAlarmRecipientOption('me', currentAlarmRecipientProfile(), 'Personal reminder', selectedValue === 'me') +
    friendOptions.map(friend => renderAlarmRecipientOption(
      friend.uid,
      friend,
      friend.email || 'Friend reminder',
      selectedValue === friend.uid
    )).join('');
  list.querySelectorAll('[data-alarm-recipient-option]').forEach(btn => {
    btn.addEventListener('click', () => setAlarmRecipientValue(btn.dataset.alarmRecipientOption || 'me'));
  });
}

function updateAlarmRecipientState() {
  const clearBtn = document.getElementById('alarm-clear');
  if (!clearBtn || !_alarmContext) return;
  clearBtn.style.display = _alarmContext.alarmId && (_alarmContext.direction === 'sent' || !selectedAlarmRecipientUid()) ? '' : 'none';
}

function getEditorRangeOrEnd() {
  const ed = getEd();
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (container && ed.contains(container)) return range.cloneRange();
  }
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  return range;
}

function openNoteAlarmModal(noteId = activeId) {
  if (!noteId || !notes[noteId]) {
    showToast('Select A Note First', 'error');
    return;
  }
  const range = getEditorRangeOrEnd();
  const existingMark = alarmMarkForRange(range);
  if (existingMark && !existingMark.dataset.alarmId) existingMark.dataset.alarmId = makeAlarmId();
  const existingAt = normalizeAlarmAt(existingMark?.dataset.alarmAt);
  const existingDirection = existingMark?.dataset.alarmDirection || '';
  const existingTargetUid = existingMark?.dataset.alarmTargetUid || '';
  const parts = existingAt ? localDateParts(new Date(existingAt)) : defaultAlarmParts();
  const dateInput = document.getElementById('alarm-date-input');
  const timeInput = document.getElementById('alarm-time-input');
  const targetText = document.getElementById('alarm-target-text');
  const clearBtn = document.getElementById('alarm-clear');
  const selectedText = existingMark
    ? alarmTextFromMark(existingMark)
    : (range.collapsed ? 'New reminder text' : (range.toString().replace(/\s+/g, ' ').trim() || 'Selected text'));

  _alarmNoteId = noteId;
  _alarmContext = {
    noteId,
    range,
    alarmId: existingMark?.dataset.alarmId || '',
    direction: existingDirection,
    targetUid: existingTargetUid,
    targetText: selectedText,
    mode: existingMark ? 'update' : (range.collapsed ? 'insert' : 'wrap')
  };

  dateInput.value = parts.date;
  timeInput.value = parts.time;
  targetText.textContent = selectedText;
  populateAlarmRecipientOptions(notes[noteId], existingDirection === 'sent' ? existingTargetUid : '');
  clearBtn.style.display = existingMark ? '' : 'none';
  updateAlarmRecipientState();
  updateAlarmSummary();
  document.getElementById('note-alarm-modal')?.classList.add('open');
  setTimeout(() => timeInput.focus(), 120);
}

function closeNoteAlarmModal() {
  document.getElementById('note-alarm-modal')?.classList.remove('open');
  _alarmNoteId = null;
  _alarmContext = null;
}

function restoreAlarmContextRange() {
  if (!_alarmContext?.range) return null;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(_alarmContext.range);
  return _alarmContext.range;
}

function applyAlarmToRange(range, alarmAt, options = {}) {
  const mark = createAlarmMark(alarmAt, options.alarmId || _alarmContext?.alarmId || makeAlarmId());
  if (options.direction) mark.dataset.alarmDirection = options.direction;
  if (options.targetUid) mark.dataset.alarmTargetUid = options.targetUid;
  if (options.targetName) mark.dataset.alarmTargetName = options.targetName;
  updateAlarmMarkDisplay(mark);
  if (range.collapsed) {
    mark.textContent = 'Reminder';
    range.insertNode(mark);
    selectAlarmMarkText(mark);
    return mark;
  }
  mark.appendChild(range.extractContents());
  mark.querySelectorAll('.note-alarm').forEach(nested => unwrapAlarmMark(nested));
  range.insertNode(mark);
  placeCursorAfterNode(mark);
  return mark;
}

function applySentReminderTextMark(reminderId, alarmAt, targetUid) {
  if (!reminderId || !_alarmContext?.noteId || !notes[_alarmContext.noteId]) return false;
  if (activeId !== _alarmContext.noteId) openNote(_alarmContext.noteId);
  const ed = getEd();
  if (!ed) return false;
  const targetName = alarmRecipientName(targetUid);
  pushUndo();
  let mark = findAlarmMark(ed, reminderId);
  if (mark) {
    mark.dataset.alarmAt = alarmAt;
    mark.dataset.alarmDirection = 'sent';
    mark.dataset.alarmTargetUid = targetUid || '';
    mark.dataset.alarmTargetName = targetName;
    updateAlarmMarkDisplay(mark);
    placeCursorAfterNode(mark);
  } else {
    const range = restoreAlarmContextRange();
    if (!range) return false;
    mark = applyAlarmToRange(range, alarmAt, {
      alarmId: reminderId,
      direction: 'sent',
      targetUid,
      targetName
    });
  }
  restoreAlarmMarks(ed);
  refreshEmpty(ed);
  if (syncActiveNoteFromEditor()) {
    renderAlarmButton();
    if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
    refreshOpenSidebarPage('alarms');
    scheduleUndoSnapshot();
    scheduleSave();
  }
  return true;
}

function friendReminderErrorMessage(reason) {
  if (reason === 'save_failed') return 'Could Not Save Note For Reminder';
  if (reason === 'share_failed') return 'Could Not Share Note For Reminder';
  if (reason === 'delivery_failed') return 'Could Not Deliver Reminder';
  return 'Could Not Send Reminder';
}

async function saveNoteAlarm() {
  if (!_alarmContext || !_alarmContext.noteId || !notes[_alarmContext.noteId]) return;
  const alarmAt = parseAlarmInput(
    document.getElementById('alarm-date-input')?.value,
    document.getElementById('alarm-time-input')?.value
  );
  if (!alarmAt) {
    showToast('Enter A Time Or Date', 'error');
    return;
  }
  const targetUid = selectedAlarmRecipientUid();
  if (targetUid) {
    if (typeof sendFriendReminder !== 'function') {
      showToast('Could Not Send Reminder', 'error');
      return;
    }
    let result;
    try {
      result = await sendFriendReminder(
        _alarmContext.noteId,
        targetUid,
        alarmAt,
        _alarmContext.targetText || document.getElementById('alarm-target-text')?.textContent || 'Reminder'
      );
    } catch (err) {
      console.error('send friend reminder:', err);
      result = { ok: false, reason: 'send_failed' };
    }
    if (!result?.ok) {
      showToast(friendReminderErrorMessage(result?.reason), 'error');
      return;
    }
    try {
      applySentReminderTextMark(result.id, alarmAt, targetUid);
    } catch (err) {
      console.warn('mark sent reminder in text:', err);
    }
    renderAlarmButton();
    if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
    refreshOpenSidebarPage('alarms');
    closeNoteAlarmModal();
    showToast(
      result.cloudSynced ? 'Reminder Sent To ' + alarmRecipientName(targetUid) : 'Reminder sent; Sent list cloud sync failed',
      result.cloudSynced ? 'success' : 'error'
    );
    return;
  }
  if (activeId !== _alarmContext.noteId) openNote(_alarmContext.noteId);
  const ed = getEd();
  getEd().focus();
  pushUndo();
  const mark = _alarmContext.alarmId ? findAlarmMark(ed, _alarmContext.alarmId) : null;
  if (mark) {
    mark.dataset.alarmAt = alarmAt;
    updateAlarmMarkDisplay(mark);
    placeCursorAfterNode(mark);
  } else {
    const range = restoreAlarmContextRange();
    if (!range) return;
    applyAlarmToRange(range, alarmAt);
  }
  restoreAlarmMarks(ed);
  refreshEmpty(ed);
  if (syncActiveNoteFromEditor()) {
    renderAlarmButton();
    if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
    refreshOpenSidebarPage('alarms');
    scheduleUndoSnapshot();
    scheduleSave();
  }
  closeNoteAlarmModal();
  showToast('Reminder Set', 'success');
}

async function removeInlineAlarm(noteId, alarmId) {
  if (!noteId || !alarmId || !notes[noteId]) return;
  if (activeId === noteId) {
    const mark = findAlarmMark(getEd(), alarmId);
    if (mark) {
      pushUndo();
      unwrapAlarmMark(mark);
      refreshEmpty(getEd());
      if (syncActiveNoteFromEditor()) {
        scheduleUndoSnapshot();
        scheduleSave();
      }
    }
  } else {
    const root = document.createElement('div');
    root.innerHTML = notes[noteId].content || '';
    const mark = findAlarmMark(root, alarmId);
    if (mark) {
      unwrapAlarmMark(mark);
      notes[noteId].content = root.innerHTML;
      notes[noteId].modified = new Date().toISOString();
      await saveDoc(notes[noteId]);
    }
  }
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('alarms');
}

async function clearLegacyNoteAlarm(noteId) {
  if (!noteId) return;
  delete noteAlarms[noteId];
  _writeNoteAlarmsToLocal();
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('alarms');
  try {
    await setDoc(_getUserDocRef(), { noteAlarms: { [noteId]: null } }, { merge: true });
    showToast('Reminder Cleared', 'success');
  } catch (err) {
    console.error('clear note alarm:', err);
    showToast('Reminder cleared locally; cloud sync failed', 'error');
  }
}

async function deleteReminderDeliveryCopies(reminder, fallbackUid = '', fallbackEmail = '') {
  const reminderId = reminder?.id || reminder?.reminderId || '';
  if (!reminderId) return true;
  const targetUid = reminder?.targetUid || reminder?.recipientUid || fallbackUid || '';
  const targetEmail = normalizeEmail(reminder?.targetEmail || reminder?.recipientEmail || fallbackEmail || '');
  const deletes = [];
  if (targetUid) deletes.push({ promise: deleteDoc(doc(fsDb, 'profileShares', targetUid, 'items', reminderId)) });
  if (targetEmail) deletes.push({ promise: deleteDoc(doc(fsDb, 'profileEmailShares', emailProfileDocId(targetEmail), 'items', reminderId)) });
  if (reminder?.noteId && targetUid && targetUid !== userId && typeof noteAccessDocId === 'function') {
    deletes.push({ optionalMissing: true, promise: updateDoc(doc(fsDb, 'noteAccess', noteAccessDocId(reminder.noteId, targetUid)), {
      ['reminders.' + reminderId]: deleteField(),
      modified: serverTimestamp()
    }) });
  }
  if (!deletes.length) return true;
  const results = await Promise.allSettled(deletes.map(item => item.promise));
  const failed = results.some((result, index) =>
    result.status === 'rejected' &&
    !(deletes[index]?.optionalMissing && result.reason?.code === 'not-found')
  );
  if (failed) {
    console.warn('delete reminder delivery copies:', results);
    return false;
  }
  return true;
}

async function clearSentReminder(reminderId, fallbackNoteId = '') {
  if (!reminderId) return;
  const reminder = sentReminders[reminderId];
  delete sentReminders[reminderId];
  _writeSentRemindersToLocal();
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('alarms');
  let cloudSynced = true;
  let deliveryDeleted = true;
  const markerNoteId = reminder?.noteId || fallbackNoteId;
  if (markerNoteId) {
    try {
      await removeInlineAlarm(markerNoteId, reminderId);
    } catch (err) {
      console.warn('remove sent reminder text marker:', err);
    }
  }
  try {
    await updateDoc(_getUserDocRef(), { ['sentReminders.' + reminderId]: deleteField() });
  } catch (err) {
    cloudSynced = false;
    console.error('clear sent reminder:', err);
  }
  try {
    deliveryDeleted = await deleteReminderDeliveryCopies(reminder || { id: reminderId });
  } catch (err) {
    deliveryDeleted = false;
    console.warn('delete sent reminder delivery:', err);
  }
  if (cloudSynced && deliveryDeleted) {
    showToast('Reminder Cleared', 'success');
  } else if (cloudSynced) {
    console.warn('sent reminder cleared, recipient cleanup incomplete:', reminderId);
    showToast('Reminder Cleared', 'success');
  } else {
    showToast('Reminder cleared locally; cloud sync failed', 'error');
  }
}

async function clearReceivedReminder(reminderId) {
  if (!reminderId) return;
  const reminder = profileShareNotifications[reminderId] || { id: reminderId };
  const clearedKey = typeof reminderClearedReadKey === 'function' ? reminderClearedReadKey(reminderId) : '';
  if (clearedKey) readNotifications[clearedKey] = true;
  delete profileShareNotifications[reminderId];
  _writeNotificationStateToLocal();
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('alarms');
  try {
    const email = normalizeEmail(currentProfile?.email || auth.currentUser?.email || '');
    const deleted = await deleteReminderDeliveryCopies(reminder, userId, email);
    if (clearedKey && typeof persistNotificationReads === 'function') await persistNotificationReads([clearedKey]);
    showToast(deleted ? 'Reminder Cleared' : 'Reminder cleared locally; cloud sync failed', deleted ? 'success' : 'error');
  } catch (err) {
    console.error('clear received reminder:', err);
    if (clearedKey && typeof persistNotificationReads === 'function') await persistNotificationReads([clearedKey]);
    showToast('Reminder cleared locally; cloud sync failed', 'error');
  }
}

async function clearNoteAlarm(noteId = _alarmContext?.noteId || _alarmNoteId, alarmId = _alarmContext?.alarmId || '', kind = '') {
  if (kind === 'sent') {
    await clearSentReminder(alarmId, noteId);
    return;
  }
  if (_alarmContext?.direction === 'sent' && (_alarmContext.alarmId || alarmId)) {
    await clearSentReminder(_alarmContext.alarmId || alarmId, noteId);
    closeNoteAlarmModal();
    return;
  }
  if (kind === 'received') {
    await clearReceivedReminder(alarmId);
    return;
  }
  if (alarmId || kind === 'inline') {
    await removeInlineAlarm(noteId, alarmId);
    if (_alarmContext?.noteId === noteId) closeNoteAlarmModal();
    showToast('Reminder Cleared', 'success');
    return;
  }
  if (_alarmContext?.mode && _alarmContext.mode !== 'update') {
    closeNoteAlarmModal();
    return;
  }
  if (_alarmContext?.alarmId) {
    await removeInlineAlarm(_alarmContext.noteId, _alarmContext.alarmId);
    closeNoteAlarmModal();
    showToast('Reminder Cleared', 'success');
    return;
  }
  await clearLegacyNoteAlarm(noteId);
  if (_alarmNoteId === noteId) closeNoteAlarmModal();
}

function closeMentionShareModal(result) {
  document.getElementById('mention-share-modal')?.classList.remove('open');
  if (_mentionShareResolver) {
    const resolve = _mentionShareResolver;
    _mentionShareResolver = null;
    resolve(!!result);
  }
}

function confirmMentionShare(profile, note) {
  if (_mentionShareResolver) return Promise.resolve(false);
  const modal = document.getElementById('mention-share-modal');
  const body = document.getElementById('mention-share-body');
  if (!modal || !body) return Promise.resolve(false);
  body.textContent = 'Do you want to share this note with ' + (profile?.displayName || profile?.email || 'this user') + '?';
  modal.classList.add('open');
  return new Promise(resolve => { _mentionShareResolver = resolve; });
}

function mentionProfilesForQuery(queryText) {
  const q = (queryText || '').toLowerCase();
  return linkedProfileArray()
    .filter(p => !q || (p.displayName || '').toLowerCase().includes(q))
    .slice(0, 6);
}

function findMentionContext() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const ed = getEd();
  if (!ed || !ed.contains(range.startContainer)) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest('.mention')) return null;
  const before = node.textContent.slice(0, range.startOffset);
  const match = /(^|[\s([{])@([A-Za-z0-9_.-]{0,40})$/.exec(before);
  if (!match) return null;
  const start = range.startOffset - match[2].length - 1;
  const replaceRange = document.createRange();
  replaceRange.setStart(node, start);
  replaceRange.setEnd(node, range.startOffset);
  return { range: replaceRange, query: match[2] };
}

function positionMentionPopover(range) {
  const pop = document.getElementById('mention-popover');
  if (!pop) return;
  const rect = range.getBoundingClientRect();
  const editorRect = getEd().getBoundingClientRect();
  const width = pop.offsetWidth || 260;
  let left = rect.left || editorRect.left + 22;
  let top = (rect.bottom || editorRect.top + 44) + 7;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  if (top > window.innerHeight - 220) top = Math.max(8, (rect.top || editorRect.top) - 190);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function hideMentionPopover() {
  const pop = document.getElementById('mention-popover');
  if (pop) pop.hidden = true;
  _mentionState = null;
  _mentionActiveIndex = 0;
}

function renderMentionPopover() {
  const ctx = findMentionContext();
  const pop = document.getElementById('mention-popover');
  if (!pop || !ctx) { hideMentionPopover(); return; }
  const profiles = mentionProfilesForQuery(ctx.query);
  if (!profiles.length) { hideMentionPopover(); return; }
  _mentionState = { ...ctx, profiles };
  _mentionActiveIndex = Math.min(_mentionActiveIndex, profiles.length - 1);

  pop.innerHTML = profiles.map((p, i) =>
    '<div class="mention-option' + (i === _mentionActiveIndex ? ' active' : '') + '" data-mention-uid="' + esc(p.uid) + '">' +
      renderProfileAvatar(p) +
      '<div class="profile-main"><div class="profile-name">' + esc(p.displayName) + '</div><div class="profile-sub">@mention</div></div>' +
    '</div>'
  ).join('');
  pop.hidden = false;
  positionMentionPopover(ctx.range);

  pop.querySelectorAll('[data-mention-uid]').forEach(row => {
    row.addEventListener('mousedown', e => e.preventDefault());
    row.addEventListener('click', () => {
      const profile = profiles.find(p => p.uid === row.dataset.mentionUid);
      if (profile) insertMention(profile);
    });
  });
}

function handleMentionKeydown(e) {
  const pop = document.getElementById('mention-popover');
  if (!pop || pop.hidden || !_mentionState?.profiles?.length) return false;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _mentionActiveIndex = (_mentionActiveIndex + 1) % _mentionState.profiles.length;
    renderMentionPopover();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    _mentionActiveIndex = (_mentionActiveIndex - 1 + _mentionState.profiles.length) % _mentionState.profiles.length;
    renderMentionPopover();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    insertMention(_mentionState.profiles[_mentionActiveIndex]);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    hideMentionPopover();
    return true;
  }
  return false;
}

function insertMention(profile) {
  if (!profile || !_mentionState?.range) return;
  pushUndo();
  const range = _mentionState.range;
  range.deleteContents();

  const mention = document.createElement('span');
  mention.className = 'mention';
  mention.dataset.mentionUid = profile.uid;
  mention.setAttribute('contenteditable', 'false');
  mention.textContent = '@' + (profile.displayName || 'Profile');
  const space = document.createTextNode('\u00a0');
  const frag = document.createDocumentFragment();
  frag.appendChild(mention);
  frag.appendChild(space);
  range.insertNode(frag);

  const sel = window.getSelection();
  const next = document.createRange();
  next.setStartAfter(space);
  next.collapse(true);
  sel.removeAllRanges();
  sel.addRange(next);
  hideMentionPopover();
  refreshEmpty(getEd());
  if (syncActiveNoteFromEditor()) {
    scheduleUndoSnapshot();
    scheduleSave();
    scheduleMentionSync();
  }
}

function mentionedUidsInEditor() {
  const ed = getEd();
  if (!ed) return [];
  return [...new Set([...ed.querySelectorAll('[data-mention-uid]')]
    .map(el => el.getAttribute('data-mention-uid'))
    .filter(uid => uid && uid !== userId && linkedProfiles[uid]))];
}

function scheduleMentionSync() {
  clearTimeout(_mentionSaveTimer);
  _mentionSaveTimer = setTimeout(syncMentionNotifications, 1000);
}

async function syncMentionNotifications() {
  if (_mentionShareResolver) return;
  if (!activeId || !notes[activeId] || !userId) return;
  const note = notes[activeId];
  const current = mentionedUidsInEditor();
  if (!current.length) return;
  const already = new Set(Array.isArray(note.mentionedUids) ? note.mentionedUids : []);
  const fresh = current.filter(uid => !already.has(uid));
  if (!fresh.length) return;

  const sent = [];
  for (const uid of fresh) {
    const profile = linkedProfiles[uid];
    if (!profile) continue;
    const promptKey = note.id + ':' + uid;
    if (!isNoteSharedWithProfile(note, profile)) {
      if (!isOwnedNote(note)) {
        showToast('Only The Owner Can Share This Mention', 'error');
        declinedMentionShares.add(promptKey);
        continue;
      }
      if (declinedMentionShares.has(promptKey)) continue;
      const shouldShare = await confirmMentionShare(profile, note);
      if (!shouldShare) {
        declinedMentionShares.add(promptKey);
        continue;
      }
    }
    let accessOk = false;
    let mentionOk = false;
    try {
      accessOk = await shareNoteWithFriend(note.id, friends[uid] || profile, 'editor', {}, { silent: true });
    } catch (err) {
      console.error('mention access:', err);
    }
    try {
      mentionOk = await shareNoteWithProfile(note.id, uid, 'mention', {}, { silent: true });
    } catch (err) {
      console.error('mention notification:', err);
    }
    if (accessOk || mentionOk) sent.push(uid);
  }
  if (!sent.length) return;
  note.mentionedUids = [...new Set([...(note.mentionedUids || []), ...sent])];
  try {
    await setDoc(doc(fsDb, 'notes', note.id), { mentionedUids: arrayUnion(...sent) }, { merge: true });
  } catch (err) {
    console.error('save mentioned users:', err);
  }
  showToast(sent.length === 1 ? 'Mention Notification Sent' : 'Mention Notifications Sent', 'success');
}

// Subscribe to a single shared note document for real-time updates.
