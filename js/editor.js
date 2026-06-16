/* Editor helpers, toolbar actions, alarms, and mentions - extracted from index.original.html. */
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
  restoreChecklistState(ed);
  restoreAlarmMarks(ed);
  decorateTables(ed);
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
  if (syncActiveNoteFromEditor()) scheduleSave();
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

function decorateLink(link, href) {
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
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
}

/* Delete Modal */

function recomputeCollapsedSections() {
  let collapsedLevel = Infinity;
  for (const el of getEd().children) {
    const tag = el.tagName;
    const isHeading = /^H[1-4]$/.test(tag);
    const level = isHeading ? parseInt(tag[1]) : null;
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
}

function saveCollapsedState(noteId) {
  if (!noteId) return;
  const headings = [...getEd().querySelectorAll('h1,h2,h3,h4')];
  const indices = headings.reduce((acc, h, i) => { if (h.hasAttribute('data-collapsed')) acc.push(i); return acc; }, []);
  if (indices.length) localStorage.setItem('notas_col_' + noteId, JSON.stringify(indices));
  else localStorage.removeItem('notas_col_' + noteId);
}

function restoreCollapsedState(noteId) {
  if (!noteId) return;
  const raw = localStorage.getItem('notas_col_' + noteId);
  if (!raw) return;
  try {
    const indices = JSON.parse(raw);
    const headings = [...getEd().querySelectorAll('h1,h2,h3,h4')];
    indices.forEach(i => { if (headings[i]) headings[i].setAttribute('data-collapsed', ''); });
    recomputeCollapsedSections();
  } catch (_) {}
}

function getCleanHTML() {
  const clone = getEd().cloneNode(true);
  clone.querySelectorAll('[data-collapsed]').forEach(el => el.removeAttribute('data-collapsed'));
  clone.querySelectorAll('.note-alarm').forEach(el => {
    el.classList.remove('alarm-due');
    if (!el.classList.length) el.removeAttribute('class');
  });
  cleanupInlineCodePlaceholders(clone);
  stripZeroWidthText(clone);
  normalizeChecklistStructure(clone);
  stripTableEditorChrome(clone);
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

function createTableControls(title = '') {
  const controls = document.createElement('div');
  controls.className = 'table-controls';
  controls.setAttribute('contenteditable', 'false');
  controls.innerHTML =
    '<input class="table-title-input" data-table-title-input type="text" placeholder="Table header" value="' + esc(title) + '" aria-label="Table header" />' +
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

const TABLE_MIN_COLUMN_WIDTH = 72;
const TABLE_DEFAULT_COLUMN_WIDTH = 150;

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
  table.style.width = '100%';
  table.style.minWidth = '';
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
  const canScroll = scrollWrap.scrollWidth - scrollWrap.clientWidth > 2;
  scrollWrap.classList.toggle('is-scrollable', canScroll);
  if (!canScroll) scrollWrap.scrollLeft = 0;
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
  return changed;
}

function updateTableResizeHandles(table) {
  const scrollWrap = tableScrollWrapForTable(table);
  const controls = scrollWrap?.querySelector(':scope > .table-resize-controls');
  if (!table || !scrollWrap || !controls) return;
  updateTableScrollState(table);
  const colCount = tableColumnCount(table);
  if (colCount <= 1 || !getEd()?.isContentEditable) {
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
  existing.forEach((handle, key) => {
    if (!keep.has(key)) handle.remove();
  });
}

function refreshTableResizeHandles(root = getEd()) {
  root?.querySelectorAll?.('table').forEach(table => {
    updateTableScrollState(table);
    updateTableResizeHandles(table);
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
      return;
    }
    wrap.classList.add('has-table-controls');
    if (!wrap.querySelector(':scope > .table-controls')) {
      wrap.insertBefore(createTableControls(tableCaptionText(table)), wrap.firstChild);
      changed = true;
    }
    updateTableResizeHandles(table);
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
  scrollWrap.appendChild(table);
  scrollWrap.appendChild(resizeControls);
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
  // Validate URL protocol to prevent javascript: XSS
  let url;
  try { url = new URL(raw); } catch { return; }
  if (!/^https?:$/i.test(url.protocol)) return;
  getEd().focus();
  if (_linkSavedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_linkSavedRange);
  }
  pushUndo();
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    const link = document.createElement('a');
    decorateLink(link, url.href);
    const range = sel.getRangeAt(0);
    link.appendChild(range.extractContents());
    range.insertNode(link);
    range.setStartAfter(link);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    const link = document.createElement('a');
    decorateLink(link, url.href);
    link.textContent = url.href;
    const range = sel.getRangeAt(0);
    range.insertNode(link);
    range.setStartAfter(link);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
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

const TABLE_ALLOWED_ACTIONS = new Set(['bold', 'italic', 'strikethrough', 'code', 'link']);

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
  mark.dataset.alarmAt = alarmAt;
  mark.classList.add('note-alarm');
  mark.classList.toggle('alarm-due', new Date(alarmAt).getTime() <= Date.now());
  mark.title = 'Reminder: ' + formatAlarmDateTime(alarmAt);
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
  Object.values(sentReminders || {}).forEach(reminder => {
    const normalized = normalizeSentReminder(reminder?.id, reminder);
    if (!normalized) return;
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
      due: new Date(normalized.reminderAt).getTime() <= Date.now()
    });
  });
  return items.sort((a, b) => new Date(a.alarmAt) - new Date(b.alarmAt));
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

function renderReminderItem(item) {
  return '<div class="profile-row alarm-row' + (item.due ? ' due' : '') + '" data-alarm-note-id="' + esc(item.noteId) + '" data-alarm-id="' + esc(item.alarmId) + '" data-alarm-kind="' + esc(item.kind) + '">' +
    '<span class="alarm-icon"><i class="' + reminderItemIcon(item) + '"></i></span>' +
    '<div class="profile-main">' +
      '<div class="alarm-text">' + esc(item.text) + '</div>' +
      '<div class="alarm-note-title">' + esc(reminderItemMeta(item)) + '</div>' +
      '<div class="notification-time">' + esc(formatAlarmDateTime(item.alarmAt)) + (item.due ? ' · Due' : '') + '</div>' +
    '</div>' +
    '<button class="modal-btn" data-clear-alarm-note="' + esc(item.noteId) + '" data-clear-alarm-id="' + esc(item.alarmId) + '" data-clear-alarm-kind="' + esc(item.kind) + '" type="button" title="Clear Reminder" aria-label="Clear Reminder"><i class="fa-solid fa-xmark"></i></button>' +
  '</div>';
}

function renderAlarmsList(target = 'alarms-list') {
  const list = typeof target === 'string' ? document.getElementById(target) : target;
  if (!list) return;
  const items = getAlarmItems();
  if (!items.length) {
    list.innerHTML = '<div class="profile-empty">No reminders set.</div>';
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

  list.querySelectorAll('[data-alarm-note-id]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-clear-alarm-note]')) return;
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

async function openAlarmFromList(noteId, alarmId, kind) {
  document.getElementById('alarms-modal')?.classList.remove('open');
  if (!notes[noteId]) {
    if (kind === 'received' && noteId && typeof openDirectSharedNote === 'function' && await openDirectSharedNote(noteId)) return;
    showToast('That Note Is Not Available', 'error');
    return;
  }
  openNote(noteId);
  if (kind === 'inline' && alarmId) {
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
  clearBtn.style.display = _alarmContext.alarmId && !selectedAlarmRecipientUid() ? '' : 'none';
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
    targetText: selectedText,
    mode: existingMark ? 'update' : (range.collapsed ? 'insert' : 'wrap')
  };

  dateInput.value = parts.date;
  timeInput.value = parts.time;
  targetText.textContent = selectedText;
  populateAlarmRecipientOptions(notes[noteId]);
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

function applyAlarmToRange(range, alarmAt) {
  const mark = createAlarmMark(alarmAt, _alarmContext?.alarmId || makeAlarmId());
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

async function clearSentReminder(reminderId) {
  if (!reminderId) return;
  const reminder = sentReminders[reminderId];
  delete sentReminders[reminderId];
  _writeSentRemindersToLocal();
  renderAlarmButton();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('alarms');
  let cloudSynced = true;
  let deliveryDeleted = true;
  try {
    await setDoc(_getUserDocRef(), { sentReminders: { [reminderId]: null } }, { merge: true });
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
    await clearSentReminder(alarmId);
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
