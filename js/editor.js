/* Editor helpers, toolbar actions, alarms, and mentions - extracted from index.original.html. */
function pushUndo() {
  const ed = getEd();
  if (!ed) return;
  const html = ed.innerHTML;
  if (html === _lastUndoSnapshot) return;
  undoStack.push(_lastUndoSnapshot);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  _lastUndoSnapshot = html;
}

function initUndoSnapshot() {
  const ed = getEd();
  if (ed) _lastUndoSnapshot = ed.innerHTML;
  undoStack.length = 0;
  redoStack.length = 0;
}

function performUndo() {
  if (!undoStack.length) return;
  const ed = getEd();
  redoStack.push(ed.innerHTML);
  const prev = undoStack.pop();
  ed.innerHTML = prev;
  _lastUndoSnapshot = prev;
  restoreChecklistState(ed);
  restoreAlarmMarks(ed);
  refreshEmpty(ed);
  if (syncActiveNoteFromEditor()) scheduleSave();
}

function performRedo() {
  if (!redoStack.length) return;
  const ed = getEd();
  undoStack.push(ed.innerHTML);
  const next = redoStack.pop();
  ed.innerHTML = next;
  _lastUndoSnapshot = next;
  restoreChecklistState(ed);
  restoreAlarmMarks(ed);
  refreshEmpty(ed);
  if (syncActiveNoteFromEditor()) scheduleSave();
}

// Debounced snapshot for regular typing — captures state periodically
function scheduleUndoSnapshot() {
  clearTimeout(_undoDebounceTimer);
  _undoDebounceTimer = setTimeout(() => {
    const ed = getEd();
    if (!ed) return;
    const html = ed.innerHTML;
    if (html !== _lastUndoSnapshot) {
      undoStack.push(_lastUndoSnapshot);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      _lastUndoSnapshot = html;
      // Don't clear redoStack for typing snapshots
    }
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
  Object.keys(notes).sort((a, b) => compareNotes(notes[a], notes[b]));
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
}

// Custom indent for a checklist li: move it into a nested ul.checklist under its
// previous sibling. Relies on pure DOM manipulation — not execCommand — so the
// checklist class is never lost.
function checklistIndent(li) {
  const prev = li.previousElementSibling;
  if (!prev) return; // first item — nothing to nest under

  // Save the live selection (text nodes travel with the li, so the range stays valid)
  const sel = window.getSelection();
  const savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;

  // Append to an existing nested checklist, or create one
  let nested = prev.querySelector(':scope > ul.checklist');
  if (!nested) {
    nested = document.createElement('ul');
    nested.className = 'checklist';
    prev.appendChild(nested);
  }
  nested.appendChild(li);

  if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
}

// Custom outdent for a checklist li: move it to after its parent li in the
// grandparent checklist. Siblings that come after it stay as a sub-list.
function checklistOutdent(li) {
  const parentList = li.parentElement;                       // nested ul.checklist
  if (!parentList || !parentList.classList.contains('checklist')) return;
  const parentLi = parentList.parentElement;                 // containing li
  if (!parentLi || parentLi.tagName !== 'LI') return;        // already at top level
  const grandParent = parentLi.parentElement;
  if (!grandParent) return;

  const sel = window.getSelection();
  const savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;

  grandParent.insertBefore(li, parentLi.nextSibling);

  // Remove the nested list if it is now empty
  if (!parentList.hasChildNodes()) parentList.remove();

  if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
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
}

function placeCursorAtEnd(el) {
  const range = document.createRange(), sel = window.getSelection();
  range.selectNodeContents(el); range.collapse(false);
  sel.removeAllRanges(); sel.addRange(range); el.focus();
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

function setSaveState(s) {
  const dot = document.getElementById('save-dot');
  const lbl = document.getElementById('save-label');
  const cfg = { saved:['saved','Saved'], unsaved:['unsaved','Saving'], saving:['saving','Saving...'], error:['error','Error'], local:['local','Local'], readonly:['local','Read Only'] };
  const [cls, txt] = cfg[s] || cfg.local;
  dot.className = 'save-dot ' + cls; lbl.textContent = txt;
}

function updateCounts() {
  const txt   = document.getElementById('editor').innerText || '';
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
  if (preview) preview.textContent = editorEl.innerText.replace(/\s+/g,' ').trim().slice(0,65) || 'Empty Note';
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
    const tail = extractTrailingContent();
    const quote = document.createElement('blockquote');
    if (tail.textContent || tail.childNodes.length > 0) quote.appendChild(tail);
    else quote.appendChild(document.createElement('br'));
    swapBlock(block, quote, quote);
    return true;
  }

  if (/^[-+*]$/.test(marker)) {
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

function insertInlineCode() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { getEd().focus(); return; }
  const range = sel.getRangeAt(0);
  const code  = document.createElement('code');
  code.appendChild(range.collapsed ? document.createTextNode('Code') : range.extractContents());
  range.insertNode(code);
  const r2 = document.createRange(); r2.selectNodeContents(code);
  sel.removeAllRanges(); sel.addRange(r2);
  getEd().dispatchEvent(new Event('input'));
}

function insertCodeBlock() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { getEd().focus(); return; }
  const range = sel.getRangeAt(0);
  const pre = document.createElement('pre'), code = document.createElement('code');
  code.textContent = range.toString() || 'Code Block';
  pre.appendChild(code);
  if (!range.collapsed) range.deleteContents();
  range.insertNode(pre);
  const p = document.createElement('p'); p.innerHTML = '<br>'; pre.after(p);
  const r2 = document.createRange(); r2.setStart(p, 0); r2.collapse(true);
  sel.removeAllRanges(); sel.addRange(r2);
  getEd().dispatchEvent(new Event('input'));
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
  link:          insertLink,
  alarm:         () => openNoteAlarmModal(activeId),
  hr:            () => { cmd('insertHorizontalRule'); getEd().focus(); },
  indentLeft:    () => {
    const li = ancestorOfType(['li']);
    if (li && li.closest('ul.checklist')) {
      checklistOutdent(li);
      getEd().dispatchEvent(new Event('input'));
    } else {
      document.execCommand('outdent');
    }
    getEd().focus();
  },
  indentRight:   () => {
    const li = ancestorOfType(['li']);
    if (li && li.closest('ul.checklist')) {
      checklistIndent(li);
      getEd().dispatchEvent(new Event('input'));
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
  if (!Number.isFinite(date.getTime())) return 'Invalid alarm';
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function alarmTextFromMark(mark) {
  return (mark?.textContent || '').replace(/\u200b/g, ' ').replace(/\s+/g, ' ').trim() || 'Alarm';
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
  mark.title = 'Alarm: ' + formatAlarmDateTime(alarmAt);
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
      noteId,
      alarmId: '',
      alarmAt,
      title: note.title || 'Untitled Note',
      text: note.title || 'Untitled Note',
      due: new Date(alarmAt).getTime() <= Date.now()
    });
  });
  return items.sort((a, b) => new Date(a.alarmAt) - new Date(b.alarmAt));
}

function renderAlarmButton() {
  const badge = document.getElementById('alarm-badge');
  if (!badge) return;
  const count = getAlarmItems().length;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
}

function renderAlarmsList(target = 'alarms-list') {
  const list = typeof target === 'string' ? document.getElementById(target) : target;
  if (!list) return;
  const items = getAlarmItems();
  if (!items.length) {
    list.innerHTML = '<div class="profile-empty">No alarms set.</div>';
    return;
  }

  list.innerHTML = items.map(item =>
    '<div class="profile-row alarm-row' + (item.due ? ' due' : '') + '" data-alarm-note-id="' + esc(item.noteId) + '" data-alarm-id="' + esc(item.alarmId) + '" data-alarm-kind="' + esc(item.kind) + '">' +
      '<span class="alarm-icon"><i class="fa-solid fa-clock"></i></span>' +
      '<div class="profile-main">' +
        '<div class="alarm-text">' + esc(item.text) + '</div>' +
        '<div class="alarm-note-title">' + esc(item.title) + '</div>' +
        '<div class="notification-time">' + esc(formatAlarmDateTime(item.alarmAt)) + (item.due ? ' · Due' : '') + '</div>' +
      '</div>' +
      '<button class="modal-btn" data-clear-alarm-note="' + esc(item.noteId) + '" data-clear-alarm-id="' + esc(item.alarmId) + '" data-clear-alarm-kind="' + esc(item.kind) + '" type="button" title="Clear"><i class="fa-solid fa-xmark"></i></button>' +
    '</div>'
  ).join('');

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

function openAlarmFromList(noteId, alarmId, kind) {
  document.getElementById('alarms-modal')?.classList.remove('open');
  if (!notes[noteId]) {
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
  if (summary) summary.textContent = alarmAt ? formatAlarmDateTime(alarmAt) : '';
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

  _alarmNoteId = noteId;
  _alarmContext = {
    noteId,
    range,
    alarmId: existingMark?.dataset.alarmId || '',
    mode: existingMark ? 'update' : (range.collapsed ? 'insert' : 'wrap')
  };

  dateInput.value = parts.date;
  timeInput.value = parts.time;
  targetText.textContent = existingMark ? alarmTextFromMark(existingMark) : (range.collapsed ? 'New alarm text' : (range.toString().replace(/\s+/g, ' ').trim() || 'Selected text'));
  clearBtn.style.display = existingMark ? '' : 'none';
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
    mark.textContent = 'Alarm';
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
  if (activeId !== _alarmContext.noteId) openNote(_alarmContext.noteId);
  const ed = getEd();
  getEd().focus();
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
    scheduleSave();
  }
  closeNoteAlarmModal();
  showToast('Alarm Set', 'success');
}

async function removeInlineAlarm(noteId, alarmId) {
  if (!noteId || !alarmId || !notes[noteId]) return;
  if (activeId === noteId) {
    const mark = findAlarmMark(getEd(), alarmId);
    if (mark) {
      unwrapAlarmMark(mark);
      refreshEmpty(getEd());
      if (syncActiveNoteFromEditor()) scheduleSave();
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
    showToast('Alarm Cleared', 'success');
  } catch (err) {
    console.error('clear note alarm:', err);
    showToast('Alarm cleared locally; cloud sync failed', 'error');
  }
}

async function clearNoteAlarm(noteId = _alarmContext?.noteId || _alarmNoteId, alarmId = _alarmContext?.alarmId || '', kind = '') {
  if (alarmId || kind === 'inline') {
    await removeInlineAlarm(noteId, alarmId);
    if (_alarmContext?.noteId === noteId) closeNoteAlarmModal();
    showToast('Alarm Cleared', 'success');
    return;
  }
  if (_alarmContext?.mode && _alarmContext.mode !== 'update') {
    closeNoteAlarmModal();
    return;
  }
  if (_alarmContext?.alarmId) {
    await removeInlineAlarm(_alarmContext.noteId, _alarmContext.alarmId);
    closeNoteAlarmModal();
    showToast('Alarm Cleared', 'success');
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
    try {
      const ok = await shareNoteWithFriend(note.id, friends[uid] || profile, 'editor');
      if (ok) sent.push(uid);
    } catch (err) {
      console.error('mention notification:', err);
    }
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
