/* Durable drafts for the WebKit workspace. Live saves still use the normal renderer path. */
window.desktopDrafts = (() => {
  const session = crypto.randomUUID();
  const launch = new URLSearchParams(location.search).get('desktopLaunch');
  const project = firebaseConfig.projectId;
  const pending = new Map();
  let database;
  let retryTimer;
  let recovering = false;

  function access(mode, operation) {
    database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('notas-desktop-drafts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      database = null;
      throw error;
    });
    return database.then(db => new Promise((resolve, reject) => {
      const tx = mode === 'readwrite'
        ? db.transaction('drafts', mode, { durability: 'strict' })
        : db.transaction('drafts', mode);
      const request = operation(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('Local draft storage was interrupted.'));
    }));
  }

  function version(timestamp) {
    return timestamp && Number.isInteger(timestamp.seconds) && Number.isInteger(timestamp.nanoseconds)
      ? `${timestamp.seconds}:${timestamp.nanoseconds}`
      : null;
  }

  function track(note) {
    const uid = auth.currentUser?.uid;
    if (!uid || uid !== userId || !canEditNote(note) || isTrashedNote(note)) return null;
    const key = `${session}:${uid}:${note.id}`;
    const previous = pending.get(key);
    const draft = {
      key, launch, project, uid, id: note.id,
      owner: note.owner || uid,
      title: note.title || 'Untitled Note',
      content: note._bodyLoaded ? String(note.content || '') : null,
      metadataVersion: previous ? previous.metadataVersion : note._draftMetadataVersion,
      bodyVersion: previous?.content != null ? previous.bodyVersion : note._draftBodyVersion
    };
    if (previous?.title === draft.title && previous.content === draft.content) return previous;
    pending.set(key, draft);
    return draft;
  }

  function persist(draft) {
    if (!draft || pending.get(draft.key) !== draft) return;
    return access('readwrite', store => store.put(draft));
  }

  async function saved(draft) {
    if (!draft || pending.get(draft.key) !== draft) return;
    pending.delete(draft.key);
    await access('readwrite', store => store.delete(draft.key));
  }

  async function checkpoint() {
    let entries;
    do {
      entries = [...pending.values()];
      await Promise.all(entries.map(persist));
    } while ([...pending.values()].some(draft => !entries.includes(draft)));
    return true;
  }

  async function replay(draft) {
    const metadata = doc(fsDb, 'notes', draft.id);
    const body = noteBodyDocRef(draft.id);
    return runTransaction(fsDb, async transaction => {
      if (auth.currentUser?.uid !== draft.uid) return false;
      const note = (await transaction.get(metadata)).data();
      if (!note || note.owner !== draft.owner || note.deletedAt) return false;
      const bodyData = draft.content === null ? null : (await transaction.get(body)).data();
      const storedContent = bodyData?.content ?? note.content ?? '';
      const metadataVersion = version(note.modified);
      const bodyVersion = bodyData ? version(bodyData.modified) ?? undefined : null;
      const bodyMatches = draft.content === null || storedContent === draft.content;
      // The normal saver writes the body first. Matching HTML alone does not confirm its metadata was saved.
      const bodyOnlySave = draft.content !== null && bodyMatches && metadataVersion === draft.metadataVersion &&
        bodyVersion !== draft.bodyVersion;
      if (note.title === draft.title && bodyMatches && !bodyOnlySave) return true;
      if (!draft.metadataVersion || metadataVersion !== draft.metadataVersion ||
          (!bodyMatches && (draft.bodyVersion === undefined || bodyVersion !== draft.bodyVersion))) return false;
      if (auth.currentUser?.uid !== draft.uid || userId !== draft.uid || hasPending(draft.id)) return false;

      const payload = { title: draft.title, modified: serverTimestamp() };
      if (draft.content !== null) {
        transaction.set(body, noteBodyPayload(draft, draft.content), { merge: true });
        if (note.owner === draft.uid) Object.assign(payload, noteContentMetadataPayload(draft.content));
        if (typeof note.content === 'string') payload.content = deleteField();
      }
      transaction.update(metadata, payload);
      return true;
    });
  }

  function hasPending(id) {
    return pending.has(`${session}:${auth.currentUser?.uid}:${id}`);
  }

  async function recover(uid) {
    if (!uid || recovering || auth.currentUser?.uid !== uid) return;
    recovering = true;
    clearTimeout(retryTimer);
    let retry = false;
    let retained = false;
    try {
      if (!(await window.desktop.getWindowContext()).isPrimary) return;
      const drafts = await access('readonly', store => store.getAll());
      const current = drafts.filter(draft => draft.project === project && draft.uid === uid);
      const counts = new Map();
      for (const draft of current) counts.set(draft.id, (counts.get(draft.id) || 0) + 1);
      for (const draft of current.filter(draft => draft.launch !== launch)) {
        if (auth.currentUser?.uid !== uid) break;
        if (counts.get(draft.id) > 1) {
          retained = true;
          continue;
        }
        try {
          if (await replay(draft)) await access('readwrite', store => store.delete(draft.key));
          else retained = true;
        } catch (error) {
          console.warn('Recover local draft:', error);
          if (['unavailable', 'deadline-exceeded', 'aborted', 'unauthenticated'].includes(error.code)) retry = true;
          else retained = true;
        }
      }
      if (retained) showToast('Local Drafts Need Review — Open Settings To Copy Them', 'error');
    } catch (error) {
      console.error('Read local drafts:', error);
      showToast('Could Not Read Local Drafts', 'error');
    } finally {
      recovering = false;
      const activeUid = auth.currentUser?.uid;
      if (activeUid && activeUid !== uid) void recover(activeUid);
      else if (retry && activeUid === uid) retryTimer = setTimeout(() => recover(uid), 30_000);
    }
  }

  window.addEventListener('online', () => recover(auth.currentUser?.uid));
  document.getElementById('local-drafts-row').style.display = '';
  document.getElementById('copy-local-drafts-btn').addEventListener('click', async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const text = access('readonly', store => store.getAll()).then(drafts => {
        if (auth.currentUser?.uid !== uid) throw new Error('The active account changed.');
        return new Blob([JSON.stringify(drafts.filter(draft => draft.project === project && draft.uid === uid)
          .map(({ title, content }) => ({ title, html: content })), null, 2)], { type: 'text/plain' });
      });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]);
      showToast('Local Drafts Copied', 'success');
    } catch (error) {
      console.error('Copy local drafts:', error);
      showToast('Could Not Copy Local Drafts', 'error');
    }
  });

  return { version, track, persist, saved, checkpoint, recover, hasPending };
})();
