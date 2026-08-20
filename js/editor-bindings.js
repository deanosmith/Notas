function bindEditorRootListeners(root) {
  if (!root || root.dataset.editorInteractionsBound === '1') return false;
  root.dataset.editorInteractionsBound = '1';
  if (typeof bindEditorScrollPastEnd === 'function') bindEditorScrollPastEnd(root);
  const noteId = () => editorRootNoteId(root);

  function runNoteImageClipboardCommand(command) {
    root.focus();
    if (!document.execCommand(command, false, null)) {
      showToast('Clipboard Action Is Not Available', 'error');
    }
  }

root.addEventListener('beforeinput', e => runEditorOperationOnRoot(root, () => {

  const currentNoteId = editorRootNoteId(root);
  const activeNote = currentNoteId ? notes[currentNoteId] : null;
  if (!activeNote || !canEditNote(activeNote)) {
    e.preventDefault();
    return;
  }
  if (e.inputType?.startsWith('insert') && typeof shouldBlockSelectedNoteImageReplacement === 'function' && shouldBlockSelectedNoteImageReplacement()) {
    e.preventDefault();
    return;
  }
  if (typeof protectConversationAnchorDeletion === 'function' && protectConversationAnchorDeletion(e, root)) {
    e.preventDefault();
    return;
  }
  refreshUndoSnapshotSelection();
  if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
    _capitalizeNext = true;
  }

  }));

root.addEventListener('input', e => runEditorOperationOnRoot(root, () => {

  const tableTitleInput = e.target.closest?.('[data-table-title-input]');
  if (tableTitleInput) {
    tableTitleInput.setAttribute('value', tableTitleInput.value || '');
    const table = tableTitleInput.closest?.('.note-table-wrap')?.querySelector(':scope > .note-table-scroll > table, :scope > table');
    if (table && typeof setTableCaptionText === 'function') setTableCaptionText(table, tableTitleInput.value || '');
  }
  if (_capitalizeNext && e.inputType === 'insertText' && e.data) {
    if (/[a-z]/.test(e.data[0])) capitalizeCurrentChar(e.data.length);
    _capitalizeNext = false;
  } else if (_capitalizeNext && e.inputType && e.inputType !== 'insertParagraph' && e.inputType !== 'insertLineBreak') {
    _capitalizeNext = false;
  }
  cleanupLiveInlineCodeBoundaries(root, e);
  decorateTables(root);
  decorateNoteImages(root);
  if (typeof removeEmptyNoteImageAnnotations === 'function') removeEmptyNoteImageAnnotations(root);
  recomputeCollapsedSections(root);
  refreshEmpty(root);
  afterEditorRootContentChange(root);

  }));

root.addEventListener('blur', () => runEditorOperationOnRoot(root, () => {
  setTimeout(hideMentionPopover, 120);
  if (hasLinkifiableTextNodes(root)) pushUndo();
  const changed = linkifyTextNodes(root);
  ensureLinkAttrs(root);
  refreshEmpty(root);
  if (changed && syncEditorRootContent(root)) {
    scheduleEditorRootUndoSnapshot(root);
    scheduleEditorRootSave(root);
  } else if (isPeerEditorRoot(root) ? _peerUndoTransactionOpen : _undoTransactionOpen) {
    scheduleEditorRootUndoSnapshot(root);
  }
}));

root.addEventListener('keyup', () => runEditorOperationOnRoot(root, () => {
  renderMentionPopover();
  refreshUndoSnapshotSelection();
  scheduleConversationSelectionPopover();
}));
root.addEventListener('mouseup', () => runEditorOperationOnRoot(root, () => {
  refreshUndoSnapshotSelection();
  scheduleConversationSelectionPopover();
}));
root.addEventListener('scroll', hideConversationSelectionPopover);

if (!window.__notasEditorSelectionBound) {
  window.__notasEditorSelectionBound = true;
  document.addEventListener('selectionchange', () => {
    const live = document.getElementById('editor');
    const peer = document.getElementById('note-split-peer-body');
    if (typeof syncSelectedNoteImageState === 'function') {
      if (live) syncSelectedNoteImageState(live);
      if (peer) syncSelectedNoteImageState(peer);
    }
    if (typeof scheduleConversationSelectionPopover === 'function') scheduleConversationSelectionPopover();
  });
}

root.addEventListener('pointerdown', e => runEditorOperationOnRoot(root, () => {

  const imageResizeHandle = e.target.closest?.('[data-note-image-resize]');
  if (imageResizeHandle && root.contains(imageResizeHandle)) {
    startNoteImageResize(e, imageResizeHandle);
    return;
  }
  const imageDragHandle = e.target.closest?.('[data-note-image-drag]');
  if (imageDragHandle && root.contains(imageDragHandle)) {
    const imageBlock = imageDragHandle.closest?.('.note-image-block');
    if (imageBlock && typeof startEditorBlockDrag === 'function') startEditorBlockDrag(e, imageBlock);
    return;
  }
  const tableDragHandle = e.target.closest?.('[data-editor-block-drag="table"]');
  if (tableDragHandle && root.contains(tableDragHandle)) {
    const tableWrap = tableDragHandle.closest?.('.note-table-wrap');
    if (tableWrap && typeof startEditorBlockDrag === 'function') startEditorBlockDrag(e, tableWrap);
    return;
  }
  const reorderHandle = e.target.closest?.('[data-table-reorder]');
  if (reorderHandle && root.contains(reorderHandle)) {
    startTableReorder(e, reorderHandle);
    return;
  }
  const resizeHandle = e.target.closest?.('[data-table-resize]');
  if (!resizeHandle || !root.contains(resizeHandle)) return;
  startTableColumnResize(e, resizeHandle);

  }));

root.addEventListener('mousedown', e => runEditorOperationOnRoot(root, () => {

  const tableBtn = e.target.closest('[data-table-action]');
  if (!tableBtn || !root.contains(tableBtn)) return;
  e.preventDefault();
  e.stopPropagation();
  handleTableControl(tableBtn);

  }));

root.addEventListener('contextmenu', e => runEditorOperationOnRoot(root, () => {

  const imageBlock = e.target.closest?.('.note-image-block');
  if (!imageBlock || !root.contains(imageBlock) || typeof selectNoteImageBlock !== 'function') return;
  if (!selectNoteImageBlock(imageBlock)) return;
  e.preventDefault();
  e.stopPropagation();
  const editable = !!noteId() && canEditNote(notes[noteId()]);
  if (window.desktop?.isElectron && typeof window.desktop.showEditorImageContextMenu === 'function') {
    window.desktop.showEditorImageContextMenu({ x: e.clientX, y: e.clientY, editable });
    return;
  }
  if (typeof openCtxMenu !== 'function') return;
  const items = [];
  if (editable) {
    items.push({ label: 'Cut', icon: 'fa-solid fa-scissors', action: () => runNoteImageClipboardCommand('cut') });
  }
  items.push({ label: 'Copy', icon: 'fa-regular fa-copy', action: () => runNoteImageClipboardCommand('copy') });
  openCtxMenu(imageBlock, items, { x: e.clientX, y: e.clientY });

  }));

root.addEventListener('click', e => runEditorOperationOnRoot(root, () => {

  const imageResizeHandle = e.target.closest?.('[data-note-image-resize]');
  if (imageResizeHandle && root.contains(imageResizeHandle)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const imageDragHandle = e.target.closest?.('[data-note-image-drag]');
  if (imageDragHandle && root.contains(imageDragHandle)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const tableDragHandle = e.target.closest?.('[data-editor-block-drag="table"]');
  if (tableDragHandle && root.contains(tableDragHandle)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const reorderHandle = e.target.closest?.('[data-table-reorder]');
  if (reorderHandle && root.contains(reorderHandle)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const tableBtn = e.target.closest('[data-table-action]');
  if (tableBtn && root.contains(tableBtn)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const imageBlock = e.target.closest?.('.note-image-block');
  if (imageBlock && root.contains(imageBlock) && typeof selectNoteImageBlock === 'function') {
    if (e.target.closest?.('[data-note-image-resize], [data-note-image-drag]')) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = imageBlock.getBoundingClientRect();
    const placeAfter = e.clientX >= rect.right - 16;
    if (placeAfter && typeof placeCaretAfterNoteImage === 'function') {
      placeCaretAfterNoteImage(imageBlock);
      return;
    }
    selectNoteImageBlock(imageBlock);
    return;
  }
  if (typeof clearSelectedNoteImages === 'function') clearSelectedNoteImages(root);
  const li = e.target.closest('ul.checklist > li');
  if (li && root.contains(li)) {
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
      scheduleEditorRootUndoSnapshot(root);
      if (syncEditorRootContent(root)) scheduleEditorRootSave(root);
      return;
    }
  }
  const heading = e.target.closest('h1, h2, h3, h4');
  if (heading && root.contains(heading)) {
    const rect = heading.getBoundingClientRect();
    if (e.clientX - rect.left < 20) {
      e.preventDefault();
      heading.toggleAttribute('data-collapsed');
      recomputeCollapsedSections(root);
      saveCollapsedState(noteId(), root);
      return;
    }
  }
  const alarmMark = e.target.closest('.note-alarm');
  if (alarmMark && root.contains(alarmMark)) {
    const rect = alarmMark.getBoundingClientRect();
    if (e.clientX - rect.left <= 24 && canEditNote(notes[noteId()])) {
      e.preventDefault();
      e.stopPropagation();
      selectAlarmMarkText(alarmMark);
      openNoteAlarmModal(noteId());
      return;
    }
  }
  const conversationMark = e.target.closest('.note-conversation-anchor');
  if (conversationMark && root.contains(conversationMark) && typeof openConversationFromMarker === 'function') {
    e.preventDefault();
    e.stopPropagation();
    openConversationFromMarker(conversationMark);
    return;
  }
  const link = e.target.closest('a[href]');
  if (!link) return;
  e.preventDefault();
  window.open(link.href, '_blank', 'noopener,noreferrer');

  }));

root.addEventListener('keydown', e => runEditorOperationOnRoot(root, () => {

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
  const selectedImage = typeof selectedNoteImageBlock === 'function' ? selectedNoteImageBlock() : null;

  if (selectedImage && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      placeCaretAfterNoteImage(selectedImage);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      placeCaretBeforeNoteImage(selectedImage);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key.length === 1) {
      // Move caret after the image so typing/paste does not replace it.
      placeCaretAfterNoteImage(selectedImage);
    }
  } else if (plainArrowKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
    && typeof moveCaretPastAdjacentNoteImage === 'function'
    && moveCaretPastAdjacentNoteImage(e.key)) {
    e.preventDefault();
    return;
  }

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
      refreshEmpty(root);
      scheduleEditorRootUndoSnapshot(root);
      if (syncEditorRootContent(root)) scheduleEditorRootSave(root);
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
      refreshEmpty(root);
      scheduleEditorRootUndoSnapshot(root);
      if (syncEditorRootContent(root)) scheduleEditorRootSave(root);
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
        if (removeEmptyListItem(li)) root.dispatchEvent(new Event('input'));
        return;
      }

      const list = li?.parentElement;
      const firstRegularListItem = li &&
        /^(UL|OL)$/.test(list?.tagName || '') &&
        !list.classList.contains('checklist') &&
        list.parentElement === root &&
        !li.previousElementSibling;
      if (firstRegularListItem && isCaretAtStartOfListItem(li)) {
        e.preventDefault();
        pushUndo();
        if (unlistLeadingListItem(li)) root.dispatchEvent(new Event('input'));
        return;
      }

      if (deletePreviousTabAtCaret()) {
        e.preventDefault();
        root.dispatchEvent(new Event('input'));
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
          if (syncEditorRootContent(root)) {
            scheduleEditorRootUndoSnapshot(root);
            scheduleEditorRootSave(root);
          }
          return;
        }
      }
    }
  }

  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    if (closestInlineCodeFromSelection()) {
      e.preventDefault();
      pushUndo();
      if (splitInlineCodeAtCaret()) {
        _capitalizeNext = true;
        root.dispatchEvent(new Event('input'));
      }
      return;
    }
    if (inTable) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      root.dispatchEvent(new Event('input'));
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
          root.appendChild(p);
        }
        const r = document.createRange();
        r.setStart(p, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        root.dispatchEvent(new Event('input'));
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
      normalizeChecklistStructure(root);

      const r = document.createRange();
      r.selectNodeContents(newLi);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      _capitalizeNext = true;
      root.dispatchEvent(new Event('input'));
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
      root.dispatchEvent(new Event('input'));
      return;
    }
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (inTable) {
      if (moveTableSelection(e.shiftKey ? -1 : 1)) root.dispatchEvent(new Event('input'));
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
    scheduleEditorRootUndoSnapshot(root);
    return;
  }

  }));

root.addEventListener('copy', e => runEditorOperationOnRoot(root, () => {

  if (typeof copySelectedNoteImage === 'function' && copySelectedNoteImage(e.clipboardData)) {
    e.preventDefault();
    return;
  }
  if (typeof copyCollapsedHeaderSelection === 'function' && copyCollapsedHeaderSelection(e.clipboardData)) {
    e.preventDefault();
  }

  }));

root.addEventListener('cut', e => runEditorOperationOnRoot(root, () => {

  if (typeof cutSelectedNoteImage === 'function' && cutSelectedNoteImage(e.clipboardData)) {
    e.preventDefault();
    return;
  }
  if (typeof cutCollapsedHeaderSelection === 'function' && cutCollapsedHeaderSelection(e.clipboardData)) {
    e.preventDefault();
  }

  }));

root.addEventListener('paste', e => runEditorOperationOnRoot(root, () => {

  const pasteNoteId = noteId();
  if (!pasteNoteId || !canEditNote(notes[pasteNoteId])) {
    e.preventDefault();
    return;
  }
  if (typeof shouldBlockSelectedNoteImageReplacement === 'function' && shouldBlockSelectedNoteImageReplacement()) {
    e.preventDefault();
    return;
  }
  const imageFile = clipboardImageFile(e.clipboardData);
  if (imageFile) {
    e.preventDefault();
    if (typeof collapseSelectionAfterSelectedNoteImage === 'function') {
      collapseSelectionAfterSelectedNoteImage();
    }
    const range = getEditorSelectionRange()?.cloneRange();
    const pastedNoteId = pasteNoteId;
    pushUndo();
    insertPastedImageFile(imageFile, range, pastedNoteId).then(ok => {
      if (!ok) scheduleEditorRootUndoSnapshot(root);
    });
    return;
  }
  e.preventDefault();
  pushUndo();
  if (typeof collapseSelectionAfterSelectedNoteImage === 'function') {
    collapseSelectionAfterSelectedNoteImage();
  }
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  const pastedHref = normalizeHttpUrlValue(text);
  if (pastedHref && applyLinkToSelection(pastedHref)) {
    root.dispatchEvent(new Event('input'));
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
    root.dispatchEvent(new Event('input'));
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
  root.dispatchEvent(new Event('input'));

  }));


  return true;
}
