/* Profiles, sharing, notifications, shared-note library, and shared URL handling. */
function renderProfileConnectionUI(options = {}) {
  const list = document.getElementById(options.listId || 'linked-profiles-list');
  if (!list) return;
  renderProfileLinkRequestsUI({
    panelId: options.requestsPanelId || 'profile-link-requests-panel',
    listId: options.requestsListId || 'profile-link-requests-list'
  });

  const profiles = friendArray();
  if (!profiles.length) {
    list.innerHTML = '<div class="profile-empty">Search for another Notas user by exact email to add them as a friend.</div>';
    return;
  }

  list.innerHTML = profiles.map(p =>
    '<div class="profile-row">' +
      renderProfileAvatar(p) +
      '<div class="profile-main"><div class="profile-name">' + esc(p.displayName) + '</div><div class="profile-sub">' + esc(p.email || 'Friend') + '</div></div>' +
    '</div>'
  ).join('');
}

function renderProfileLinkRequestsUI(options = {}) {
  const panel = document.getElementById(options.panelId || 'profile-link-requests-panel');
  const list = document.getElementById(options.listId || 'profile-link-requests-list');
  if (!panel || !list) return;
  const requests = Object.values(incomingFriendRequests)
    .filter(request => request.status === 'pending')
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  panel.hidden = !requests.length;
  if (!requests.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = requests.map(request => {
    const profile = profileFromFriendRequest(request) || { displayName: 'Notas User', email: '', photoURL: '' };
    return '<div class="profile-row">' +
      renderProfileAvatar(profile) +
      '<div class="profile-main"><div class="profile-name">' + esc(profile.displayName || 'Notas User') + '</div><div class="profile-sub">' + esc(profile.email || 'Incoming friend request') + '</div></div>' +
      '<div class="profile-link-actions">' +
        '<button class="modal-btn" data-deny-friend-request="' + esc(request.id) + '" type="button">Reject</button>' +
        '<button class="modal-btn primary" data-accept-friend-request="' + esc(request.id) + '" type="button">Accept</button>' +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('[data-accept-friend-request]').forEach(btn => {
    btn.addEventListener('click', () => acceptFriendRequest(incomingFriendRequests[btn.dataset.acceptFriendRequest]));
  });
  list.querySelectorAll('[data-deny-friend-request]').forEach(btn => {
    btn.addEventListener('click', () => rejectFriendRequest(incomingFriendRequests[btn.dataset.denyFriendRequest]));
  });
}

function profileLinkRequestDocId(fromUid, targetKey) {
  return ('profile_link_' + fromUid + '_' + targetKey).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
}

function currentProfileLinkPayload() {
  const photos = profilePhotoFields(currentProfile?.photoURL, currentProfile?.photoURLCandidates, photoCandidatesFromUser(auth.currentUser));
  return {
    uid: userId,
    displayName: currentProfile?.displayName || auth.currentUser?.displayName || 'Notas User',
    email: normalizeEmail(currentProfile?.email || auth.currentUser?.email || ''),
    photoURL: photos.photoURL,
    photoURLCandidates: photos.photoURLCandidates,
    linkedAt: new Date().toISOString(),
    emailOnly: false
  };
}

function isoFromTimestamp(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function normalizeUserProfile(uid, data = {}) {
  const email = normalizeEmail(data.email || data.emailLower || '');
  const photos = profilePhotoFields(data.photoURL, data.photoURLCandidates);
  return {
    uid: data.uid || uid || '',
    displayName: data.displayName || (email ? email.split('@')[0] : 'Notas User'),
    email,
    emailLower: normalizeEmail(data.emailLower || email),
    photoURL: photos.photoURL,
    photoURLCandidates: photos.photoURLCandidates
  };
}

function friendDocPayload(profile) {
  const normalized = normalizeUserProfile(profile?.uid, profile || {});
  return {
    uid: normalized.uid,
    displayName: normalized.displayName || '',
    email: normalized.email || '',
    emailLower: normalized.emailLower || normalizeEmail(normalized.email || ''),
    photoURL: normalized.photoURL || '',
    photoURLCandidates: normalized.photoURLCandidates || [],
    created: serverTimestamp()
  };
}

function currentFriendProfile() {
  const profile = currentProfileLinkPayload();
  return {
    uid: userId,
    displayName: profile.displayName || '',
    email: profile.email || '',
    emailLower: normalizeEmail(profile.email || ''),
    photoURL: profile.photoURL || '',
    photoURLCandidates: profile.photoURLCandidates || []
  };
}

function friendArray() {
  return Object.values(friends).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

function friendRequestDocId(fromUid, toUid) {
  return (fromUid + '_' + toUid).replace(/[^A-Za-z0-9_-]/g, '_');
}

function normalizeFriendRequest(id, data = {}) {
  const fromPhotos = profilePhotoFields(data.fromPhotoURL, data.fromPhotoURLCandidates);
  const toPhotos = profilePhotoFields(data.toPhotoURL, data.toPhotoURLCandidates);
  return {
    id,
    fromUid: data.fromUid || '',
    toUid: data.toUid || '',
    fromEmail: normalizeEmail(data.fromEmail || ''),
    toEmail: normalizeEmail(data.toEmail || ''),
    fromDisplayName: data.fromDisplayName || data.fromName || 'Notas User',
    toDisplayName: data.toDisplayName || data.toName || 'Notas User',
    fromPhotoURL: fromPhotos.photoURL,
    fromPhotoURLCandidates: fromPhotos.photoURLCandidates,
    toPhotoURL: toPhotos.photoURL,
    toPhotoURLCandidates: toPhotos.photoURLCandidates,
    status: data.status || 'pending',
    created: isoFromTimestamp(data.created) || data.createdIso || new Date().toISOString(),
    modified: isoFromTimestamp(data.modified) || data.modifiedIso || isoFromTimestamp(data.created) || data.createdIso || new Date().toISOString(),
    type: 'friend_request',
    readKey: 'friend_request_' + id
  };
}

function profileFromFriendRequest(request) {
  if (!request) return null;
  return normalizeUserProfile(request.fromUid, {
    uid: request.fromUid,
    displayName: request.fromDisplayName,
    email: request.fromEmail,
    emailLower: request.fromEmail,
    photoURL: request.fromPhotoURL,
    photoURLCandidates: request.fromPhotoURLCandidates
  });
}

function profileToFriendRequest(request) {
  if (!request) return null;
  return normalizeUserProfile(request.toUid, {
    uid: request.toUid,
    displayName: request.toDisplayName,
    email: request.toEmail,
    emailLower: request.toEmail,
    photoURL: request.toPhotoURL,
    photoURLCandidates: request.toPhotoURLCandidates
  });
}

function friendRequestSortTime(request) {
  const date = new Date(request?.modified || request?.created || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function newestFriendRequest(requests) {
  return requests
    .filter(Boolean)
    .sort((a, b) => friendRequestSortTime(b) - friendRequestSortTime(a))[0] || null;
}

function incomingFriendRequestFrom(fromUid, statuses = []) {
  return newestFriendRequest(Object.values(incomingFriendRequests).filter(request =>
    request.fromUid === fromUid && (!statuses.length || statuses.includes(request.status))
  ));
}

async function loadFriendRequestsForCurrentUser(fieldName) {
  if (!userId || !['fromUid', 'toUid'].includes(fieldName)) return [];
  const snap = await getDocs(query(collection(fsDb, 'friendRequests'), where(fieldName, '==', userId)));
  return snap.docs.map(requestSnap => normalizeFriendRequest(requestSnap.id, requestSnap.data() || {}));
}

async function findSentFriendRequestTo(toUid, statuses = []) {
  return newestFriendRequest(await findSentFriendRequestsTo(toUid, statuses));
}

async function findSentFriendRequestsTo(toUid, statuses = []) {
  const byId = {};
  Object.values(sentFriendRequests).forEach(request => {
    if (request.toUid === toUid && (!statuses.length || statuses.includes(request.status))) byId[request.id] = request;
  });
  (await loadFriendRequestsForCurrentUser('fromUid')).forEach(request => {
    if (request.toUid === toUid && (!statuses.length || statuses.includes(request.status))) byId[request.id] = request;
  });
  return Object.values(byId).sort((a, b) => friendRequestSortTime(b) - friendRequestSortTime(a));
}

async function findIncomingFriendRequestFrom(fromUid, statuses = []) {
  return incomingFriendRequestFrom(fromUid, statuses) || newestFriendRequest(
    (await loadFriendRequestsForCurrentUser('toUid')).filter(request =>
      request.fromUid === fromUid && (!statuses.length || statuses.includes(request.status))
    )
  );
}

async function deleteFriendRequestDocument(request) {
  if (!request?.id) return false;
  await deleteDoc(doc(fsDb, 'friendRequests', request.id));
  delete sentFriendRequests[request.id];
  delete incomingFriendRequests[request.id];
  return true;
}

async function findUserByExactEmail(email) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return null;
  const snap = await getDocs(query(collection(fsDb, 'users'), where('emailLower', '==', emailLower), limit(1)));
  if (snap.empty) return null;
  const userSnap = snap.docs[0];
  return normalizeUserProfile(userSnap.id, userSnap.data() || {});
}

async function sendFriendRequest(toUser) {
  if (!userId || !toUser?.uid) return false;
  if (toUser.uid === userId || normalizeEmail(toUser.email) === normalizeEmail(currentProfile?.email)) {
    showToast('You Cannot Add Yourself', 'error');
    return false;
  }
  if (friends[toUser.uid]) {
    showToast('Already Friends', 'success');
    return true;
  }

  if (_sendingFriendRequests.has(toUser.uid)) {
    showToast('Friend Request Already Sending', 'success');
    return true;
  }

  _sendingFriendRequests.add(toUser.uid);
  try {
    const [existing, reverse, rejectedRequests] = await Promise.all([
      findSentFriendRequestTo(toUser.uid, ['pending', 'accepted']),
      findIncomingFriendRequestFrom(toUser.uid, ['pending']),
      findSentFriendRequestsTo(toUser.uid, ['rejected'])
    ]);

    if (existing?.status === 'pending') {
      showToast('Friend Request Already Sent', 'success');
      return true;
    }
    if (existing?.status === 'accepted') {
      await completeAcceptedFriendRequest(existing);
      showToast('Already Friends', 'success');
      return true;
    }
    if (reverse?.status === 'pending') {
      showToast('They Already Sent You A Request', 'success');
      refreshOpenSidebarPage('friends');
      return true;
    }
    for (const rejected of rejectedRequests) {
      await deleteFriendRequestDocument(rejected);
    }

    const sender = currentFriendProfile();
    const target = normalizeUserProfile(toUser.uid, toUser);
    const requestId = friendRequestDocId(userId, target.uid);
    const nowIso = new Date().toISOString();
    const payload = {
      fromUid: userId,
      toUid: target.uid,
      fromEmail: sender.email || '',
      toEmail: target.email || '',
      fromDisplayName: sender.displayName || '',
      toDisplayName: target.displayName || '',
      fromPhotoURL: sender.photoURL || '',
      fromPhotoURLCandidates: sender.photoURLCandidates || [],
      toPhotoURL: target.photoURL || '',
      toPhotoURLCandidates: target.photoURLCandidates || [],
      status: 'pending',
      createdIso: nowIso,
      modifiedIso: nowIso,
      created: serverTimestamp(),
      modified: serverTimestamp()
    };

    try {
      await setDoc(doc(fsDb, 'friendRequests', requestId), payload);
    } catch (err) {
      const existingAfterFailure = await findSentFriendRequestTo(toUser.uid, ['pending', 'accepted']).catch(() => null);
      if (existingAfterFailure?.status === 'pending') {
        showToast('Friend Request Already Sent', 'success');
        return true;
      }
      if (existingAfterFailure?.status === 'accepted') {
        await completeAcceptedFriendRequest(existingAfterFailure);
        showToast('Already Friends', 'success');
        return true;
      }
      throw err;
    }

    sentFriendRequests[requestId] = normalizeFriendRequest(requestId, payload);
    showToast('Friend Request Sent', 'success');
    return true;
  } finally {
    _sendingFriendRequests.delete(toUser.uid);
  }
}

async function acceptFriendRequest(request) {
  if (!request?.id || request.toUid !== userId) return false;
  const requester = profileFromFriendRequest(request);
  const batch = writeBatch(fsDb);
  batch.update(doc(fsDb, 'friendRequests', request.id), {
    status: 'accepted',
    modifiedIso: new Date().toISOString(),
    modified: serverTimestamp()
  });
  batch.set(doc(fsDb, 'users', userId, 'friends', requester.uid), friendDocPayload(requester), { merge: true });
  await batch.commit();
  friends[requester.uid] = normalizeUserProfile(requester.uid, requester);
  delete incomingFriendRequests[request.id];
  renderProfileConnectionUI();
  renderShareProfileList();
  renderNotificationButton();
  refreshOpenSidebarPage('friends');
  refreshOpenSidebarPage('notifications');
  showToast('Friend Added', 'success');
  return true;
}

async function completeAcceptedFriendRequest(request) {
  if (!request?.id || request.fromUid !== userId || request.status !== 'accepted') return false;
  if (_processingAcceptedFriendRequests.has(request.id)) return false;
  const friend = profileToFriendRequest(request);
  if (!friend?.uid || friend.uid === userId) return false;

  _processingAcceptedFriendRequests.add(request.id);
  try {
    await setDoc(doc(fsDb, 'users', userId, 'friends', friend.uid), friendDocPayload(friend), { merge: true });
    friends[friend.uid] = normalizeUserProfile(friend.uid, friend);
    try {
      await deleteFriendRequestDocument(request);
    } catch (err) {
      console.warn('delete accepted friend request:', err);
    }
    renderProfileConnectionUI();
    renderShareProfileList();
    refreshOpenSidebarPage('friends');
    renderSidebar();
    return true;
  } finally {
    _processingAcceptedFriendRequests.delete(request.id);
  }
}

async function rejectFriendRequest(request) {
  if (!request?.id || request.toUid !== userId) return false;
  await updateDoc(doc(fsDb, 'friendRequests', request.id), {
    status: 'rejected',
    modifiedIso: new Date().toISOString(),
    modified: serverTimestamp()
  });
  delete incomingFriendRequests[request.id];
  renderProfileLinkRequestsUI();
  renderNotificationButton();
  refreshOpenSidebarPage('friends');
  refreshOpenSidebarPage('notifications');
  showToast('Friend Request Rejected', 'success');
  return true;
}

function listenFriends() {
  if (unsubFriends) unsubFriends();
  if (!userId) return;
  friends = {};
  unsubFriends = onSnapshot(collection(fsDb, 'users', userId, 'friends'), snap => {
    friends = {};
    snap.forEach(friendSnap => {
      const friend = normalizeUserProfile(friendSnap.id, friendSnap.data() || {});
      if (friend.uid && friend.uid !== userId) friends[friend.uid] = friend;
    });
    linkedProfiles = mergeLinkedProfileMaps(_readLinkedProfilesFromLocal(), linkedProfiles, friends);
    renderProfileConnectionUI();
    renderShareProfileList();
    refreshOpenSidebarPage('friends');
    renderSidebar();
  }, err => {
    console.warn('friends listener:', err);
    showToast('Could Not Load Friends', 'error');
  });
}

function listenIncomingFriendRequests() {
  if (unsubIncomingFriendRequests) unsubIncomingFriendRequests();
  if (!userId) return;
  incomingFriendRequests = {};
  const q = query(collection(fsDb, 'friendRequests'), where('toUid', '==', userId));
  unsubIncomingFriendRequests = onSnapshot(q, snap => {
    incomingFriendRequests = {};
    snap.forEach(requestSnap => {
      const request = normalizeFriendRequest(requestSnap.id, requestSnap.data() || {});
      if (request.status === 'pending' && request.fromUid && request.fromUid !== userId) incomingFriendRequests[request.id] = request;
    });
    renderProfileLinkRequestsUI();
    renderNotificationButton();
    refreshOpenSidebarPage('friends');
    refreshOpenSidebarPage('notifications');
  }, err => {
    console.warn('friend requests listener:', err);
  });
}

function listenSentFriendRequests() {
  if (unsubSentFriendRequests) unsubSentFriendRequests();
  if (!userId) return;
  sentFriendRequests = {};
  const q = query(collection(fsDb, 'friendRequests'), where('fromUid', '==', userId));
  unsubSentFriendRequests = onSnapshot(q, snap => {
    sentFriendRequests = {};
    const accepted = [];
    const rejected = [];
    snap.forEach(requestSnap => {
      const request = normalizeFriendRequest(requestSnap.id, requestSnap.data() || {});
      if (!request.toUid || request.toUid === userId) return;
      sentFriendRequests[request.id] = request;
      if (request.status === 'accepted') accepted.push(request);
      if (request.status === 'rejected') rejected.push(request);
    });
    accepted.forEach(request => {
      completeAcceptedFriendRequest(request).catch(err => {
        console.warn('complete accepted friend request:', err);
      });
    });
    rejected.forEach(request => {
      deleteFriendRequestDocument(request).catch(err => {
        console.warn('delete rejected friend request:', err);
      });
    });
  }, err => {
    console.warn('sent friend requests listener:', err);
  });
}

function profileFromProfileLinkRequest(request) {
  if (!request) return null;
  return normalizeLinkedProfile(request.fromUid, {
    uid: request.fromUid,
    displayName: request.fromName || (request.fromEmail ? request.fromEmail.split('@')[0] : 'Linked Profile'),
    email: request.fromEmail || '',
    photoURL: request.fromPhotoURL || '',
    photoURLCandidates: request.fromPhotoURLCandidates || [],
    linkedAt: new Date().toISOString(),
    emailOnly: false
  });
}

function profileMatchesLink(a, b) {
  const emailA = normalizeEmail(a?.email || '');
  const emailB = normalizeEmail(b?.email || '');
  if (a?.uid && b?.uid && a.uid === b.uid) return true;
  return !!(emailA && emailB && emailA === emailB);
}

function linkedProfileAliasKeys(profile) {
  return Object.keys(linkedProfiles).filter(key => {
    const existing = linkedProfiles[key];
    return key === profile?.uid || profileMatchesLink(existing, profile);
  });
}

function openProfileLinkApproval(profileOrRequest) {
  const modal = document.getElementById('profile-link-modal');
  const preview = document.getElementById('profile-link-preview');
  const note = document.getElementById('profile-link-note');
  if (!modal || !preview) return;
  const request = profileOrRequest?.type === 'profile_link' ? profileOrRequest : null;
  const profile = request ? profileFromProfileLinkRequest(request) : normalizeLinkedProfile(profileOrRequest?.uid, profileOrRequest);
  if (!profile) return;
  _pendingProfileLink = { profile, request };
  preview.innerHTML =
    renderProfileAvatar(profile) +
    '<div class="profile-main"><div class="profile-name">' + esc(profile.displayName || 'Linked Profile') + '</div><div class="profile-sub">' + esc(profile.email || 'Notas profile') + '</div></div>';
  if (note) {
    note.textContent = request
      ? 'Approve to link this profile with yours for direct shares and @mentions. Deny cancels the request.'
      : 'Approve to add this profile for direct shares and @mentions. Deny cancels the link.';
  }
  modal.classList.add('open');
}

function closeProfileLinkApproval() {
  document.getElementById('profile-link-modal')?.classList.remove('open');
  _pendingProfileLink = null;
}

async function approvePendingProfileLink() {
  const pending = _pendingProfileLink;
  if (!pending?.profile) return;
  closeProfileLinkApproval();
  if (pending.request) await approveProfileLinkRequest(pending.request);
  else await commitLinkedProfile(pending.profile);
}

async function denyPendingProfileLink() {
  const pending = _pendingProfileLink;
  closeProfileLinkApproval();
  if (pending?.request) await denyProfileLinkRequest(pending.request);
}

async function commitLinkedProfile(profile, options = {}) {
  const input = document.getElementById('connect-profile-email-input');
  const normalized = normalizeLinkedProfile(profile?.uid, profile);
  if (!normalized || normalized.uid === userId || normalizeEmail(normalized.email) === normalizeEmail(currentProfile?.email)) return false;
  const duplicateKeys = linkedProfileAliasKeys(normalized).filter(key => key !== normalized.uid);
  const updates = { [normalized.uid]: normalized };
  duplicateKeys.forEach(key => { updates[key] = deleteField(); });
  Object.keys(linkedProfiles).forEach(key => {
    if (duplicateKeys.includes(key)) delete linkedProfiles[key];
  });
  linkedProfiles[normalized.uid] = normalized;
  _writeLinkedProfilesToLocal();
  if (input && options.clearInput !== false) input.value = '';
  renderProfileConnectionUI();
  renderShareProfileList();
  refreshOpenSidebarPage('friends');
  scheduleLinkedProfileRefresh();

  try {
    await setDoc(_getUserDocRef(), { linkedProfiles: updates }, { merge: true });
    if (options.toast !== false) showToast(options.toast || (normalized.emailOnly ? 'Email Linked' : 'Profile Linked'), 'success');
    return true;
  } catch (err) {
    console.warn('persist linked profile:', err);
    if (options.toast !== false) showToast('Profile linked locally; cloud sync failed', 'error');
    return false;
  }
}

async function sendProfileLinkRequest(profile) {
  const email = normalizeEmail(profile?.email || '');
  const targetKey = profile?.uid || emailProfileKey(email);
  if (!targetKey || !userId) return false;
  const requestId = profileLinkRequestDocId(userId, targetKey);
  const now = new Date().toISOString();
  const sender = currentProfileLinkPayload();
  const payload = {
    id: requestId,
    type: 'profile_link',
    status: 'pending',
    fromUid: sender.uid,
    fromName: sender.displayName,
    fromEmail: sender.email,
    fromPhotoURL: sender.photoURL,
    fromPhotoURLCandidates: sender.photoURLCandidates,
    toUid: profile.emailOnly ? '' : profile.uid,
    toEmail: email,
    toProfileKey: targetKey,
    recipientName: profile.displayName || '',
    recipientPhotoURL: profile.photoURL || '',
    createdIso: now,
    created: serverTimestamp()
  };

  const writes = [];
  if (!profile.emailOnly && profile.uid) writes.push(setDoc(doc(fsDb, 'profileShares', profile.uid, 'items', requestId), payload, { merge: true }));
  if (email) writes.push(setDoc(doc(fsDb, 'profileEmailShares', emailProfileDocId(email), 'items', requestId), payload, { merge: true }));
  if (!writes.length) return false;
  const results = await Promise.allSettled(writes);
  if (results.some(result => result.status === 'rejected')) console.warn('profile link request delivery:', results);
  return results.some(result => result.status === 'fulfilled');
}

async function connectProfileByEmail(inputId = 'connect-profile-email-input') {
  const input = document.getElementById(inputId);
  const email = normalizeEmail(input?.value || '');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Enter A Valid Email', 'error');
    return;
  }
  if (email === normalizeEmail(currentProfile?.email)) {
    showToast('That Is Your Email', 'error');
    return;
  }
  if (Object.values(friends).some(profile => normalizeEmail(profile.email) === email)) {
    showToast('Already Friends', 'success');
    if (input) input.value = '';
    return;
  }

  try {
    const profile = await findUserByExactEmail(email);
    if (!profile) {
      showToast('No Notas User Found For That Email', 'error');
      return;
    }
    const sent = await sendFriendRequest(profile);
    if (input) input.value = '';
    if (sent) refreshOpenSidebarPage('friends');
  } catch (err) {
    console.warn('send friend request:', err);
    showToast('Could Not Send Friend Request', 'error');
  }
}

function removeProfileFromSharedWith(sharedWith, profile) {
  const keys = new Set(profileMatchKeys(profile));
  const profileEmail = normalizeEmail(profile?.email || '');
  const next = {};
  Object.keys(normalizeSharedWith(sharedWith)).forEach(key => {
    const entry = sharedWith[key];
    const entryEmail = normalizeEmail(entry?.email || '');
    const matches = keys.has(key) ||
      (entry?.uid && keys.has(entry.uid)) ||
      (entryEmail && (keys.has(entryEmail) || entryEmail === profileEmail || keys.has(emailProfileKey(entryEmail))));
    if (!matches) next[key] = entry;
  });
  return next;
}

function getProfileAccessLossSummary(profile) {
  const sharedFolders = Object.values(folders)
    .filter(folder => isOwnedFolder(folder) && isFolderSharedWithProfile(folder, profile))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const folderIds = new Set(sharedFolders.map(folder => folder.id));
  const directNotes = Object.values(notes)
    .filter(note => isOwnedNote(note) && isNoteDirectlySharedWithProfile(note, profile))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return {
    folders: sharedFolders.map(folder => ({
      id: folder.id,
      title: folder.title || 'Untitled Folder',
      noteCount: Object.values(notes).filter(note => note.folderId === folder.id && isOwnedNote(note)).length
    })),
    notes: directNotes.map(note => ({
      id: note.id,
      title: note.title || 'Untitled Note',
      viaSharedFolder: !!(note.folderId && folderIds.has(note.folderId))
    }))
  };
}

function profileAccessLossListHtml(summary) {
  const items = [];
  summary.folders.forEach(folder => {
    const count = folder.noteCount ? ' (' + folder.noteCount + ' note' + (folder.noteCount === 1 ? '' : 's') + ')' : '';
    items.push('<div><i class="fa-solid fa-folder"></i><span>Folder: ' + esc(folder.title + count) + '</span></div>');
  });
  summary.notes.forEach(note => {
    const suffix = note.viaSharedFolder ? ' (also in shared folder)' : '';
    items.push('<div><i class="fa-regular fa-note-sticky"></i><span>Note: ' + esc(note.title + suffix) + '</span></div>');
  });
  if (!items.length) return '<div class="delete-loss-list"><div><i class="fa-solid fa-circle-info"></i><span>No notes or folders are currently shared with this profile.</span></div></div>';
  return '<div class="delete-loss-list">' + items.join('') + '</div>';
}

function openRemoveLinkedProfileModal(uid) {
  const profile = linkedProfiles[uid];
  if (!uid || !profile) return;
  const summary = getProfileAccessLossSummary(profile);
  _deletePending = { type: 'profile', id: uid, mode: 'remove-profile' };

  const titleEl = document.getElementById('delete-modal-title');
  const bodyEl = document.getElementById('delete-modal-body');
  const confirmBtn = document.getElementById('delete-modal-confirm');
  titleEl.textContent = 'Remove Linked Profile?';
  bodyEl.className = 'delete-message remove';
  bodyEl.innerHTML =
    '<strong class="delete-target">' + esc(profile.displayName || profile.email || 'Linked Profile') + '</strong>' +
    '<div class="delete-copy">Removing this profile link will revoke their access to these shared items and remove them from direct sharing and @mentions.</div>' +
    profileAccessLossListHtml(summary);
  confirmBtn.innerHTML = '<i class="fa-solid fa-user-minus" style="margin-right:6px;"></i>Remove Profile';
  document.getElementById('delete-modal').classList.add('open');
}

async function commitBatchedWrites(writeFns) {
  for (let i = 0; i < writeFns.length; i += 450) {
    const batch = writeBatch(fsDb);
    writeFns.slice(i, i + 450).forEach(fn => fn(batch));
    await batch.commit();
  }
}

async function removeLinkedProfile(uid) {
  if (!uid || !linkedProfiles[uid]) return;
  const profile = linkedProfiles[uid];
  const removeKeys = linkedProfileAliasKeys(profile);
  const userUpdates = {};
  removeKeys.forEach(key => { userUpdates[key] = deleteField(); });

  const writes = [];
  const noteUpdates = {};
  const folderUpdates = {};

  Object.values(folders).filter(isOwnedFolder).forEach(folder => {
    const nextSharedWith = removeProfileFromSharedWith(folder.sharedWith, profile);
    const currentKeys = Object.keys(normalizeSharedWith(folder.sharedWith));
    const nextKeys = Object.keys(nextSharedWith);
    if (currentKeys.length === nextKeys.length) return;
    const sharedAccessKeys = rebuildSharedAccessKeys(nextSharedWith);
    folderUpdates[folder.id] = { sharedWith: nextSharedWith, sharedAccessKeys };
    writes.push(batch => batch.update(doc(fsDb, 'folders', folder.id), {
      sharedWith: nextKeys.length ? nextSharedWith : deleteField(),
      sharedAccessKeys: sharedAccessKeys.length ? sharedAccessKeys : deleteField(),
      modified: serverTimestamp()
    }));
  });

  Object.values(notes).filter(isOwnedNote).forEach(note => {
    const nextSharedWith = removeProfileFromSharedWith(note.sharedWith, profile);
    const currentKeys = Object.keys(normalizeSharedWith(note.sharedWith));
    const nextKeys = Object.keys(nextSharedWith);
    if (currentKeys.length === nextKeys.length) return;
    const sharedAccessKeys = rebuildSharedAccessKeys(nextSharedWith);
    const publicFolderIds = normalizePublicFolderIds(note.publicFolderIds);
    const nextPublic = computeEffectiveNotePublic({
      ...note,
      sharedWith: nextSharedWith,
      sharedAccessKeys,
      publicFolderIds
    });
    noteUpdates[note.id] = { sharedWith: nextSharedWith, sharedAccessKeys, public: nextPublic, publicFolderIds };
    writes.push(batch => batch.update(doc(fsDb, 'notes', note.id), {
      public: nextPublic,
      sharedWith: nextKeys.length ? nextSharedWith : deleteField(),
      sharedAccessKeys: sharedAccessKeys.length ? sharedAccessKeys : deleteField()
    }));
  });
  writes.push(batch => batch.set(_getUserDocRef(), { linkedProfiles: userUpdates }, { merge: true }));

  try {
    await commitBatchedWrites(writes);
    removeKeys.forEach(key => { delete linkedProfiles[key]; });
    Object.keys(folderUpdates).forEach(id => {
      if (!folders[id]) return;
      folders[id].sharedWith = folderUpdates[id].sharedWith;
      folders[id].sharedAccessKeys = folderUpdates[id].sharedAccessKeys;
    });
    Object.keys(noteUpdates).forEach(id => {
      if (!notes[id]) return;
      notes[id].sharedWith = noteUpdates[id].sharedWith;
      notes[id].sharedAccessKeys = noteUpdates[id].sharedAccessKeys;
      notes[id].public = noteUpdates[id].public;
      notes[id].publicFolderIds = noteUpdates[id].publicFolderIds;
    });
    _writeLinkedProfilesToLocal();
    renderProfileConnectionUI();
    renderShareProfileList();
    renderSidebar();
    refreshOpenSidebarPage('friends');
    showToast('Profile Link Removed', 'success');
  } catch (err) {
    console.error('remove profile:', err);
    showToast('Could Not Remove Profile Link', 'error');
  }
}

function normalizeProfileLinkRequest(id, data) {
  const createdDate = data?.created?.toDate?.();
  const created = createdDate ? createdDate.toISOString() : (data?.createdIso || data?.acceptedIso || new Date().toISOString());
  const photos = profilePhotoFields(data?.fromPhotoURL, data?.fromPhotoURLCandidates);
  const fromEmail = normalizeEmail(data?.fromEmail || '');
  return {
    id,
    type: 'profile_link',
    status: data?.status === 'accepted' ? 'accepted' : (data?.status === 'denied' ? 'denied' : 'pending'),
    fromUid: data?.fromUid || '',
    fromName: data?.fromName || (fromEmail ? fromEmail.split('@')[0] : 'Linked Profile'),
    fromEmail,
    fromPhotoURL: photos.photoURL,
    fromPhotoURLCandidates: photos.photoURLCandidates,
    toUid: data?.toUid || '',
    toEmail: normalizeEmail(data?.toEmail || ''),
    toProfileKey: data?.toProfileKey || '',
    created,
    readKey: 'profile_link_' + id,
    read: false,
    source: 'profile_link'
  };
}

function profileLinkRequestBelongsToCurrentUser(request) {
  const email = normalizeEmail(currentProfile?.email || auth.currentUser?.email || '');
  return !!request && (
    request.toUid === userId ||
    (request.toEmail && request.toEmail === email)
  );
}

function applyProfileLinkRequestSource(sourceKey, id, request) {
  if (!profileLinkRequestSources[id]) profileLinkRequestSources[id] = {};
  profileLinkRequestSources[id][sourceKey] = request;
  const sourceValues = Object.values(profileLinkRequestSources[id]);
  profileLinkRequests[id] = sourceValues.sort((a, b) => new Date(b.created) - new Date(a.created))[0];
}

function removeProfileLinkRequestSource(sourceKey, id) {
  if (!profileLinkRequestSources[id]) return;
  delete profileLinkRequestSources[id][sourceKey];
  const remaining = Object.values(profileLinkRequestSources[id]);
  if (remaining.length) {
    profileLinkRequests[id] = remaining.sort((a, b) => new Date(b.created) - new Date(a.created))[0];
  } else {
    delete profileLinkRequestSources[id];
    delete profileLinkRequests[id];
  }
}

async function deleteProfileLinkRequestCopies(request) {
  if (!request?.id || !userId) return false;
  const email = normalizeEmail(currentProfile?.email || auth.currentUser?.email || request.toEmail || '');
  const deletes = [
    deleteDoc(doc(fsDb, 'profileShares', userId, 'items', request.id))
  ];
  if (email) deletes.push(deleteDoc(doc(fsDb, 'profileEmailShares', emailProfileDocId(email), 'items', request.id)));
  const results = await Promise.allSettled(deletes);
  if (results.some(result => result.status === 'rejected')) console.warn('delete profile link request:', results);
  delete profileLinkRequests[request.id];
  delete profileLinkRequestSources[request.id];
  renderProfileLinkRequestsUI();
  renderNotificationButton();
  if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
  refreshOpenSidebarPage('friends');
  refreshOpenSidebarPage('notifications');
  return results.some(result => result.status === 'fulfilled');
}

async function sendProfileLinkAcceptance(request) {
  if (!request?.fromUid || request.fromUid === userId) return false;
  const profile = currentProfileLinkPayload();
  const now = new Date().toISOString();
  const payload = {
    id: request.id,
    type: 'profile_link',
    status: 'accepted',
    fromUid: profile.uid,
    fromName: profile.displayName,
    fromEmail: profile.email,
    fromPhotoURL: profile.photoURL,
    fromPhotoURLCandidates: profile.photoURLCandidates,
    toUid: request.fromUid,
    toEmail: request.fromEmail,
    acceptedIso: now,
    createdIso: now,
    created: serverTimestamp()
  };
  try {
    await setDoc(doc(fsDb, 'profileShares', request.fromUid, 'items', request.id), payload, { merge: true });
    return true;
  } catch (err) {
    console.warn('send profile link acceptance:', err);
    return false;
  }
}

async function approveProfileLinkRequest(request) {
  if (!request?.id) return;
  const profile = profileFromProfileLinkRequest(request);
  if (!profile) return;
  const linked = await commitLinkedProfile(profile, { clearInput: false, toast: false });
  if (!linked) return;
  const accepted = await sendProfileLinkAcceptance(request);
  if (!accepted) {
    showToast('Profile linked; sender notification failed', 'error');
    return;
  }
  await deleteProfileLinkRequestCopies(request);
  showToast('Profile Linked', 'success');
}

async function denyProfileLinkRequest(request) {
  if (!request?.id) return;
  await deleteProfileLinkRequestCopies(request);
  showToast('Link Request Denied', 'success');
}

async function handleAcceptedProfileLinkRequest(request) {
  if (!request?.id || _processingProfileLinkResponses.has(request.id)) return;
  _processingProfileLinkResponses.add(request.id);
  try {
    const profile = profileFromProfileLinkRequest(request);
    if (!profile) return;
    const linked = await commitLinkedProfile(profile, { clearInput: false, toast: 'Profile Link Accepted' });
    if (linked) await deleteProfileLinkRequestCopies(request);
  } finally {
    _processingProfileLinkResponses.delete(request.id);
  }
}

function listenToProfileLinkRequests() {
  if (unsubProfileLinkRequests) unsubProfileLinkRequests();
  if (!userId) return;
  profileLinkRequests = {};
  profileLinkRequestSources = {};
  renderProfileLinkRequestsUI();
  renderNotificationButton();
  refreshOpenSidebarPage('friends');
  refreshOpenSidebarPage('notifications');

  const email = normalizeEmail(currentProfile?.email || auth.currentUser?.email || '');
  const sources = [
    { key: 'uid:' + userId, ref: collection(fsDb, 'profileShares', userId, 'items') }
  ];
  if (email) sources.push({ key: 'email:' + emailProfileDocId(email), ref: collection(fsDb, 'profileEmailShares', emailProfileDocId(email), 'items') });

  const unsubs = sources.map(source => onSnapshot(source.ref, snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        removeProfileLinkRequestSource(source.key, id);
        return;
      }
      const data = ch.doc.data() || {};
      if (data.type !== 'profile_link') {
        removeProfileLinkRequestSource(source.key, id);
        return;
      }
      const request = normalizeProfileLinkRequest(id, data);
      if (request.status === 'accepted' && request.toUid === userId) {
        handleAcceptedProfileLinkRequest(request);
        return;
      }
      if (request.status !== 'pending' || request.fromUid === userId || !profileLinkRequestBelongsToCurrentUser(request)) {
        removeProfileLinkRequestSource(source.key, id);
        return;
      }
      applyProfileLinkRequestSource(source.key, id, request);
    });
    renderProfileLinkRequestsUI();
    renderNotificationButton();
    if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
    refreshOpenSidebarPage('friends');
    refreshOpenSidebarPage('notifications');
  }, err => {
    console.warn('profile link requests listener:', err);
  }));

  unsubProfileLinkRequests = () => {
    unsubs.forEach(fn => fn());
    profileLinkRequests = {};
    profileLinkRequestSources = {};
  };
}

/* Firestore Listener */

const LIVE_APP_URL = 'https://deanosmith.github.io/Notas/';
function getAppBaseUrl() {
  const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname);
  if (isLocal || location.protocol === 'file:') return LIVE_APP_URL;
  const path = location.pathname.replace(/index\.html$/i, '');
  return location.origin + (path.endsWith('/') ? path : path + '/');
}
const getShareUrl       = id => getAppBaseUrl() + '?note='   + id;
const getFolderShareUrl = id => getAppBaseUrl() + '?folder=' + id;

let _shareCtx = null; // { type: 'note'|'folder', id }

function isShareLinkEnabled() {
  if (!_shareCtx) return false;
  if (_shareCtx.type === 'note') return !!notes[_shareCtx.id]?.linkPublic;
  return !!folders[_shareCtx.id]?.public;
}

function updateShareLinkUI() {
  const panel = document.getElementById('share-link-panel');
  const toggle = document.getElementById('share-link-toggle');
  const status = document.getElementById('share-link-status');
  const input = document.getElementById('share-link-input');
  const copyBtn = document.getElementById('copy-link-btn');
  const nativeBtn = document.getElementById('native-share-btn');
  const active = isShareLinkEnabled();
  if (panel) panel.classList.toggle('link-off', !active);
  if (toggle) toggle.checked = active;
  if (status) status.textContent = active ? 'On' : 'Off';
  if (input) input.value = active && _shareCtx
    ? (_shareCtx.type === 'note' ? getShareUrl(_shareCtx.id) : getFolderShareUrl(_shareCtx.id))
    : '';
  if (copyBtn) copyBtn.disabled = !active;
  if (nativeBtn) nativeBtn.disabled = !active;
}

function openShareModal(type, id) {
  if (type === 'note'   && !notes[id])   return;
  if (type === 'folder' && !folders[id]) return;
  _shareCtx = { type, id };

  document.getElementById('share-modal-title').textContent = type === 'note' ? 'Share Note' : 'Share Folder';
  document.getElementById('share-modal-desc').textContent  = type === 'note'
    ? 'Choose friends to give write access, or turn on a read-only public link.'
    : 'Choose friends to give write access to every note in this folder, or turn on a read-only public folder link.';

  const nativeBtn = document.getElementById('native-share-btn');
  nativeBtn.style.display = navigator.share ? 'flex' : 'none';
  updateShareLinkUI();
  renderShareProfileList();

  document.getElementById('share-modal').classList.add('open');
}

function linkedProfileArray() {
  const source = Object.keys(friends).length ? friends : linkedProfiles;
  return Object.values(source).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

function linkedProfileForUid(uid) {
  return friends[uid] || linkedProfiles[uid] || { uid, displayName: 'Friend', email: '', photoURL: '' };
}

function profileMetadataKeys(profile) {
  const email = normalizeEmail(profile?.email || '');
  return [...new Set([profile?.uid, emailProfileKey(email)].filter(Boolean))];
}

function profileMatchKeys(profile) {
  const email = normalizeEmail(profile?.email || '');
  return [...new Set([...profileMetadataKeys(profile), email].filter(Boolean))];
}

function profileAccessKeys(profile) {
  return profileMatchKeys(profile);
}

function normalizeFolderShares(entry) {
  const folderShares = entry?.folderShares && typeof entry.folderShares === 'object' ? { ...entry.folderShares } : {};
  if (entry?.sourceFolderId && !folderShares[entry.sourceFolderId]) {
    folderShares[entry.sourceFolderId] = {
      title: entry.sourceFolderTitle || 'Shared Folder',
      sharedAt: entry.sharedAt || entry.lastSharedAt || new Date().toISOString()
    };
  }
  return folderShares;
}

function normalizeAccessEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const folderShares = normalizeFolderShares(entry);
  const hasKnownScope = !!entry.noteShared || !!entry.mentioned || Object.keys(folderShares).length > 0;
  const legacyNoteScope = !hasKnownScope && !entry.sourceFolderId;
  const normalized = {
    ...entry,
    noteShared: !!entry.noteShared || !!entry.mentioned || legacyNoteScope,
    mentioned: !!entry.mentioned,
    folderShares
  };
  if (!Object.keys(normalized.folderShares).length) delete normalized.folderShares;
  return normalized;
}

function accessEntryHasFolderScope(entry, folderId) {
  const normalized = normalizeAccessEntry(entry);
  return !!(folderId && normalized?.folderShares?.[folderId]);
}

function accessEntryHasNoteScope(entry) {
  const normalized = normalizeAccessEntry(entry);
  return !!(normalized?.noteShared || normalized?.mentioned);
}

function accessEntryHasAnyScope(entry) {
  const normalized = normalizeAccessEntry(entry);
  return !!(normalized && (normalized.noteShared || normalized.mentioned || Object.keys(normalized.folderShares || {}).length));
}

function buildAccessProfile(targetUid, kind = 'share', context = {}, existing = null) {
  const target = linkedProfileForUid(targetUid);
  const now = new Date().toISOString();
  const targetEmail = normalizeEmail(target.email || existing?.email || '');
  const targetPhotos = profilePhotoFields(target.photoURL, target.photoURLCandidates, existing?.photoURL, existing?.photoURLCandidates);
  const sender = currentProfileLinkPayload();
  const sourceFolderId = context.sourceFolderId || '';
  const sourceFolderTitle = context.sourceFolderTitle || '';
  const normalizedExisting = normalizeAccessEntry(existing) || {};
  const folderShares = normalizeFolderShares(normalizedExisting);
  if (sourceFolderId) {
    folderShares[sourceFolderId] = {
      title: sourceFolderTitle || 'Shared Folder',
      sharedAt: now
    };
  }
  const profile = {
    ...normalizedExisting,
    uid: targetUid,
    displayName: target.displayName || normalizedExisting.displayName || 'Linked Profile',
    email: targetEmail,
    photoURL: targetPhotos.photoURL,
    photoURLCandidates: targetPhotos.photoURLCandidates,
    fromUid: userId,
    fromName: sender.displayName || 'Someone',
    fromPhotoURL: sender.photoURL,
    fromPhotoURLCandidates: sender.photoURLCandidates,
    fromEmail: sender.email,
    type: kind === 'mention' ? 'mention' : (normalizedExisting.type || 'share'),
    sharedAt: normalizedExisting.sharedAt || now,
    lastSharedAt: now,
    noteShared: !!normalizedExisting.noteShared || !sourceFolderId,
    mentioned: !!normalizedExisting.mentioned || kind === 'mention'
  };
  if (Object.keys(folderShares).length) profile.folderShares = folderShares;
  if (sourceFolderId) {
    profile.sourceFolderId = sourceFolderId;
    profile.sourceFolderTitle = sourceFolderTitle || 'Shared Folder';
  }
  return profile;
}

function rebuildSharedAccessKeys(sharedWith) {
  const keys = new Set();
  Object.keys(sharedWith || {}).forEach(key => {
    const entry = sharedWith[key] || {};
    keys.add(key);
    if (entry.uid) keys.add(entry.uid);
    const email = normalizeEmail(entry.email || '');
    if (email) {
      keys.add(email);
      keys.add(emailProfileKey(email));
    }
  });
  return [...keys].filter(Boolean);
}

async function persistNoteShareState(noteId) {
  const note = notes[noteId];
  if (!note || !isOwnedNote(note)) return false;
  note.sharedWith = normalizeSharedWith(note.sharedWith);
  note.sharedAccessKeys = rebuildSharedAccessKeys(note.sharedWith);
  note.publicFolderIds = normalizePublicFolderIds(note.publicFolderIds);
  note.public = computeEffectiveNotePublic(note);
  const payload = {
    public: note.public,
    linkPublic: !!note.linkPublic,
    publicFolderIds: note.publicFolderIds,
    sharedWith: Object.keys(note.sharedWith).length ? note.sharedWith : deleteField(),
    sharedAccessKeys: note.sharedAccessKeys.length ? note.sharedAccessKeys : deleteField()
  };
  try {
    await updateDoc(doc(fsDb, 'notes', noteId), payload);
    return true;
  } catch (err) {
    console.error('persist note share state:', err);
    showToast('Failed To Update Sharing', 'error');
    return false;
  }
}

async function persistFolderShareState(folderId) {
  const folder = folders[folderId];
  if (!folder) return false;
  folder.sharedWith = normalizeSharedWith(folder.sharedWith);
  folder.sharedAccessKeys = rebuildSharedAccessKeys(folder.sharedWith);
  const payload = {
    sharedWith: Object.keys(folder.sharedWith).length ? folder.sharedWith : deleteField(),
    sharedAccessKeys: folder.sharedAccessKeys.length ? folder.sharedAccessKeys : deleteField(),
    modified: serverTimestamp()
  };
  try {
    await updateDoc(doc(fsDb, 'folders', folderId), payload);
    return true;
  } catch (err) {
    console.error('persist folder share state:', err);
    showToast('Failed To Update Folder Sharing', 'error');
    return false;
  }
}

function removeFolderScopeFromEntry(entry, folderId) {
  const normalized = normalizeAccessEntry(entry);
  if (!normalized) return null;
  const folderShares = normalizeFolderShares(normalized);
  delete folderShares[folderId];
  if (normalized.sourceFolderId === folderId) {
    delete normalized.sourceFolderId;
    delete normalized.sourceFolderTitle;
  }
  normalized.folderShares = folderShares;
  if (!Object.keys(folderShares).length) delete normalized.folderShares;
  return accessEntryHasAnyScope(normalized) ? normalized : null;
}

function removeNoteScopeFromEntry(entry) {
  const normalized = normalizeAccessEntry(entry);
  if (!normalized) return null;
  normalized.noteShared = false;
  normalized.mentioned = false;
  if (normalized.type === 'mention') normalized.type = 'share';
  return accessEntryHasAnyScope(normalized) ? normalized : null;
}

async function removeFolderScopeFromNote(noteId, folderId) {
  const note = notes[noteId];
  if (!note || !isOwnedNote(note) || !folderId) return false;
  const publicFolderIds = new Set(normalizePublicFolderIds(note.publicFolderIds));
  publicFolderIds.delete(folderId);
  note.publicFolderIds = [...publicFolderIds];
  const nextSharedWith = {};
  Object.keys(normalizeSharedWith(note.sharedWith)).forEach(key => {
    const nextEntry = removeFolderScopeFromEntry(note.sharedWith[key], folderId);
    if (nextEntry) nextSharedWith[key] = nextEntry;
  });
  note.sharedWith = nextSharedWith;
  return await persistNoteShareState(noteId);
}

async function removeProfileFolderScopeFromNote(noteId, folderId, targetUid) {
  const note = notes[noteId];
  const profile = linkedProfiles[targetUid];
  if (!note || !profile || !isOwnedNote(note) || !folderId) return false;
  const keys = new Set(profileMatchKeys(profile));
  const nextSharedWith = { ...normalizeSharedWith(note.sharedWith) };
  Object.keys(nextSharedWith).forEach(key => {
    const entry = nextSharedWith[key];
    const email = normalizeEmail(entry?.email || profile.email || '');
    if (keys.has(key) || entry?.uid === targetUid || (email && email === normalizeEmail(profile.email))) {
      const nextEntry = removeFolderScopeFromEntry(entry, folderId);
      if (nextEntry) nextSharedWith[key] = nextEntry;
      else delete nextSharedWith[key];
    }
  });
  note.sharedWith = nextSharedWith;
  return await persistNoteShareState(noteId);
}

async function removeNoteDirectShares(noteId) {
  const note = notes[noteId];
  if (!note || !isOwnedNote(note)) return false;
  const nextSharedWith = {};
  Object.keys(normalizeSharedWith(note.sharedWith)).forEach(key => {
    const nextEntry = removeNoteScopeFromEntry(note.sharedWith[key]);
    if (nextEntry) nextSharedWith[key] = nextEntry;
  });
  note.sharedWith = nextSharedWith;
  return await persistNoteShareState(noteId);
}

async function removeProfileNoteShare(noteId, targetUid) {
  const note = notes[noteId];
  const profile = linkedProfiles[targetUid];
  if (!note || !profile || !isOwnedNote(note)) return false;
  const keys = new Set(profileMatchKeys(profile));
  const nextSharedWith = { ...normalizeSharedWith(note.sharedWith) };
  Object.keys(nextSharedWith).forEach(key => {
    const entry = nextSharedWith[key];
    const email = normalizeEmail(entry?.email || profile.email || '');
    if (keys.has(key) || entry?.uid === targetUid || (email && email === normalizeEmail(profile.email))) {
      const nextEntry = removeNoteScopeFromEntry(entry);
      if (nextEntry) nextSharedWith[key] = nextEntry;
      else delete nextSharedWith[key];
    }
  });
  note.sharedWith = nextSharedWith;
  return await persistNoteShareState(noteId);
}

async function removeProfileFolderShare(folderId, targetUid) {
  const folder = folders[folderId];
  const profile = friends[targetUid] || linkedProfiles[targetUid] || linkedProfileForUid(targetUid);
  if (!folder || !profile) return false;
  const keys = new Set(profileMatchKeys(profile));
  const nextSharedWith = { ...normalizeSharedWith(folder.sharedWith) };
  Object.keys(nextSharedWith).forEach(key => {
    const entry = nextSharedWith[key];
    const email = normalizeEmail(entry?.email || profile.email || '');
    if (keys.has(key) || entry?.uid === targetUid || (email && email === normalizeEmail(profile.email))) {
      delete nextSharedWith[key];
    }
  });
  folder.sharedWith = nextSharedWith;
  const folderSaved = await persistFolderShareState(folderId);
  const folderNotes = Object.values(notes).filter(n => n.folderId === folderId && isOwnedNote(n));
  await Promise.all(folderNotes.map(n => Promise.all([
    removeProfileFolderScopeFromNote(n.id, folderId, targetUid),
    removeFolderScopeFromNoteAccess(n.id, folderId, targetUid)
  ])));
  return folderSaved;
}

function folderSharedProfiles(folder) {
  const entries = Object.values(normalizeSharedWith(folder?.sharedWith));
  const byUidOrEmail = {};
  entries.forEach(entry => {
    const uid = entry?.uid || emailProfileKey(entry?.email || '');
    if (!uid) return;
    byUidOrEmail[uid] = {
      uid,
      displayName: entry.displayName || 'Linked Profile',
      email: normalizeEmail(entry.email || ''),
      photoURL: entry.photoURL || '',
      photoURLCandidates: entry.photoURLCandidates || []
    };
  });
  return Object.values(byUidOrEmail);
}

async function inheritFolderSharingForNote(note, folderId) {
  const folder = folders[folderId];
  if (!note || !folder || !isOwnedNote(note)) return;
  const context = { sourceFolderId: folderId, sourceFolderTitle: folder.title || 'Shared Folder' };
  await Promise.all(folderSharedProfiles(folder).map(profile => {
    linkedProfiles[profile.uid] = linkedProfiles[profile.uid] || profile;
    const friend = friends[profile.uid] || linkedProfiles[profile.uid] || profile;
    return Promise.all([
      shareNoteWithFriend(note.id, friend, 'editor', context, { silent: true }),
      shareNoteWithProfile(note.id, profile.uid, 'share', context, { silent: true, notify: false })
    ]);
  }));
}

function isFolderSharedWithProfile(folder, profile) {
  const sharedWith = normalizeSharedWith(folder?.sharedWith);
  const keys = profileMatchKeys(profile);
  return keys.some(key => !!sharedWith[key]);
}

function isNoteDirectlySharedWithProfile(note, profile) {
  const access = noteAccessForProfile(note?.id, profile);
  if (access?.noteShared) return true;
  const sharedWith = normalizeSharedWith(note?.sharedWith);
  const keys = profileMatchKeys(profile);
  return keys.some(key => accessEntryHasNoteScope(sharedWith[key]));
}

function isNoteSharedViaFolderOnly(note, profile) {
  return isNoteSharedWithProfile(note, profile) && !isNoteDirectlySharedWithProfile(note, profile);
}

function noteAccessDocId(noteId, targetUid) {
  return (noteId + '_' + targetUid).replace(/[^A-Za-z0-9_-]/g, '_');
}

function normalizeNoteAccess(id, data = {}) {
  const email = normalizeEmail(data.email || data.emailLower || '');
  const folderShares = normalizeFolderShares(data);
  const hasFolderScope = Object.keys(folderShares).length > 0;
  const noteShared = typeof data.noteShared === 'boolean' ? data.noteShared : !hasFolderScope;
  const directRole = data.directRole === 'editor'
    ? 'editor'
    : (noteShared && data.role === 'editor' ? 'editor' : '');
  const primaryFolderId = data.sourceFolderId || Object.keys(folderShares)[0] || '';
  const primaryFolderShare = primaryFolderId ? folderShares[primaryFolderId] : null;
  const fromPhotos = profilePhotoFields(data.fromPhotoURL, data.fromPhotoURLCandidates);
  const normalized = {
    id,
    noteId: data.noteId || '',
    userUid: data.userUid || '',
    role: data.role === 'editor' ? 'editor' : '',
    directRole,
    noteShared,
    folderShares,
    sourceFolderId: primaryFolderId,
    sourceFolderTitle: data.sourceFolderTitle || primaryFolderShare?.title || '',
    grantedBy: data.grantedBy || '',
    fromUid: data.fromUid || data.grantedBy || '',
    fromName: data.fromName || '',
    fromEmail: normalizeEmail(data.fromEmail || ''),
    fromPhotoURL: fromPhotos.photoURL,
    fromPhotoURLCandidates: fromPhotos.photoURLCandidates,
    displayName: data.displayName || (email ? email.split('@')[0] : 'Friend'),
    email,
    emailLower: normalizeEmail(data.emailLower || email),
    photoURL: data.photoURL || '',
    created: isoFromTimestamp(data.created) || new Date().toISOString(),
    modified: isoFromTimestamp(data.modified) || new Date().toISOString()
  };
  normalized.reminders = normalizeAccessReminders(data.reminders, normalized);
  return normalized;
}

function normalizeAccessReminder(id, data = {}, access = {}) {
  if (!data || typeof data !== 'object') return null;
  const reminderAt = normalizeAlarmAt(data.reminderAt || data.alarmAt);
  if (!reminderAt) return null;
  const reminderId = data.id || data.reminderId || id;
  const fromUid = data.fromUid || access.fromUid || access.grantedBy || '';
  const fromPhotos = profilePhotoFields(data.fromPhotoURL, data.fromPhotoURLCandidates, access.fromPhotoURL, access.fromPhotoURLCandidates);
  return {
    id: reminderId,
    type: 'reminder',
    noteId: data.noteId || access.noteId || '',
    noteTitle: data.noteTitle || notes[data.noteId || access.noteId]?.title || 'Untitled Note',
    reminderId,
    reminderAt,
    reminderText: data.reminderText || data.text || data.noteTitle || 'Reminder',
    recipientUid: data.recipientUid || access.userUid || '',
    fromUid,
    fromName: data.fromName || access.fromName || 'Someone',
    fromPhotoURL: fromPhotos.photoURL,
    fromPhotoURLCandidates: fromPhotos.photoURLCandidates,
    fromEmail: normalizeEmail(data.fromEmail || access.fromEmail || ''),
    created: isoFromTimestamp(data.created) || data.createdIso || access.modified || access.created || new Date().toISOString(),
    readKey: notificationReadKeyForParts('reminder', reminderId, fromUid),
    read: false,
    source: 'access'
  };
}

function normalizeAccessReminders(raw, access = {}) {
  const out = {};
  Object.keys(raw && typeof raw === 'object' ? raw : {}).forEach(id => {
    const reminder = normalizeAccessReminder(id, raw[id], access);
    if (reminder?.id) out[reminder.id] = reminder;
  });
  return out;
}

function rebuildNoteAccessGroups() {
  noteAccessByNote = {};
  Object.values(noteAccessById).forEach(access => {
    if (!access?.noteId) return;
    if (!noteAccessByNote[access.noteId]) noteAccessByNote[access.noteId] = [];
    noteAccessByNote[access.noteId].push(access);
  });
  Object.keys(noteAccessByNote).forEach(noteId => {
    noteAccessByNote[noteId].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  });
}

function noteAccessProfiles(noteId) {
  return (noteAccessByNote[noteId] || []).map(access => ({
    uid: access.userUid,
    displayName: access.displayName,
    email: access.email,
    photoURL: access.photoURL
  }));
}

function noteAccessForProfile(noteId, profile) {
  const keys = new Set(profileMatchKeys(profile));
  const profileEmail = normalizeEmail(profile?.email || '');
  return (noteAccessByNote[noteId] || []).find(access => {
    const accessEmail = normalizeEmail(access.email || '');
    return access.userUid === profile?.uid ||
      keys.has(access.userUid) ||
      (accessEmail && (accessEmail === profileEmail || keys.has(accessEmail) || keys.has(emailProfileKey(accessEmail))));
  }) || null;
}

function directAccessForNote(noteId) {
  return myNoteAccessByNote[noteId] || noteAccessById[noteAccessDocId(noteId, userId)] || null;
}

function hasDirectNoteAccess(noteId) {
  return !!directAccessForNote(noteId);
}

function directAccessRoleForNote(noteId) {
  return directAccessForNote(noteId)?.role || '';
}

function canEditNote(note) {
  if (!note) return false;
  if (isTrashedNote(note)) return false;
  if (isOwnedNote(note)) return true;
  return directAccessRoleForNote(note.id) === 'editor' || note.directAccessRole === 'editor';
}

function canReadLoadedSharedNote(noteId, data) {
  if (data?.deletedAt) return data.owner === userId;
  const sharedWith = normalizeSharedWith(data?.sharedWith);
  const sharedAccessKeys = normalizeSharedAccessKeys(data?.sharedAccessKeys);
  return !!(
    data?.owner === userId ||
    noteLinkPublicFromData(data) ||
    hasDirectNoteAccess(noteId) ||
    !!sharedLibraryMeta[noteId] ||
    hasSharedAccess(sharedWith, sharedAccessKeys) ||
    hasImportedFolderPublicAccess(noteId, data)
  );
}

function accessProfilePayload(friend) {
  const profile = normalizeUserProfile(friend?.uid, friend || {});
  return {
    displayName: profile.displayName || '',
    email: profile.email || '',
    emailLower: profile.emailLower || normalizeEmail(profile.email || ''),
    photoURL: profile.photoURL || ''
  };
}

async function shareNoteWithFriend(noteId, friend, role = 'editor', context = {}, options = {}) {
  const note = notes[noteId];
  if (!note || !friend?.uid || !isOwnedNote(note) || friend.uid === userId) return false;
  const accessId = noteAccessDocId(noteId, friend.uid);
  const ref = doc(fsDb, 'noteAccess', accessId);
  const existingSnap = await getDoc(ref).catch(() => null);
  const existingData = existingSnap?.exists?.() ? (existingSnap.data() || {}) : {};
  const existingAccess = existingSnap?.exists?.() ? normalizeNoteAccess(accessId, existingData) : null;
  const sourceFolderId = context.sourceFolderId || '';
  const sourceFolderTitle = context.sourceFolderTitle || (sourceFolderId ? 'Shared Folder' : '');
  const folderShares = normalizeFolderShares(existingAccess);
  const now = new Date().toISOString();
  if (sourceFolderId) {
    folderShares[sourceFolderId] = {
      title: sourceFolderTitle || 'Shared Folder',
      sharedAt: folderShares[sourceFolderId]?.sharedAt || now
    };
  }
  const hasFolderShares = Object.keys(folderShares).length > 0;
  const primaryFolderId = sourceFolderId || existingAccess?.sourceFolderId || Object.keys(folderShares)[0] || '';
  const primaryFolderShare = primaryFolderId ? folderShares[primaryFolderId] : null;
  const noteShared = sourceFolderId ? !!existingAccess?.noteShared : true;
  const directRole = noteShared ? 'editor' : '';
  const sender = currentProfileLinkPayload();
  const profile = accessProfilePayload(friend);
  const payload = {
    noteId,
    userUid: friend.uid,
    role: 'editor',
    directRole: directRole || deleteField(),
    noteShared,
    folderShares: hasFolderShares ? folderShares : deleteField(),
    sourceFolderId: primaryFolderId || deleteField(),
    sourceFolderTitle: primaryFolderId ? (primaryFolderShare?.title || sourceFolderTitle || 'Shared Folder') : deleteField(),
    grantedBy: userId,
    fromUid: userId,
    fromName: sender.displayName || 'Someone',
    fromPhotoURL: sender.photoURL || '',
    fromPhotoURLCandidates: sender.photoURLCandidates || [],
    fromEmail: sender.email || '',
    ...profile,
    created: existingSnap?.exists?.() ? (existingSnap.data().created || serverTimestamp()) : serverTimestamp(),
    modified: serverTimestamp()
  };
  await setDoc(ref, payload, { merge: true });
  const localPayload = { ...payload };
  if (!directRole) delete localPayload.directRole;
  if (!hasFolderShares) delete localPayload.folderShares;
  if (!primaryFolderId) {
    delete localPayload.sourceFolderId;
    delete localPayload.sourceFolderTitle;
  }
  noteAccessById[accessId] = normalizeNoteAccess(accessId, localPayload);
  rebuildNoteAccessGroups();
  updateActiveNoteAccessAvatars();
  if (!options.silent) showToast('Shared With ' + (profile.displayName || profile.email || 'Friend'), 'success');
  return true;
}

function ensureNoteAccessWritable(access) {
  if (!access?.id || access.grantedBy !== userId) return;
  const updates = {};
  if (access.role !== 'editor') updates.role = 'editor';
  if (access.noteShared && access.directRole !== 'editor') updates.directRole = 'editor';
  if (!access.noteShared && access.directRole) updates.directRole = deleteField();
  if (!Object.keys(updates).length) return;
  setDoc(doc(fsDb, 'noteAccess', access.id), {
    ...updates,
    modified: serverTimestamp()
  }, { merge: true }).catch(err => console.warn('upgrade note access write permission:', err));
}

async function removeFolderScopeFromNoteAccess(noteId, folderId, targetUid) {
  const note = notes[noteId];
  if (!note || !folderId || !targetUid || !isOwnedNote(note)) return false;
  const ref = doc(fsDb, 'noteAccess', noteAccessDocId(noteId, targetUid));
  const snap = await getDoc(ref).catch(() => null);
  if (!snap?.exists?.()) return true;
  const access = normalizeNoteAccess(snap.id, snap.data() || {});
  const folderShares = normalizeFolderShares(access);
  delete folderShares[folderId];
  const remainingFolderIds = Object.keys(folderShares);
  if (access.noteShared || remainingFolderIds.length) {
    const primaryFolderId = remainingFolderIds[0] || '';
    await setDoc(ref, {
      role: 'editor',
      directRole: access.noteShared ? 'editor' : deleteField(),
      noteShared: !!access.noteShared,
      folderShares: remainingFolderIds.length ? folderShares : deleteField(),
      sourceFolderId: primaryFolderId || deleteField(),
      sourceFolderTitle: primaryFolderId ? (folderShares[primaryFolderId]?.title || 'Shared Folder') : deleteField(),
      modified: serverTimestamp()
    }, { merge: true });
  } else {
    await deleteDoc(ref);
  }
  return true;
}

async function revokeNoteAccess(noteId, targetUid) {
  const note = notes[noteId];
  if (!note || !targetUid || !isOwnedNote(note)) return false;
  const ref = doc(fsDb, 'noteAccess', noteAccessDocId(noteId, targetUid));
  const snap = await getDoc(ref).catch(() => null);
  if (!snap?.exists?.()) return true;
  const access = normalizeNoteAccess(snap.id, snap.data() || {});
  const folderShares = normalizeFolderShares(access);
  if (Object.keys(folderShares).length) {
    const primaryFolderId = Object.keys(folderShares)[0] || '';
    await setDoc(ref, {
      role: 'editor',
      directRole: deleteField(),
      noteShared: false,
      folderShares,
      sourceFolderId: primaryFolderId || deleteField(),
      sourceFolderTitle: primaryFolderId ? (folderShares[primaryFolderId]?.title || 'Shared Folder') : deleteField(),
      modified: serverTimestamp()
    }, { merge: true });
  } else {
    await deleteDoc(ref);
  }
  showToast('Access Revoked', 'success');
  return true;
}

function applySharedNoteFromData(noteId, data, access = directAccessForNote(noteId) || {}) {
  if (!data || data.owner === userId) return false;
  if (data.deletedAt) return false;
  const folderId = _applySharedFolderFromData(noteId, access) || _getSharedNoteFolder(noteId);
  notes[noteId] = noteFromFirestoreData(noteId, data, {
    folderId,
    pinnedAt: _getSharedNotePinnedAt(noteId),
    pinScope: _getSharedNotePinScope(noteId),
    directAccessRole: access.role || '',
    directAccess: access
  });
  return true;
}

async function loadSharedNoteFromAccess(access) {
  if (!access?.noteId || access.userUid !== userId) return false;
  try {
    const wasActive = activeId === access.noteId;
    const snap = await getDoc(doc(fsDb, 'notes', access.noteId));
    if (!snap.exists()) return false;
    const data = snap.data() || {};
    if (!canReadLoadedSharedNote(access.noteId, data)) return false;
    applySharedNoteFromData(access.noteId, data, access);
    await _addSharedId(access.noteId);
    _subscribeSharedNote(access.noteId);
    renderSidebar();
    if (wasActive) openNote(access.noteId);
    if (!activeId) { const ids = sortedIds(); ids.length ? openNote(ids[0]) : showEditorView(false); }
    return true;
  } catch (err) {
    console.warn('load shared note from access:', err);
    return false;
  }
}

function removeSharedAccessNote(noteId) {
  delete myNoteAccessByNote[noteId];
  delete noteAccessById[noteAccessDocId(noteId, userId)];
  rebuildNoteAccessGroups();
  if (notes[noteId] && !isOwnedNote(notes[noteId])) {
    delete notes[noteId];
    _removeSharedId(noteId);
    if (sharedNoteUnsubs[noteId]) { sharedNoteUnsubs[noteId](); delete sharedNoteUnsubs[noteId]; delete sharedNoteInitialLoads[noteId]; }
    if (activeId === noteId) { clearActiveNoteBodyListener(); activeId = null; }
    renderSidebar();
    if (!activeId) { const ids = sortedIds(); ids.length ? openNote(ids[0]) : showEditorView(false); }
  }
}

function listenOwnedNoteAccess() {
  if (unsubOwnedNoteAccess) unsubOwnedNoteAccess();
  if (!userId) return;
  const q = query(collection(fsDb, 'noteAccess'), where('grantedBy', '==', userId));
  unsubOwnedNoteAccess = onSnapshot(q, snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') delete noteAccessById[ch.doc.id];
      else {
        const access = normalizeNoteAccess(ch.doc.id, ch.doc.data() || {});
        noteAccessById[ch.doc.id] = access;
        ensureNoteAccessWritable(access);
      }
    });
    rebuildNoteAccessGroups();
    renderShareProfileList();
    updateActiveNoteAccessAvatars();
    renderSidebar();
  }, err => {
    console.warn('owned note access listener:', err);
  });
}

function listenSharedWithMe() {
  if (unsubSharedWithMe) unsubSharedWithMe();
  if (!userId) return Promise.resolve();
  let initialSettled = false;
  let resolveInitial;
  const initialLoad = new Promise(resolve => { resolveInitial = resolve; });
  const settleInitial = loads => {
    if (initialSettled) return;
    initialSettled = true;
    Promise.all(loads || []).catch(() => {}).then(resolveInitial);
  };
  const q = query(collection(fsDb, 'noteAccess'), where('userUid', '==', userId));
  unsubSharedWithMe = onSnapshot(q, snap => {
    const initialLoads = [];
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        const old = noteAccessById[id];
        Object.values(old?.reminders || {}).forEach(reminder => {
          if (profileShareNotifications[reminder.id]?.source === 'access') delete profileShareNotifications[reminder.id];
        });
        if (old?.noteId) removeSharedAccessNote(old.noteId);
        return;
      }
      const previousAccess = noteAccessById[id];
      const access = normalizeNoteAccess(id, ch.doc.data() || {});
      if (
        previousAccess?.sourceFolderId &&
        previousAccess.sourceFolderId !== access.sourceFolderId &&
        _getSharedNoteFolder(access.noteId) === _sharedFolderLocalId(previousAccess.sourceFolderId)
      ) {
        _setSharedNoteFolder(access.noteId, null).catch(err => console.error('clear revoked shared folder placement:', err));
      }
      noteAccessById[id] = access;
      myNoteAccessByNote[access.noteId] = access;
      applyAccessReminderNotifications(access);
      const load = loadSharedNoteFromAccess(access);
      if (!initialSettled) initialLoads.push(load);
    });
    rebuildNoteAccessGroups();
    updateActiveNoteAccessAvatars();
    renderSidebar();
    renderNotificationButton();
    renderAlarmButton();
    if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
    refreshOpenSidebarPage('notifications');
    refreshOpenSidebarPage('alarms');
    settleInitial(initialLoads);
  }, err => {
    console.warn('shared with me listener:', err);
    settleInitial();
  });
  return initialLoad;
}

function renderShareProfileList() {
  const list = document.getElementById('share-profiles-list');
  const panel = document.getElementById('share-profile-panel');
  if (!list || !panel) return;
  const profiles = friendArray();
  if (!profiles.length) {
    list.innerHTML = '<div class="profile-empty">Add friends first, then share notes or folders with write access.</div>';
    return;
  }

  const type = _shareCtx?.type || 'note';
  if (type === 'folder') {
    const folder = folders[_shareCtx?.id];
    if (!folder) {
      list.innerHTML = '';
      return;
    }
    const noteCount = Object.values(notes).filter(n => n.folderId === folder.id && isOwnedNote(n)).length;
    const noteLabel = noteCount + ' note' + (noteCount === 1 ? '' : 's');
    list.innerHTML = profiles.map(p => {
      const shared = isFolderSharedWithProfile(folder, p);
      const sub = shared ? ('Write access to ' + noteLabel) : ('Share write access to ' + noteLabel);
      const button = shared
        ? '<button class="modal-btn danger" data-revoke-folder-access="' + esc(p.uid) + '" type="button"><i class="fa-solid fa-user-minus" style="margin-right:6px;"></i>Revoke</button>'
        : '<button class="modal-btn primary" data-share-friend="' + esc(p.uid) + '" type="button"><i class="fa-solid fa-paper-plane" style="margin-right:6px;"></i>Share</button>';
      return '<div class="profile-row">' +
        renderProfileAvatar(p) +
        '<div class="profile-main"><div class="profile-name">' + esc(p.displayName) + '</div><div class="profile-sub">' + esc(sub) + '</div></div>' +
        button +
      '</div>';
    }).join('');

    list.querySelectorAll('[data-share-friend]').forEach(btn => {
      btn.addEventListener('click', () => shareWithProfile(btn.dataset.shareFriend));
    });
    list.querySelectorAll('[data-revoke-folder-access]').forEach(btn => {
      btn.addEventListener('click', () => unshareWithProfile(btn.dataset.revokeFolderAccess));
    });
    return;
  }

  list.innerHTML = profiles.map(p => {
    const access = noteAccessForProfile(_shareCtx?.id, p);
    const hasFolderAccess = !!Object.keys(normalizeFolderShares(access)).length;
    const hasDirectAccess = !!access?.noteShared;
    const sub = hasDirectAccess
      ? ('Write access' + (hasFolderAccess ? ' + folder access' : ''))
      : (hasFolderAccess ? 'Write access via folder' : 'No access');
    const button = hasDirectAccess
      ? '<button class="modal-btn danger" data-revoke-note-access="' + esc(p.uid) + '" type="button"><i class="fa-solid fa-user-minus" style="margin-right:6px;"></i>Revoke</button>'
      : (hasFolderAccess
        ? '<button class="modal-btn" type="button" disabled><i class="fa-solid fa-check" style="margin-right:6px;"></i>Shared</button>'
        : '<button class="modal-btn primary" data-share-friend="' + esc(p.uid) + '" type="button"><i class="fa-solid fa-paper-plane" style="margin-right:6px;"></i>Share</button>');
    return '<div class="profile-row">' +
      renderProfileAvatar(p) +
      '<div class="profile-main"><div class="profile-name">' + esc(p.displayName) + '</div><div class="profile-sub">' + esc(sub) + '</div></div>' +
      button +
    '</div>';
  }).join('');

  list.querySelectorAll('[data-share-friend]').forEach(btn => {
    btn.addEventListener('click', () => shareWithProfile(btn.dataset.shareFriend));
  });
  list.querySelectorAll('[data-revoke-note-access]').forEach(btn => {
    btn.addEventListener('click', () => unshareWithProfile(btn.dataset.revokeNoteAccess));
  });
}

function profileShareDocId(kind, noteId, targetUid) {
  return (kind + '_' + noteId + '_' + targetUid).replace(/[^A-Za-z0-9_-]/g, '_');
}

function friendReminderDocId(noteId, targetUid) {
  return ('reminder_' + noteId + '_' + targetUid + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7))
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 180);
}

async function prepareNoteForFriendReminder(note) {
  if (!note || !isOwnedNote(note)) return false;
  if (activeId === note.id && canEditNote(note)) syncActiveNoteFromEditor();
  if (!note.owner) note.owner = userId;
  return await saveDoc(note);
}

function friendReminderInboxWrites(friend, reminderId, payload) {
  const writes = [];
  if (friend?.uid) writes.push(setDoc(doc(fsDb, 'profileShares', friend.uid, 'items', reminderId), payload, { merge: true }));
  const email = normalizeEmail(friend?.email || payload.recipientEmail || '');
  if (email) writes.push(setDoc(doc(fsDb, 'profileEmailShares', emailProfileDocId(email), 'items', reminderId), payload, { merge: true }));
  return writes;
}

function friendReminderAccessPayload(payload) {
  return {
    id: payload.id,
    type: 'reminder',
    noteId: payload.noteId,
    noteTitle: payload.noteTitle || 'Untitled Note',
    reminderText: payload.reminderText || payload.noteTitle || 'Reminder',
    reminderAt: payload.reminderAt,
    recipientUid: payload.recipientUid || '',
    recipientProfileKey: payload.recipientProfileKey || payload.recipientUid || '',
    recipientName: payload.recipientName || '',
    recipientEmail: normalizeEmail(payload.recipientEmail || ''),
    fromUid: payload.fromUid || '',
    fromName: payload.fromName || 'Someone',
    fromPhotoURL: payload.fromPhotoURL || '',
    fromPhotoURLCandidates: payload.fromPhotoURLCandidates || [],
    fromEmail: normalizeEmail(payload.fromEmail || ''),
    createdIso: payload.createdIso || new Date().toISOString(),
    created: serverTimestamp()
  };
}

function writeFriendReminderAccessFallback(noteId, friend, reminderId, payload) {
  if (!noteId || !friend?.uid || !reminderId) return Promise.reject(new Error('Missing reminder access target'));
  return setDoc(doc(fsDb, 'noteAccess', noteAccessDocId(noteId, friend.uid)), {
    reminders: { [reminderId]: friendReminderAccessPayload(payload) },
    modified: serverTimestamp()
  }, { merge: true });
}

async function sendFriendReminder(noteId, targetUid, reminderAt, reminderText = '') {
  const note = notes[noteId];
  const friend = friends[targetUid];
  const normalizedAt = normalizeAlarmAt(reminderAt);
  if (!note || !friend?.uid || friend.uid === userId || !normalizedAt) return { ok: false, reason: 'invalid' };
  if (!isOwnedNote(note)) {
    showToast('Only The Owner Can Set Friend Reminders', 'error');
    return { ok: false, reason: 'not_owner' };
  }

  const noteReady = await prepareNoteForFriendReminder(note);
  if (!noteReady) return { ok: false, reason: 'save_failed' };

  let shared = false;
  try {
    shared = await shareNoteWithFriend(noteId, friend, 'editor', {}, { silent: true });
  } catch (err) {
    console.error('share note for friend reminder:', err);
    return { ok: false, reason: 'share_failed' };
  }
  if (!shared) return { ok: false, reason: 'share_failed' };

  const reminderId = friendReminderDocId(noteId, targetUid);
  const sender = currentProfileLinkPayload();
  const friendPhotos = profilePhotoFields(friend.photoURL, friend.photoURLCandidates);
  const cleanText = String(reminderText || '').replace(/\s+/g, ' ').trim() || note.title || 'Reminder';
  const now = new Date().toISOString();
  const payload = {
    id: reminderId,
    type: 'reminder',
    noteId,
    noteTitle: note.title || 'Untitled Note',
    reminderText: cleanText,
    reminderAt: normalizedAt,
    recipientUid: friend.uid,
    recipientProfileKey: friend.uid,
    recipientName: friend.displayName || '',
    recipientEmail: normalizeEmail(friend.email || ''),
    recipientPhotoURL: friendPhotos.photoURL,
    recipientPhotoURLCandidates: friendPhotos.photoURLCandidates,
    fromUid: userId,
    fromName: sender.displayName || 'Someone',
    fromPhotoURL: sender.photoURL,
    fromPhotoURLCandidates: sender.photoURLCandidates,
    fromEmail: sender.email,
    createdIso: now,
    created: serverTimestamp()
  };

  const sentPayload = {
    ...payload,
    targetUid: friend.uid,
    targetName: friend.displayName || 'Friend',
    targetEmail: normalizeEmail(friend.email || ''),
    targetPhotoURL: friendPhotos.photoURL,
    targetPhotoURLCandidates: friendPhotos.photoURLCandidates
  };

  try {
    const deliveryWrites = [
      ...friendReminderInboxWrites(friend, reminderId, payload),
      writeFriendReminderAccessFallback(noteId, friend, reminderId, payload)
    ];
    const deliveryResults = await Promise.allSettled(deliveryWrites);
    if (!deliveryResults.some(result => result.status === 'fulfilled')) {
      console.error('send friend reminder delivery:', deliveryResults);
      return { ok: false, reason: 'delivery_failed' };
    }
    if (deliveryResults.some(result => result.status === 'rejected')) {
      console.warn('partial friend reminder delivery:', deliveryResults);
    }
  } catch (err) {
    console.error('send friend reminder delivery:', err);
    return { ok: false, reason: 'delivery_failed' };
  }

  sentReminders[reminderId] = normalizeSentReminder(reminderId, sentPayload);
  _writeSentRemindersToLocal();

  let cloudSynced = true;
  try {
    await setDoc(_getUserDocRef(), { sentReminders: { [reminderId]: sentPayload } }, { merge: true });
  } catch (err) {
    cloudSynced = false;
    console.error('save sent reminder:', err);
  }

  return { ok: true, cloudSynced, id: reminderId };
}

async function writeProfileShare(note, targetUid, kind = 'share', context = {}, options = {}) {
  const target = linkedProfileForUid(targetUid);
  const sender = currentProfileLinkPayload();
  const shareId = profileShareDocId(kind, note.id, targetUid);
  const now = new Date().toISOString();
  const targetEmail = normalizeEmail(target.email || '');
  const emailKey = emailProfileKey(targetEmail);
  const metadataKeys = [...new Set([target.uid, emailKey].filter(Boolean))];
  const accessKeys = [...new Set([...metadataKeys, targetEmail].filter(Boolean))];
  const sourceFolderId = context.sourceFolderId || '';
  const sourceFolderTitle = context.sourceFolderTitle || '';
  const sharedWith = {};
  const currentSharedWith = normalizeSharedWith(notes[note.id]?.sharedWith);
  metadataKeys.forEach(key => {
    sharedWith[key] = buildAccessProfile(targetUid, kind, context, currentSharedWith[key]);
  });
  const noteRef = doc(fsDb, 'notes', note.id);
  // Direct-share notifications must not arrive before the note is readable. The
  // public flag remains the effective access flag, while scoped metadata decides
  // which sharing action can later remove access.
  notes[note.id].sharedWith = { ...(notes[note.id].sharedWith || {}), ...sharedWith };
  notes[note.id].sharedAccessKeys = [...new Set([...(notes[note.id].sharedAccessKeys || []), ...accessKeys])];
  notes[note.id].public = computeEffectiveNotePublic(notes[note.id]);
  await setDoc(noteRef, {
    public: notes[note.id].public,
    sharedWith,
    sharedAccessKeys: arrayUnion(...accessKeys)
  }, { merge: true });

  const payload = {
    id: shareId,
    type: kind,
    noteId: note.id,
    noteTitle: note.title || 'Untitled Note',
    recipientUid: target.emailOnly ? '' : targetUid,
    recipientProfileKey: targetUid,
    recipientName: target.displayName || '',
    recipientEmail: targetEmail,
    fromUid: userId,
    fromName: sender.displayName || 'Someone',
    fromPhotoURL: sender.photoURL,
    fromPhotoURLCandidates: sender.photoURLCandidates,
    fromEmail: sender.email,
    createdIso: now,
    created: serverTimestamp()
  };
  if (sourceFolderId) {
    payload.sourceFolderId = sourceFolderId;
    payload.sourceFolderTitle = sourceFolderTitle || 'Shared Folder';
  }

  if (options.notify === false) return { notified: false, skipped: true };

  const inboxWrites = [];
  if (!target.emailOnly && target.uid) inboxWrites.push(setDoc(doc(fsDb, 'profileShares', target.uid, 'items', shareId), payload, { merge: true }));
  if (target.email) inboxWrites.push(setDoc(doc(fsDb, 'profileEmailShares', emailProfileDocId(target.email), 'items', shareId), payload, { merge: true }));
  const results = await Promise.allSettled(inboxWrites);
  if (results.some(r => r.status === 'rejected')) console.warn('profile share notification delivery:', results);
  return { notified: results.some(r => r.status === 'fulfilled') };
}

async function shareNoteWithProfile(noteId, targetUid, kind = 'share', context = {}, options = {}) {
  const note = notes[noteId];
  if (!note || !targetUid || targetUid === userId) return false;
  if (!isOwnedNote(note)) return false;
  await writeProfileShare(note, targetUid, kind, context, options);
  if (!options.silent) renderSidebar();
  return true;
}

async function writeFolderShareNotification(folderId, targetUid, noteIds = []) {
  const folder = folders[folderId];
  if (!folder || !targetUid || targetUid === userId) return { notified: false };
  const target = linkedProfileForUid(targetUid);
  const sender = currentProfileLinkPayload();
  const shareId = profileShareDocId('folder_share', folderId, targetUid);
  const now = new Date().toISOString();
  const targetEmail = normalizeEmail(target.email || '');
  const sourceFolderTitle = folder.title || 'Shared Folder';
  const payload = {
    id: shareId,
    type: 'folder_share',
    sourceFolderId: folderId,
    sourceFolderTitle,
    folderId,
    folderTitle: sourceFolderTitle,
    noteIds: [...new Set(noteIds.filter(Boolean))],
    recipientUid: target.emailOnly ? '' : targetUid,
    recipientProfileKey: targetUid,
    recipientName: target.displayName || '',
    recipientEmail: targetEmail,
    fromUid: userId,
    fromName: sender.displayName || 'Someone',
    fromPhotoURL: sender.photoURL,
    fromPhotoURLCandidates: sender.photoURLCandidates,
    fromEmail: sender.email,
    createdIso: now,
    created: serverTimestamp()
  };
  const inboxWrites = [];
  if (!target.emailOnly && target.uid) inboxWrites.push(setDoc(doc(fsDb, 'profileShares', target.uid, 'items', shareId), payload, { merge: true }));
  if (target.email) inboxWrites.push(setDoc(doc(fsDb, 'profileEmailShares', emailProfileDocId(target.email), 'items', shareId), payload, { merge: true }));
  const results = await Promise.allSettled(inboxWrites);
  if (results.some(r => r.status === 'rejected')) console.warn('folder share notification delivery:', results);
  return { notified: results.some(r => r.status === 'fulfilled') };
}

async function writeFolderProfileShare(folderId, targetUid) {
  const folder = folders[folderId];
  if (!folder || !targetUid || targetUid === userId) return false;
  const target = linkedProfileForUid(targetUid);
  const sharedWith = normalizeSharedWith(folder.sharedWith);
  profileMetadataKeys(target).forEach(key => {
    sharedWith[key] = buildAccessProfile(targetUid, 'share', {
      sourceFolderId: folderId,
      sourceFolderTitle: folder.title || 'Shared Folder'
    }, sharedWith[key]);
  });
  folder.sharedWith = sharedWith;
  return await persistFolderShareState(folderId);
}

async function shareFolderWithProfile(folderId, targetUid) {
  const folder = folders[folderId];
  if (!folder || !targetUid || targetUid === userId) return false;
  const folderNotes = Object.values(notes).filter(n => n.folderId === folderId && isOwnedNote(n));
  const folderShared = await writeFolderProfileShare(folderId, targetUid);
  if (!folderShared) return false;
  const context = { sourceFolderId: folderId, sourceFolderTitle: folder.title || 'Shared Folder' };
  const friend = friends[targetUid] || linkedProfileForUid(targetUid);
  const grants = await Promise.all(folderNotes.map(n => Promise.all([
    shareNoteWithFriend(n.id, friend, 'editor', context, { silent: true }),
    shareNoteWithProfile(n.id, targetUid, 'share', context, { silent: true, notify: false })
  ]).then(results => results.every(Boolean))));
  if (grants.some(ok => !ok)) return false;
  await writeFolderShareNotification(folderId, targetUid, folderNotes.map(n => n.id));
  renderSidebar();
  return true;
}

async function shareWithProfile(targetUid) {
  if (!_shareCtx || !friends[targetUid]) return;
  const targetName = friends[targetUid].displayName || 'Friend';
  if (_shareCtx.type === 'note' && notes[_shareCtx.id] && !isOwnedNote(notes[_shareCtx.id])) {
    showToast('Only The Owner Can Share This Note', 'error');
    return;
  }
  if (_shareCtx.type === 'folder' && folders[_shareCtx.id] && !isOwnedFolder(folders[_shareCtx.id])) {
    showToast('Only The Owner Can Share This Folder', 'error');
    return;
  }
  try {
    let ok = false;
    if (_shareCtx.type === 'note') {
      ok = await shareNoteWithFriend(_shareCtx.id, friends[targetUid], 'editor');
    } else {
      ok = await shareFolderWithProfile(_shareCtx.id, targetUid);
    }
    if (!ok) { showToast('Could Not Share With ' + targetName, 'error'); return; }
    renderShareProfileList();
    if (_shareCtx.type === 'folder') showToast('Folder Shared With ' + targetName, 'success');
  } catch (err) {
    console.error('share with profile:', err);
    showToast('Could Not Share With ' + targetName, 'error');
  }
}

async function unshareWithProfile(targetUid) {
  if (!_shareCtx || !friends[targetUid]) return;
  const targetName = friends[targetUid].displayName || 'Friend';
  try {
    const ok = _shareCtx.type === 'note'
      ? await revokeNoteAccess(_shareCtx.id, targetUid)
      : await removeProfileFolderShare(_shareCtx.id, targetUid);
    if (!ok) { showToast('Could Not Unshare With ' + targetName, 'error'); return; }
    renderShareProfileList();
    renderSidebar();
    if (_shareCtx.type === 'folder') showToast('Folder Access Revoked', 'success');
  } catch (err) {
    console.error('unshare with profile:', err);
    showToast('Could Not Unshare With ' + targetName, 'error');
  }
}

async function setNotePublic(noteId, isPublic) {
  if (!notes[noteId]) return;
  if (!isOwnedNote(notes[noteId])) {
    showToast('Only The Owner Can Change Link Sharing', 'error');
    return false;
  }
  const previousLinkPublic = !!notes[noteId].linkPublic;
  const previousPublic = !!notes[noteId].public;
  notes[noteId].linkPublic = isPublic;
  notes[noteId].public = computeEffectiveNotePublic(notes[noteId]);
  try {
    await setDoc(doc(fsDb, 'notes', noteId), {
      public: notes[noteId].public,
      linkPublic: !!notes[noteId].linkPublic
    }, { merge: true });
    return true;
  }
  catch (err) {
    console.error('setNotePublic:', err);
    notes[noteId].linkPublic = previousLinkPublic;
    notes[noteId].public = previousPublic;
    showToast('Failed To Update Sharing', 'error');
    return false;
  }
}

async function setShareLinkEnabled(enabled) {
  if (!_shareCtx) return false;
  const toggle = document.getElementById('share-link-toggle');
  if (toggle) toggle.disabled = true;
  const ok = _shareCtx.type === 'note'
    ? await setNotePublic(_shareCtx.id, enabled)
    : await setFolderPublic(_shareCtx.id, enabled);
  if (toggle) toggle.disabled = false;
  updateShareLinkUI();
  if (ok) {
    renderSidebar();
    showToast(enabled ? 'Link Sharing On' : 'Link Sharing Off', 'success');
  }
  return ok;
}

async function copyShareLink() {
  if (!isShareLinkEnabled()) {
    showToast('Turn On Link Sharing First', 'error');
    return;
  }
  const val = document.getElementById('share-link-input').value;
  navigator.clipboard?.writeText(val).catch(() => {
    const inp = document.getElementById('share-link-input');
    inp.select(); document.execCommand('copy');
  });
  showToast('Link Copied!', 'success');
}

async function nativeShare() {
  if (!_shareCtx) return;
  if (!isShareLinkEnabled()) {
    showToast('Turn On Link Sharing First', 'error');
    return;
  }
  const url   = _shareCtx.type === 'note' ? getShareUrl(_shareCtx.id) : getFolderShareUrl(_shareCtx.id);
  const title = _shareCtx.type === 'note' ? (notes[_shareCtx.id]?.title || 'Note') : (folders[_shareCtx.id]?.title || 'Folder');
  navigator.share({ title, url }).catch(() => {});
}

/* ── Shared Notes: Firestore-backed + per-document real-time listeners ── */
// Shared note IDs are stored in Firestore at users/{userId} so they sync
// across all devices. Each shared note gets its own onSnapshot listener.
// Firestore rules must allow public link access and profile access via sharedWith/sharedAccessKeys.

function _getUserDocRef() { return doc(fsDb, 'users', userId); }

function _sharedLibraryStorageKey() { return 'notas_shared_library_' + userId; }
function _legacySharedStorageKey() { return 'notas_shared_' + userId; }
function _removedSharedStorageKey() { return 'notas_shared_removed_' + userId; }
function _hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj || {}, key); }

function _normalizeSharedFolderId(folderId) {
  return typeof folderId === 'string' && folderId ? folderId : null;
}

function _safeDocFragment(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'item';
}

function _sharedFolderLocalId(sourceFolderId) {
  return 'shared_folder_' + _safeDocFragment(sourceFolderId) + '_' + _safeDocFragment(userId);
}

function _readRemovedSharedIdsFromLocal() {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(_removedSharedStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    if (Array.isArray(parsed)) {
      return parsed.reduce((acc, id) => {
        if (typeof id === 'string' && id) acc[id] = new Date().toISOString();
        return acc;
      }, {});
    }
    const out = {};
    Object.keys(parsed || {}).forEach(id => {
      const removedAt = normalizePinnedAt(parsed[id]) || new Date().toISOString();
      if (typeof id === 'string' && id) out[id] = removedAt;
    });
    return out;
  } catch (err) {
    console.error('read removed shared notes local:', err);
    return {};
  }
}

function _writeRemovedSharedIdsToLocal() {
  if (!userId) return;
  try {
    const entries = Object.entries(removedSharedNoteIds || {})
      .filter(([id]) => typeof id === 'string' && id)
      .sort((a, b) => noteTime(b[1]) - noteTime(a[1]))
      .slice(0, 500);
    if (entries.length) localStorage.setItem(_removedSharedStorageKey(), JSON.stringify(Object.fromEntries(entries)));
    else localStorage.removeItem(_removedSharedStorageKey());
    removedSharedNoteIds = Object.fromEntries(entries);
  } catch (err) {
    console.error('write removed shared notes local:', err);
  }
}

function _markSharedIdRemoved(noteId) {
  if (!noteId) return;
  removedSharedNoteIds[noteId] = new Date().toISOString();
  _writeRemovedSharedIdsToLocal();
}

function _clearSharedIdRemoved(noteId) {
  if (!noteId || !removedSharedNoteIds[noteId]) return;
  delete removedSharedNoteIds[noteId];
  _writeRemovedSharedIdsToLocal();
}

function _isSharedIdRemoved(noteId, sharedAt = '') {
  const removedAt = normalizePinnedAt(removedSharedNoteIds[noteId]);
  if (!removedAt) return false;
  const sharedTime = noteTime(sharedAt);
  return !(sharedTime && sharedTime > noteTime(removedAt));
}

function _filterRemovedSharedLibraryMeta(meta) {
  const out = {};
  Object.keys(meta || {}).forEach(id => {
    if (!_isSharedIdRemoved(id)) out[id] = meta[id];
  });
  return out;
}

function _sharedFolderInfoFromData(data) {
  const sourceFolderId = data?.sourceFolderId || data?.sharedFolderId || '';
  if (!sourceFolderId) return null;
  return {
    sourceFolderId,
    title: String(data?.sourceFolderTitle || data?.folderTitle || 'Shared Folder').trim() || 'Shared Folder',
    sourceOwnerUid: data?.fromUid || data?.sourceOwnerUid || '',
    sourceOwnerName: data?.fromName || data?.sourceOwnerName || '',
    sourceOwnerPhotoURL: data?.fromPhotoURL || data?.sourceOwnerPhotoURL || '',
    sourceOwnerPhotoURLCandidates: data?.fromPhotoURLCandidates || data?.sourceOwnerPhotoURLCandidates || []
  };
}

function _ensureSharedFolderShell(info) {
  if (!info?.sourceFolderId || !userId) return null;
  const id = _sharedFolderLocalId(info.sourceFolderId);
  const now = new Date().toISOString();
  const existing = folders[id];
  const title = info.title || existing?.title || 'Shared Folder';
  const iconColor = normalizeFolderIconColor(existing?.iconColor, existing?.iconColorMode) || DEFAULT_FOLDER_ICON_COLOR;
  const iconColorMode = iconColor === FOLDER_ICON_THEME ? 'theme' : 'manual';
  const sourceOwnerPhotos = profilePhotoFields(info.sourceOwnerPhotoURL, info.sourceOwnerPhotoURLCandidates, existing?.sourceOwnerPhotoURL, existing?.sourceOwnerPhotoURLCandidates);
  folders[id] = {
    id,
    title,
    public: false,
    shared: true,
    iconColor,
    iconColorMode,
    sourceFolderId: info.sourceFolderId,
    sourceOwnerUid: info.sourceOwnerUid || existing?.sourceOwnerUid || '',
    sourceOwnerName: info.sourceOwnerName || existing?.sourceOwnerName || '',
    sourceOwnerPhotoURL: sourceOwnerPhotos.photoURL,
    sourceOwnerPhotoURLCandidates: sourceOwnerPhotos.photoURLCandidates,
    order: Number.isFinite(Number(existing?.order)) ? Number(existing.order) : nextFolderOrderValue(),
    created: existing?.created || now,
    modified: now
  };
  expandedFolders.add(id);

  const payload = {
    owner: userId,
    public: false,
    shared: true,
    sourceFolderId: info.sourceFolderId,
    sourceOwnerUid: info.sourceOwnerUid || existing?.sourceOwnerUid || '',
    sourceOwnerName: info.sourceOwnerName || existing?.sourceOwnerName || '',
    sourceOwnerPhotoURL: sourceOwnerPhotos.photoURL,
    sourceOwnerPhotoURLCandidates: sourceOwnerPhotos.photoURLCandidates,
    iconColor,
    iconColorMode,
    title,
    order: folders[id].order,
    modified: serverTimestamp()
  };
  if (!existing) payload.created = Timestamp.fromDate(new Date(now));
  setDoc(doc(fsDb, 'folders', id), payload, { merge: true })
    .catch(err => console.error('sync shared folder shell:', err));
  return id;
}

function _placeSharedNoteInFolder(noteId, folderId) {
  const normalized = _normalizeSharedFolderId(folderId);
  if (!noteId || !normalized) return;
  if (!sharedLibraryMeta[noteId]) sharedLibraryMeta[noteId] = { folderId: normalized };
  else sharedLibraryMeta[noteId].folderId = normalized;
  if (notes[noteId] && !isOwnedNote(notes[noteId])) notes[noteId].folderId = normalized;
  _writeSharedLibraryToLocal();
}

function _applySharedFolderFromData(noteId, data) {
  const folderId = _ensureSharedFolderShell(_sharedFolderInfoFromData(data));
  if (folderId) _placeSharedNoteInFolder(noteId, folderId);
  return folderId;
}

function _readSharedLibraryFromLocal() {
  const meta = {};
  try {
    const raw = localStorage.getItem(_sharedLibraryStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      const ids = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.ids) ? parsed.ids : (Array.isArray(parsed.sharedNoteIds) ? parsed.sharedNoteIds : []));
      const folders = (!Array.isArray(parsed) && parsed && typeof parsed === 'object')
        ? (parsed.folders || parsed.sharedNoteFolders || {})
        : {};
      const pins = (!Array.isArray(parsed) && parsed && typeof parsed === 'object')
        ? (parsed.pins || parsed.sharedNotePins || {})
        : {};
      const pinScopes = (!Array.isArray(parsed) && parsed && typeof parsed === 'object')
        ? (parsed.pinScopes || parsed.sharedNotePinScopes || {})
        : {};
      ids.forEach(id => {
        if (typeof id !== 'string' || !id) return;
        const pinnedAt = normalizePinnedAt(pins[id]);
        meta[id] = {
          folderId: _normalizeSharedFolderId(folders[id]),
          pinnedAt,
          pinScope: pinnedAt ? (pinScopes[id] === 'minor' ? 'minor' : 'major') : ''
        };
      });
    }

    const legacyRaw = localStorage.getItem(_legacySharedStorageKey());
    if (legacyRaw) {
      const legacyIds = JSON.parse(legacyRaw);
      if (Array.isArray(legacyIds)) {
        legacyIds.forEach(id => {
          if (typeof id === 'string' && id && !meta[id]) meta[id] = { folderId: null };
        });
      }
    }
  } catch (err) { console.error('read shared library local:', err); }
  return _filterRemovedSharedLibraryMeta(meta);
}

function _writeSharedLibraryToLocal(meta = sharedLibraryMeta) {
  try {
    const ids = Object.keys(meta);
    const folders = {};
    const pins = {};
    const pinScopes = {};
    ids.forEach(id => {
      const folderId = _normalizeSharedFolderId(meta[id]?.folderId);
      if (folderId) folders[id] = folderId;
      const pinnedAt = normalizePinnedAt(meta[id]?.pinnedAt);
      if (pinnedAt) pins[id] = pinnedAt;
      if (pinnedAt) pinScopes[id] = meta[id]?.pinScope === 'minor' ? 'minor' : 'major';
    });
    if (ids.length) localStorage.setItem(_sharedLibraryStorageKey(), JSON.stringify({ ids, folders, pins, pinScopes }));
    else            localStorage.removeItem(_sharedLibraryStorageKey());
    localStorage.removeItem(_legacySharedStorageKey());
  } catch (err) { console.error('write shared library local:', err); }
}

function _readSharedLibraryFromRemote(data) {
  const meta = {};
  const ids = Array.isArray(data.sharedNoteIds) ? data.sharedNoteIds : [];
  const folders = data.sharedNoteFolders && typeof data.sharedNoteFolders === 'object'
    ? data.sharedNoteFolders
    : {};
  const pins = data.sharedNotePins && typeof data.sharedNotePins === 'object'
    ? data.sharedNotePins
    : {};
  const pinScopes = data.sharedNotePinScopes && typeof data.sharedNotePinScopes === 'object'
    ? data.sharedNotePinScopes
    : {};
  ids.forEach(id => {
    if (typeof id !== 'string' || !id) return;
    meta[id] = {};
    if (_hasOwn(folders, id)) meta[id].folderId = _normalizeSharedFolderId(folders[id]);
    if (_hasOwn(pins, id)) {
      meta[id].pinnedAt = normalizePinnedAt(pins[id]);
      meta[id].pinScope = meta[id].pinnedAt ? (pinScopes[id] === 'minor' ? 'minor' : 'major') : '';
    }
  });
  return meta;
}

function _mergeSharedLibraries(...libs) {
  const merged = {};
  libs.forEach(lib => {
    Object.keys(lib || {}).forEach(id => {
      if (!merged[id]) merged[id] = { folderId: null };
      if (_hasOwn(lib[id], 'folderId')) merged[id].folderId = _normalizeSharedFolderId(lib[id].folderId);
      if (_hasOwn(lib[id], 'pinnedAt')) merged[id].pinnedAt = normalizePinnedAt(lib[id].pinnedAt);
      if (_hasOwn(lib[id], 'pinScope')) merged[id].pinScope = lib[id].pinScope === 'minor' ? 'minor' : (merged[id].pinnedAt ? 'major' : '');
    });
  });
  return merged;
}

function _getSharedNoteFolder(noteId) {
  return _normalizeSharedFolderId(sharedLibraryMeta[noteId]?.folderId);
}

function _getSharedNotePinnedAt(noteId) {
  return normalizePinnedAt(sharedLibraryMeta[noteId]?.pinnedAt);
}

function _getSharedNotePinScope(noteId) {
  return _getSharedNotePinnedAt(noteId) ? (sharedLibraryMeta[noteId]?.pinScope === 'minor' ? 'minor' : 'major') : '';
}

function hasSharedAccess(sharedWith, sharedAccessKeys = []) {
  const email = normalizeEmail(currentProfile?.email || auth.currentUser?.email || '');
  const keys = [userId, emailProfileKey(email), email].filter(Boolean);
  if (Array.isArray(sharedAccessKeys) && keys.some(key => sharedAccessKeys.includes(key))) return true;
  if (!sharedWith || typeof sharedWith !== 'object') return false;
  return keys.some(key => !!sharedWith[key]);
}

function hasImportedFolderPublicAccess(noteId, data) {
  const localFolderId = _getSharedNoteFolder(noteId);
  const sourceFolderId = localFolderId ? folders[localFolderId]?.sourceFolderId : '';
  return !!(sourceFolderId && normalizePublicFolderIds(data?.publicFolderIds).includes(sourceFolderId));
}

function getSharedAccessEntry(sharedWith) {
  if (!sharedWith || typeof sharedWith !== 'object') return null;
  const email = normalizeEmail(currentProfile?.email || auth.currentUser?.email || '');
  const keys = [userId, emailProfileKey(email), email].filter(Boolean);
  for (const key of keys) {
    if (sharedWith[key]) return sharedWith[key];
  }
  return null;
}

function isNoteSharedWithProfile(note, profile) {
  const sharedWith = note?.sharedWith && typeof note.sharedWith === 'object' ? note.sharedWith : {};
  const keys = profileMatchKeys(profile);
  const sharedAccessKeys = Array.isArray(note?.sharedAccessKeys) ? note.sharedAccessKeys : [];
  if ((noteAccessByNote[note?.id] || []).some(access => access.userUid === profile?.uid)) return true;
  return keys.some(key => sharedAccessKeys.includes(key) || !!sharedWith[key]);
}

function profileHasNoteAccess(note, profile) {
  if (!note || !profile?.uid) return false;
  if (profile.uid === userId) return true;
  if (profile.uid === note.owner) return true;
  return isNoteSharedWithProfile(note, profile);
}

function profileNeedsNoteAccess(note, profile) {
  if (!note || !profile?.uid || profile.uid === userId) return false;
  return !profileHasNoteAccess(note, profile);
}

async function ensureProfileNoteAccessForFeature(note, profile, featureLabel = 'this feature') {
  if (!note || !profile?.uid) return false;
  if (!profileNeedsNoteAccess(note, profile)) return true;
  if (!isOwnedNote(note)) {
    showToast('Only The Owner Can Share This Note', 'error');
    return false;
  }
  const shouldShare = typeof confirmMentionShare === 'function'
    ? await confirmMentionShare(profile, note, featureLabel)
    : window.confirm('Share this note with ' + (profile.displayName || profile.email || 'this user') + '?');
  if (!shouldShare) return false;
  try {
    const ok = await shareNoteWithFriend(note.id, friends[profile.uid] || profile, 'editor', {}, { silent: true });
    if (!ok) {
      showToast('Could Not Share Note', 'error');
      return false;
    }
    renderShareProfileList();
    renderSidebar();
    showToast('Shared With ' + (profile.displayName || profile.email || 'Friend'), 'success');
    return true;
  } catch (err) {
    console.error('share note for ' + featureLabel.toLowerCase() + ':', err);
    showToast('Could Not Share Note', 'error');
    return false;
  }
}

function _applySharedLibraryMeta(meta) {
  sharedLibraryMeta = meta;
  Object.keys(notes).forEach(id => {
    if (notes[id] && !isOwnedNote(notes[id])) {
      notes[id].folderId = _getSharedNoteFolder(id);
      notes[id].pinnedAt = _getSharedNotePinnedAt(id);
      notes[id].pinScope = _getSharedNotePinScope(id);
    }
  });
  _writeSharedLibraryToLocal();
}

function _syncSharedSubscriptions(ids) {
  const activeIds = new Set(ids);
  const loads = ids.map(id => _subscribeSharedNote(id)).filter(Boolean);
  Object.keys(sharedNoteUnsubs).forEach(id => {
    if (activeIds.has(id)) return;
    sharedNoteUnsubs[id]();
    delete sharedNoteUnsubs[id];
    delete sharedNoteInitialLoads[id];
    if (notes[id] && !isOwnedNote(notes[id])) {
      delete notes[id];
      if (activeId === id) { clearActiveNoteBodyListener(); activeId = null; }
    }
  });
  return Promise.all(loads).catch(() => {});
}

async function _syncSharedLibraryToCloud(meta = sharedLibraryMeta) {
  const ids = Object.keys(meta);
  if (!ids.length) return true;
  const sharedNoteFolders = {};
  const sharedNotePins = {};
  const sharedNotePinScopes = {};
  ids.forEach(id => {
    sharedNoteFolders[id] = _normalizeSharedFolderId(meta[id]?.folderId);
    const pinnedAt = normalizePinnedAt(meta[id]?.pinnedAt);
    sharedNotePins[id] = pinnedAt || null;
    sharedNotePinScopes[id] = pinnedAt ? (meta[id]?.pinScope === 'minor' ? 'minor' : 'major') : null;
  });
  try {
    await setDoc(_getUserDocRef(), {
      sharedNoteIds: arrayUnion(...ids),
      sharedNoteFolders,
      sharedNotePins,
      sharedNotePinScopes
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('sync shared library cloud:', err);
    return false;
  }
}

async function _addSharedId(noteId) {
  _clearSharedIdRemoved(noteId);
  if (!sharedLibraryMeta[noteId]) sharedLibraryMeta[noteId] = { folderId: null };
  _writeSharedLibraryToLocal();
  const payload = { sharedNoteIds: arrayUnion(noteId) };
  const folderId = _getSharedNoteFolder(noteId);
  const pinnedAt = _getSharedNotePinnedAt(noteId);
  if (folderId) payload.sharedNoteFolders = { [noteId]: folderId };
  if (pinnedAt) payload.sharedNotePins = { [noteId]: pinnedAt };
  if (pinnedAt) payload.sharedNotePinScopes = { [noteId]: _getSharedNotePinScope(noteId) };
  try {
    await setDoc(_getUserDocRef(), payload, { merge: true });
    return true;
  } catch (err) {
    console.error('_addSharedId:', err);
    return false;
  }
}

async function _removeSharedId(noteId, options = {}) {
  if (options.removedByUser) _markSharedIdRemoved(noteId);
  delete sharedLibraryMeta[noteId];
  _writeSharedLibraryToLocal();
  try {
    await setDoc(_getUserDocRef(), {
      sharedNoteIds: arrayRemove(noteId),
      sharedNoteFolders: { [noteId]: null },
      sharedNotePins: { [noteId]: null },
      sharedNotePinScopes: { [noteId]: null }
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('_removeSharedId:', err);
    return false;
  }
}

async function _setSharedNoteFolder(noteId, folderId, { unpin = false } = {}) {
  if (!sharedLibraryMeta[noteId]) sharedLibraryMeta[noteId] = { folderId: null };
  sharedLibraryMeta[noteId].folderId = _normalizeSharedFolderId(folderId);
  if (unpin) {
    sharedLibraryMeta[noteId].pinnedAt = '';
    sharedLibraryMeta[noteId].pinScope = '';
  }
  if (notes[noteId] && !isOwnedNote(notes[noteId])) {
    notes[noteId].folderId = sharedLibraryMeta[noteId].folderId;
    if (unpin) {
      notes[noteId].pinnedAt = '';
      notes[noteId].pinScope = '';
    }
  }
  _writeSharedLibraryToLocal();
  try {
    const payload = {
      sharedNoteIds: arrayUnion(noteId),
      sharedNoteFolders: { [noteId]: sharedLibraryMeta[noteId].folderId }
    };
    const pinnedAt = _getSharedNotePinnedAt(noteId);
    if (pinnedAt) payload.sharedNotePins = { [noteId]: pinnedAt };
    if (pinnedAt) payload.sharedNotePinScopes = { [noteId]: _getSharedNotePinScope(noteId) };
    if (unpin) {
      payload.sharedNotePins = { [noteId]: null };
      payload.sharedNotePinScopes = { [noteId]: null };
    }
    await setDoc(_getUserDocRef(), payload, { merge: true });
    return true;
  } catch (err) {
    console.error('_setSharedNoteFolder:', err);
    return false;
  }
}

async function _setSharedNotePinned(noteId, pinnedAt, pinScope = 'major') {
  if (!sharedLibraryMeta[noteId]) sharedLibraryMeta[noteId] = { folderId: null };
  const normalized = normalizePinnedAt(pinnedAt);
  const normalizedScope = normalized ? (pinScope === 'minor' ? 'minor' : 'major') : '';
  sharedLibraryMeta[noteId].pinnedAt = normalized;
  sharedLibraryMeta[noteId].pinScope = normalizedScope;
  if (notes[noteId] && !isOwnedNote(notes[noteId])) {
    notes[noteId].pinnedAt = normalized;
    notes[noteId].pinScope = normalizedScope;
  }
  _writeSharedLibraryToLocal();
  try {
    await setDoc(_getUserDocRef(), {
      sharedNoteIds: arrayUnion(noteId),
      sharedNotePins: { [noteId]: normalized || null },
      sharedNotePinScopes: { [noteId]: normalizedScope || null }
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('_setSharedNotePinned:', err);
    return false;
  }
}

function notificationReadKeyForParts(type, noteId, fromUid) {
  return [
    'notif',
    _safeDocFragment(type || 'share'),
    _safeDocFragment(noteId || 'note'),
    _safeDocFragment(fromUid || 'sender')
  ].join('_');
}

function notificationTargetId(notification) {
  if (notification?.type === 'reminder') return notification.reminderId || notification.id || '';
  if (notification?.type === 'conversation') return notification.messageId || notification.id || '';
  if (notification?.type === 'conversation_like') return notification.reactionId || notification.id || '';
  return notification?.noteId || notification?.sourceFolderId || notification?.folderId || notification?.id || '';
}

function notificationNoteIds(data) {
  const ids = Array.isArray(data?.noteIds) ? data.noteIds : (data?.noteId ? [data.noteId] : []);
  return [...new Set(ids.filter(id => typeof id === 'string' && id))];
}

function notificationReadKeys(notification) {
  if (!notification) return [];
  const targetId = notificationTargetId(notification);
  return [...new Set([
    notification.id,
    notification.readKey,
    notificationReadKeyForParts(notification.type, targetId, notification.fromUid)
  ].filter(Boolean))];
}

function isNotificationRead(notification) {
  return notificationReadKeys(notification).some(key => !!readNotifications[key]);
}

function notificationDeletedReadKey(notification) {
  if (!notification) return '';
  const baseKey = notification.readKey ||
    notificationReadKeyForParts(notification.type, notificationTargetId(notification), notification.fromUid) ||
    notification.id;
  return baseKey ? 'notif_deleted_' + _safeDocFragment(baseKey) : '';
}

function isNotificationDeleted(notification) {
  const key = notificationDeletedReadKey(notification);
  return !!(key && readNotifications[key]);
}

function reminderClearedReadKey(reminderId) {
  return 'reminder_cleared_' + _safeDocFragment(reminderId || 'reminder');
}

function isReminderCleared(reminder) {
  const reminderId = typeof reminder === 'string' ? reminder : (reminder?.id || reminder?.reminderId || '');
  return !!(reminderId && readNotifications[reminderClearedReadKey(reminderId)]);
}

async function persistNotificationReads(keys) {
  const updates = {};
  keys.filter(Boolean).forEach(key => {
    readNotifications[key] = true;
    updates[key] = true;
  });
  _writeNotificationStateToLocal();
  renderNotificationButton();
  if (typeof renderConversationsSidebar === 'function') renderConversationsSidebar();
  if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
  refreshOpenSidebarPage('notifications');
  if (!Object.keys(updates).length) return;
  try {
    await setDoc(_getUserDocRef(), { readNotifications: updates }, { merge: true });
  } catch (err) {
    console.error('persist notification reads:', err);
  }
}

async function persistNotificationUnreads(keys = []) {
  const updates = {};
  keys.filter(Boolean).forEach(key => {
    delete readNotifications[key];
    updates[key] = false;
  });
  _writeNotificationStateToLocal();
  renderNotificationButton();
  if (typeof renderAlarmButton === 'function') renderAlarmButton();
  if (typeof renderConversationsSidebar === 'function') renderConversationsSidebar();
  if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
  if (document.getElementById('alarms-modal')?.classList.contains('open') && typeof renderAlarmsList === 'function') renderAlarmsList();
  refreshOpenSidebarPage('notifications');
  refreshOpenSidebarPage('alarms');
  refreshOpenSidebarPage('conversations');
  if (!Object.keys(updates).length) return;
  try {
    await setDoc(_getUserDocRef(), { readNotifications: updates }, { merge: true });
  } catch (err) {
    console.error('persist notification unreads:', err);
  }
}

function normalizeProfileShareNotification(id, data) {
  const createdDate = data.created?.toDate?.();
  const created = createdDate ? createdDate.toISOString() : (data.createdIso || new Date().toISOString());
  const type = data.type === 'reminder'
    ? 'reminder'
    : (data.type === 'conversation' ? 'conversation' : (data.type === 'conversation_like' ? 'conversation_like' : (data.type === 'mention' ? 'mention' : (data.type === 'folder_share' ? 'folder_share' : 'share'))));
  const sourceFolderId = data.sourceFolderId || data.folderId || '';
  const sourceFolderTitle = data.sourceFolderTitle || data.folderTitle || 'Shared Folder';
  const targetId = type === 'reminder'
    ? (data.reminderId || data.id || id)
    : (type === 'conversation' ? (data.messageId || data.id || id) : (type === 'conversation_like' ? (data.reactionId || data.id || id) : (data.noteId || sourceFolderId || id)));
  const fromPhotos = profilePhotoFields(data.fromPhotoURL, data.fromPhotoURLCandidates);
  return {
    id,
    type,
    noteId: data.noteId || '',
    noteIds: notificationNoteIds(data),
    noteTitle: data.noteTitle || 'Untitled Note',
    fromUid: data.fromUid || '',
    fromName: data.fromName || 'Someone',
    fromPhotoURL: fromPhotos.photoURL,
    fromPhotoURLCandidates: fromPhotos.photoURLCandidates,
    fromEmail: normalizeEmail(data.fromEmail || ''),
    sourceFolderId,
    sourceFolderTitle,
    conversationId: data.conversationId || '',
    messageId: data.messageId || data.id || id,
    reactionId: data.reactionId || '',
    messagePreview: data.messagePreview || '',
    anchorText: data.anchorText || '',
    reminderId: data.reminderId || data.id || id,
    reminderAt: normalizeAlarmAt(data.reminderAt || data.alarmAt),
    reminderText: data.reminderText || data.text || data.noteTitle || 'Reminder',
    created,
    readKey: notificationReadKeyForParts(type, targetId, data.fromUid || ''),
    read: false,
    source: 'inbox'
  };
}

function applyAccessReminderNotifications(access) {
  const reminders = Object.values(access?.reminders || {});
  const activeReminderIds = new Set(reminders.map(reminder => reminder.id).filter(Boolean));
  Object.keys(profileShareNotifications || {}).forEach(id => {
    const notification = profileShareNotifications[id];
    if (
      notification?.type === 'reminder' &&
      notification.source === 'access' &&
      notification.noteId === access?.noteId &&
      !activeReminderIds.has(notification.id)
    ) {
      delete profileShareNotifications[id];
    }
  });
  reminders.forEach(reminder => {
    if (!reminder?.id || isReminderCleared(reminder)) {
      if (profileShareNotifications[reminder?.id]?.source === 'access') delete profileShareNotifications[reminder.id];
      return;
    }
    const existing = profileShareNotifications[reminder.id];
    if (!existing || existing.source === 'access') {
      profileShareNotifications[reminder.id] = { ...reminder, read: isNotificationRead(reminder), source: 'access' };
    }
  });
}

function applyDirectSharedNote(docSnap) {
  const noteId = docSnap.id;
  const d = docSnap.data() || {};
  if (!d.owner || d.owner === userId) return;

  const sharedWith = d.sharedWith && typeof d.sharedWith === 'object' ? d.sharedWith : {};
  const sharedAccessKeys = Array.isArray(d.sharedAccessKeys) ? d.sharedAccessKeys : [];
  const access = directAccessForNote(noteId) || getSharedAccessEntry(sharedWith) || {};
  const shareTimestamp = access.lastSharedAt || access.sharedAt || '';
  const created = shareTimestamp || d.modified?.toDate?.()?.toISOString() || new Date().toISOString();
  if (!canReadLoadedSharedNote(noteId, d)) return;
  if (!sharedLibraryMeta[noteId] && _isSharedIdRemoved(noteId, shareTimestamp)) {
    delete notes[noteId];
    if (activeId === noteId) { clearActiveNoteBodyListener(); activeId = null; }
    return;
  }

  const type = access.type === 'mention' ? 'mention' : 'share';
  const folderId = _applySharedFolderFromData(noteId, access);

  notes[noteId] = noteFromFirestoreData(noteId, d, {
    folderId: folderId || _getSharedNoteFolder(noteId),
    pinnedAt: _getSharedNotePinnedAt(noteId),
    pinScope: _getSharedNotePinScope(noteId),
    directAccessRole: access.role || '',
    directAccess: access
  });

  _addSharedId(noteId);
  _subscribeSharedNote(noteId);

  if (!accessEntryHasNoteScope(access)) {
    const folderInfo = _sharedFolderInfoFromData(access);
    if (folderInfo?.sourceFolderId) {
      const notificationId = 'direct_folder_share_' + _safeDocFragment(folderInfo.sourceFolderId) + '_' + _safeDocFragment(access.fromUid || d.owner || '');
      const existing = profileShareNotifications[notificationId] || {};
      const noteIds = [...new Set([...(existing.noteIds || []), noteId])];
      profileShareNotifications[notificationId] = {
        ...existing,
        id: notificationId,
        type: 'folder_share',
        noteId: '',
        noteIds,
        noteTitle: '',
        fromUid: access.fromUid || d.owner || '',
        fromName: access.fromName || 'Someone',
        fromPhotoURL: access.fromPhotoURL || '',
        fromPhotoURLCandidates: access.fromPhotoURLCandidates || [],
        fromEmail: normalizeEmail(access.fromEmail || ''),
        sourceFolderId: folderInfo.sourceFolderId,
        sourceFolderTitle: folderInfo.title || 'Shared Folder',
        created: existing.created || created,
        readKey: notificationReadKeyForParts('folder_share', folderInfo.sourceFolderId, access.fromUid || d.owner || ''),
        read: false,
        source: 'direct'
      };
    }
    return;
  }

  const notificationId = 'direct_' + type + '_' + noteId;
  profileShareNotifications[notificationId] = {
    ...(profileShareNotifications[notificationId] || {}),
    id: notificationId,
    type,
    noteId,
    noteIds: [noteId],
    noteTitle: notes[noteId].title,
    fromUid: access.fromUid || d.owner || '',
    fromName: access.fromName || 'Someone',
    fromPhotoURL: access.fromPhotoURL || '',
    fromPhotoURLCandidates: access.fromPhotoURLCandidates || [],
    fromEmail: normalizeEmail(access.fromEmail || ''),
    created,
    readKey: notificationReadKeyForParts(type, noteId, access.fromUid || d.owner || ''),
    read: false,
    source: 'direct'
  };
}

function listenToProfileShares() {
  if (unsubProfileShares) unsubProfileShares();
  if (!userId) return;
  notificationsUnavailable = false;
  let activeSources = 0;
  let failedSources = 0;
  const inboxes = [collection(fsDb, 'profileShares', userId, 'items')];
  const email = normalizeEmail(currentProfile?.email || auth.currentUser?.email || '');
  if (email) inboxes.push(collection(fsDb, 'profileEmailShares', emailProfileDocId(email), 'items'));
  const emailKey = emailProfileKey(email);
  const directAccessKeys = [...new Set([userId, emailKey, email].filter(Boolean))];
  const directQueries = directAccessKeys.map(key => query(collection(fsDb, 'notes'), where('sharedAccessKeys', 'array-contains', key)));
  directQueries.push(query(collection(fsDb, 'notes'), where('sharedWith.' + userId + '.uid', '==', userId)));
  if (emailKey) directQueries.push(query(collection(fsDb, 'notes'), where('sharedWith.' + emailKey + '.email', '==', email)));
  const totalSources = inboxes.length + directQueries.length;

  const markSourceReady = () => {
    activeSources++;
    notificationsUnavailable = false;
  };

  const markSourceFailed = () => {
    failedSources++;
    if (!activeSources && failedSources >= totalSources) {
      notificationsUnavailable = true;
      profileShareNotifications = {};
      renderNotificationButton();
      renderAlarmButton();
      if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
      if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
      refreshOpenSidebarPage('notifications');
      refreshOpenSidebarPage('alarms');
    }
  };

  const applySnapshot = snap => {
    markSourceReady();
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        delete profileShareNotifications[id];
        return;
      }
      const data = ch.doc.data() || {};
      if (data.fromUid === userId) return;
      if (data.type === 'folder_share' || (!data.noteId && data.sourceFolderId)) {
        const item = normalizeProfileShareNotification(id, data);
        profileShareNotifications[id] = item;
        const noteIdsToAdd = item.noteIds.filter(noteId => sharedLibraryMeta[noteId] || !_isSharedIdRemoved(noteId, item.created));
        const localFolderId = noteIdsToAdd.length ? _ensureSharedFolderShell(_sharedFolderInfoFromData(data)) : null;
        noteIdsToAdd.forEach(noteId => {
          if (localFolderId) _placeSharedNoteInFolder(noteId, localFolderId);
          _addSharedId(noteId);
          _subscribeSharedNote(noteId);
        });
        return;
      }
      if (!data.noteId) return;
      const item = normalizeProfileShareNotification(id, data);
      profileShareNotifications[id] = item;
      if (!sharedLibraryMeta[data.noteId] && _isSharedIdRemoved(data.noteId, item.created)) return;
      const prevFolderId = _getSharedNoteFolder(data.noteId);
      const folderId = _applySharedFolderFromData(data.noteId, data);
      if (!sharedLibraryMeta[data.noteId] || (folderId && prevFolderId !== folderId)) _addSharedId(data.noteId);
      _subscribeSharedNote(data.noteId);
    });
    renderSidebar();
    renderNotificationButton();
    renderAlarmButton();
    if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
    if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
    refreshOpenSidebarPage('alarms');
  };

  const unsubs = inboxes.map(ref => onSnapshot(ref, applySnapshot, err => {
    console.warn('profile shares listener:', err);
    markSourceFailed();
  }));
  const directUnsubs = directQueries.map(ref => onSnapshot(ref, snap => {
    markSourceReady();
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') {
        const data = ch.doc.data() || {};
        const access = getSharedAccessEntry(normalizeSharedWith(data.sharedWith)) || {};
        const folderInfo = _sharedFolderInfoFromData(access);
        if (folderInfo?.sourceFolderId) {
          const folderNotificationId = 'direct_folder_share_' + _safeDocFragment(folderInfo.sourceFolderId) + '_' + _safeDocFragment(access.fromUid || data.owner || '');
          const existing = profileShareNotifications[folderNotificationId];
          if (existing?.noteIds?.length) {
            existing.noteIds = existing.noteIds.filter(noteId => noteId !== ch.doc.id);
            if (!existing.noteIds.length) delete profileShareNotifications[folderNotificationId];
          }
        }
        delete profileShareNotifications['direct_share_' + ch.doc.id];
        delete profileShareNotifications['direct_mention_' + ch.doc.id];
        return;
      }
      applyDirectSharedNote(ch.doc);
    });
    renderSidebar();
    renderNotificationButton();
    renderAlarmButton();
    if (!activeId && !(typeof shouldDeferInitialNoteFallback === 'function' && shouldDeferInitialNoteFallback())) {
      const sorted = sortedIds();
      sorted.length ? openNote(sorted[0]) : showEditorView(false);
    }
    if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
    if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
    refreshOpenSidebarPage('alarms');
  }, err => {
    console.warn('direct shared notes listener:', err);
    markSourceFailed();
  }));
  directShareUnsubs = directUnsubs;
  unsubProfileShares = () => {
    unsubs.forEach(fn => fn());
    directUnsubs.forEach(fn => fn());
    directShareUnsubs = [];
  };
}

function getNotificationItems() {
  const byReadKey = {};
  Object.values(profileShareNotifications).forEach(notification => {
    if (notification?.type === 'reminder' && isReminderCleared(notification)) return;
    const readKey = notification.readKey || notificationReadKeyForParts(notification.type, notificationTargetId(notification), notification.fromUid);
    const item = { ...notification, readKey, read: isNotificationRead({ ...notification, readKey }) };
    const existing = byReadKey[readKey];
    if (!existing || (existing.source === 'direct' && item.source === 'inbox') || new Date(item.created) > new Date(existing.created)) {
      byReadKey[readKey] = item;
    }
  });
  Object.values(profileLinkRequests).forEach(request => {
    if (request.status !== 'pending') return;
    const readKey = request.readKey || ('profile_link_' + request.id);
    byReadKey[readKey] = { ...request, readKey, read: isNotificationRead({ ...request, readKey }) };
  });
  Object.values(incomingFriendRequests).forEach(request => {
    if (request.status !== 'pending') return;
    const readKey = request.readKey || ('friend_request_' + request.id);
    byReadKey[readKey] = {
      ...request,
      fromName: request.fromDisplayName,
      fromPhotoURL: request.fromPhotoURL,
      type: 'friend_request',
      readKey,
      read: isNotificationRead({ ...request, readKey })
    };
  });
  return Object.values(byReadKey)
    .filter(item => !isNotificationDeleted(item))
    .sort((a, b) => new Date(b.created) - new Date(a.created));
}

function getMentionItems() {
  const byReadKey = {};
  getNotificationItems()
    .filter(item => ['mention', 'share', 'folder_share', 'conversation', 'conversation_like'].includes(item.type))
    .forEach(item => { byReadKey[item.readKey || item.id] = item; });

  Object.values(notes || {}).forEach(note => {
    if (!note?.id || isOwnedNote(note) || isTrashedNote(note)) return;
    const access = note.directAccess || directAccessForNote(note.id) || {};
    const type = Array.isArray(note.mentionedUids) && note.mentionedUids.includes(userId) ? 'mention' : 'share';
    const fromUid = access.fromUid || note.owner || '';
    const existingForNote = Object.values(byReadKey).some(item =>
      ['mention', 'share', 'folder_share'].includes(item.type) &&
      (item.noteId === note.id || (Array.isArray(item.noteIds) && item.noteIds.includes(note.id)))
    );
    if (existingForNote) return;
    const readKey = notificationReadKeyForParts(type, note.id, fromUid);
    if (byReadKey[readKey]) return;
    const fromPhotos = profilePhotoFields(access.fromPhotoURL, access.fromPhotoURLCandidates);
    const item = {
      id: 'local_' + type + '_' + _safeDocFragment(note.id),
      type,
      noteId: note.id,
      noteIds: [note.id],
      noteTitle: note.title || 'Untitled Note',
      fromUid,
      fromName: access.fromName || 'Someone',
      fromPhotoURL: fromPhotos.photoURL,
      fromPhotoURLCandidates: fromPhotos.photoURLCandidates,
      fromEmail: normalizeEmail(access.fromEmail || ''),
      created: access.lastSharedAt || access.sharedAt || note.modified || note.created || new Date().toISOString(),
      readKey,
      source: 'note'
    };
    if (isNotificationDeleted(item)) return;
    byReadKey[readKey] = { ...item, read: isNotificationRead(item) };
  });

  return Object.values(byReadKey)
    .sort((a, b) => new Date(b.created) - new Date(a.created));
}

function renderNotificationButton() {
  const unread = getNotificationItems().filter(n => !n.read).length;
  const label = unread > 99 ? '99+' : String(unread);
  ['notification-badge', 'mob-notification-badge'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = label;
    badge.hidden = unread === 0;
  });
  if (typeof notifyNotificationIndicatorsChanged === 'function') notifyNotificationIndicatorsChanged();
}

function notificationText(n) {
  if (n.type === 'friend_request') return n.fromDisplayName + ' sent you a friend request';
  if (n.type === 'profile_link') return n.fromName + ' wants to link profiles';
  if (n.type === 'folder_share') return n.fromName + ' shared folder "' + (n.sourceFolderTitle || 'Shared Folder') + '" with you';
  if (n.type === 'conversation') return n.fromName + ' replied in "' + (n.noteTitle || 'Untitled Note') + '"';
  if (n.type === 'conversation_like') return n.fromName + ' liked your message in "' + (n.noteTitle || 'Untitled Note') + '"';
  if (n.type === 'mention') return n.fromName + ' mentioned you in "' + n.noteTitle + '"';
  if (n.type === 'reminder') return n.fromName + ' set a reminder for "' + (n.reminderText || n.noteTitle || 'Reminder') + '"';
  return n.fromName + ' shared "' + n.noteTitle + '" with you';
}

function relativeNotificationTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 60000) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

function renderNotificationsList(target = 'notifications-list') {
  const list = typeof target === 'string' ? document.getElementById(target) : target;
  if (!list) return;
  const items = getNotificationItems();
  if (notificationsUnavailable) {
    list.innerHTML = '<div class="profile-empty">Notifications are unavailable right now. Direct sharing can still be retried after Firestore profile-share access is enabled.</div>';
    if (typeof attachSidebarSelectionHandlers === 'function') attachSidebarSelectionHandlers(list);
    return;
  }
  if (!items.length) {
    list.innerHTML = '<div class="profile-empty">No notifications yet. Mentions, shares, and conversation activity from friends will appear here.</div>';
    if (typeof attachSidebarSelectionHandlers === 'function') attachSidebarSelectionHandlers(list);
    return;
  }

  list.innerHTML = items.map(n =>
    '<div class="profile-row notification-row sidebar-selectable-row' + (n.read ? '' : ' unread') + '" data-notification-id="' + esc(n.id) + '">' +
      (typeof renderSidebarSelectionCheckbox === 'function' ? renderSidebarSelectionCheckbox(n.id, 'Select notification') : '') +
      renderProfileAvatar({ displayName: n.fromName, photoURL: n.fromPhotoURL, photoURLCandidates: n.fromPhotoURLCandidates || [] }) +
      '<div class="profile-main"><div class="profile-name">' + esc(notificationText(n)) + '</div><div class="notification-time">' + esc(relativeNotificationTime(n.created)) + '</div></div>' +
      (n.read ? '' : '<span class="profile-avatar" style="width:9px;height:9px;min-width:9px;background:var(--accent);padding:0;"></span>') +
    '</div>'
  ).join('');
  if (typeof attachSidebarSelectionHandlers === 'function') attachSidebarSelectionHandlers(list);

  list.querySelectorAll('[data-notification-id]').forEach(row => {
    row.addEventListener('click', () => openNotification(row.dataset.notificationId));
  });
}

async function markNotificationRead(id) {
  if (!id) return;
  const item = getMentionItems().find(n => n.id === id) || getNotificationItems().find(n => n.id === id) || profileShareNotifications[id];
  await persistNotificationReads(notificationReadKeys(item || { id }));
}

async function markAllNotificationsRead(ids = []) {
  const selected = new Set((ids || []).filter(Boolean));
  const unread = getNotificationItems().filter(n => selected.size ? selected.has(n.id) : !n.read);
  if (!unread.length) return;
  await persistNotificationReads(unread.flatMap(notificationReadKeys));
}

async function markNotificationsUnread(ids = []) {
  const selected = new Set((ids || []).filter(Boolean));
  if (!selected.size) {
    showToast('No Selected Notifications', 'success');
    return;
  }
  const targets = getNotificationItems().filter(n => selected.has(n.id));
  const readKeys = targets.flatMap(notificationReadKeys);
  if (!readKeys.length) {
    showToast('No Selected Notifications', 'success');
    return;
  }
  await persistNotificationUnreads(readKeys);
  showToast(targets.length === 1 ? 'Notification Marked Unread' : 'Notifications Marked Unread', 'success');
}

async function deleteReadNotifications(ids = []) {
  const selected = new Set((ids || []).filter(Boolean));
  const read = getNotificationItems().filter(n => selected.size ? selected.has(n.id) : n.read);
  if (!read.length) {
    showToast(selected.size ? 'No Selected Notifications' : 'No Read Notifications', 'success');
    return;
  }
  const commitDelete = async () => {
    const updates = {};
    read.forEach(item => {
      notificationReadKeys(item).forEach(key => {
        readNotifications[key] = true;
        updates[key] = true;
      });
      const deletedKey = notificationDeletedReadKey(item);
      if (deletedKey) {
        readNotifications[deletedKey] = true;
        updates[deletedKey] = true;
      }
    });

    _writeNotificationStateToLocal();
    renderNotificationButton();
    if (typeof renderConversationsSidebar === 'function') renderConversationsSidebar();
    if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
    refreshOpenSidebarPage('notifications');
    refreshOpenSidebarPage('conversations');

    try {
      await setDoc(_getUserDocRef(), { readNotifications: updates }, { merge: true });
      showToast(selected.size ? 'Notifications Deleted' : 'Read Notifications Deleted', 'success');
    } catch (err) {
      console.error('delete read notifications:', err);
      showToast('Deleted Locally; Sync Failed', 'error');
    }
  };
  if (typeof openDeleteConfirmationModal === 'function') {
    const conversationOnly = read.every(item => item.type === 'conversation' || item.type === 'conversation_like');
    const singular = conversationOnly ? 'Conversation Alert' : 'Notification';
    const plural = conversationOnly ? 'Conversation Alerts' : 'Notifications';
    openDeleteConfirmationModal({
      title: selected.size ? 'Delete Selected ' + plural + '?' : 'Delete Read ' + plural + '?',
      target: read.length === 1 ? notificationText(read[0]) : read.length + ' ' + plural,
      copy: (conversationOnly ? 'Deletes these conversation alerts.' : 'Deletes these notifications.') + ' Shared notes and conversations stay available.',
      confirmLabel: read.length === 1 ? 'Delete ' + singular : 'Delete ' + plural,
      onConfirm: commitDelete
    });
    return;
  }
  await commitDelete();
}

async function openNotification(id) {
  const item = profileShareNotifications[id] || getNotificationItems().find(n => n.id === id) || profileLinkRequests[id] || incomingFriendRequests[id];
  if (!item) return;
  document.getElementById('notifications-modal')?.classList.remove('open');
  if (item.type === 'friend_request') {
    setSidebarView('friends');
    await markNotificationRead(id);
    return;
  }
  if (item.type === 'profile_link') {
    openProfileLinkApproval(item);
    return;
  }
  let opened = false;
  if (item.type === 'folder_share') {
    opened = await openSharedFolderNotification(item);
  } else if (item.noteId) {
    if (notes[item.noteId]) {
      openNote(item.noteId);
      opened = true;
    } else {
      opened = await openDirectSharedNote(item.noteId);
    }
  }
  if (opened && (item.type === 'conversation' || item.type === 'conversation_like') && item.conversationId && typeof openConversationsSidebar === 'function') {
    openConversationsSidebar(item.conversationId);
  }
  if (opened) await markNotificationRead(id);
}

async function openSharedFolderNotification(item) {
  const sourceFolderId = item?.sourceFolderId || item?.folderId || '';
  if (!sourceFolderId) return false;
  const localFolderId = _ensureSharedFolderShell({
    sourceFolderId,
    title: item.sourceFolderTitle || 'Shared Folder',
    sourceOwnerUid: item.fromUid || '',
    sourceOwnerName: item.fromName || '',
    sourceOwnerPhotoURL: item.fromPhotoURL || '',
    sourceOwnerPhotoURLCandidates: item.fromPhotoURLCandidates || []
  });
  const noteIds = notificationNoteIds(item);
  noteIds.forEach(noteId => {
    if (localFolderId) _placeSharedNoteInFolder(noteId, localFolderId);
    _addSharedId(noteId);
    _subscribeSharedNote(noteId);
  });
  if (localFolderId) {
    expandedFolders.add(localFolderId);
    activeFolderId = localFolderId;
  }
  renderSidebar();
  const existingNoteId = noteIds.find(noteId => notes[noteId]);
  if (existingNoteId) {
    openNote(existingNoteId);
    return true;
  }
  for (const noteId of noteIds) {
    if (await openDirectSharedNote(noteId)) return true;
  }
  return !!localFolderId;
}

function openNotificationsModal() {
  setSidebarView('notifications');
}


function _subscribeSharedNote(noteId) {
  if (sharedNoteUnsubs[noteId]) return sharedNoteInitialLoads[noteId] || Promise.resolve(); // already watching
  let initialSettled = false;
  let resolveInitial;
  const initialLoad = new Promise(resolve => { resolveInitial = resolve; });
  sharedNoteInitialLoads[noteId] = initialLoad;
  const settleInitial = () => {
    if (initialSettled) return;
    initialSettled = true;
    if (sharedNoteInitialLoads[noteId] === initialLoad) delete sharedNoteInitialLoads[noteId];
    resolveInitial();
  };
  const ref = doc(fsDb, 'notes', noteId);
  sharedNoteUnsubs[noteId] = onSnapshot(ref, snap => {
    if (!snap.exists()) {
      // Note was deleted by the owner
      if (notes[noteId]?.owner !== userId) {
        delete notes[noteId];
        _removeSharedId(noteId);
        if (sharedNoteUnsubs[noteId]) { sharedNoteUnsubs[noteId](); delete sharedNoteUnsubs[noteId]; delete sharedNoteInitialLoads[noteId]; }
        if (activeId === noteId) { clearActiveNoteBodyListener(); activeId = null; }
        renderSidebar();
        if ((conversationsOpen || sidebarView === 'conversations') && typeof scheduleConversationOverviewRefresh === 'function') scheduleConversationOverviewRefresh();
        if (!activeId) { const ids = sortedIds(); ids.length ? openNote(ids[0]) : showEditorView(false); }
      }
      settleInitial();
      return;
    }
    const d = snap.data();
    if (d.owner === userId) { settleInitial(); return; } // owned note — handled by the main listener

    const sharedWith = d.sharedWith && typeof d.sharedWith === 'object' ? d.sharedWith : {};
    const sharedAccessKeys = Array.isArray(d.sharedAccessKeys) ? d.sharedAccessKeys : [];
    const access = directAccessForNote(noteId) || getSharedAccessEntry(sharedWith) || {};
    const folderId = _applySharedFolderFromData(noteId, access);

    // If the owner stopped sharing, remove the note from this user's library
    if (!canReadLoadedSharedNote(noteId, d)) {
      delete notes[noteId];
      _removeSharedId(noteId);
      if (sharedNoteUnsubs[noteId]) { sharedNoteUnsubs[noteId](); delete sharedNoteUnsubs[noteId]; delete sharedNoteInitialLoads[noteId]; }
      if (activeId === noteId) { clearActiveNoteBodyListener(); activeId = null; }
      renderSidebar();
      if ((conversationsOpen || sidebarView === 'conversations') && typeof scheduleConversationOverviewRefresh === 'function') scheduleConversationOverviewRefresh();
      if (!activeId) { const ids = sortedIds(); ids.length ? openNote(ids[0]) : showEditorView(false); }
      showToast('A shared note is no longer available', 'error');
      settleInitial();
      return;
    }

    const legacyContent = typeof d.content === 'string' ? d.content : null;
    const prevContent = notes[noteId]?._bodyLoaded ? notes[noteId].content : undefined;
    notes[noteId] = noteFromFirestoreData(noteId, d, {
      folderId: folderId || _getSharedNoteFolder(noteId),
      pinnedAt: _getSharedNotePinnedAt(noteId),
      pinScope: _getSharedNotePinScope(noteId),
      directAccessRole: access.role || '',
      directAccess: access
    });

    renderSidebar();
    window.dispatchEvent(new CustomEvent('notas:notes-updated'));
    if ((conversationsOpen || sidebarView === 'conversations') && typeof scheduleConversationOverviewRefresh === 'function') scheduleConversationOverviewRefresh();

    // If this note is currently open and the editor is idle, sync it
    if (activeId === noteId && legacyContent !== null && prevContent !== undefined && prevContent !== legacyContent) {
      const ed = getEd();
      const titleEl = document.getElementById('doc-title');
      if (document.activeElement !== ed && document.activeElement !== titleEl) {
        titleEl.value = d.title || 'Untitled Note';
        if (typeof applyRemoteNoteBodyContent === 'function') applyRemoteNoteBodyContent(noteId, legacyContent);
      }
    }
    settleInitial();
  }, err => {
    console.error('shared note listener:', err);
    // Treat permission-denied as access revoked
    if (err.code === 'permission-denied') {
      delete notes[noteId];
      _removeSharedId(noteId);
      if (sharedNoteUnsubs[noteId]) { sharedNoteUnsubs[noteId](); delete sharedNoteUnsubs[noteId]; delete sharedNoteInitialLoads[noteId]; }
      if (activeId === noteId) { clearActiveNoteBodyListener(); activeId = null; }
      renderSidebar();
      if ((conversationsOpen || sidebarView === 'conversations') && typeof scheduleConversationOverviewRefresh === 'function') scheduleConversationOverviewRefresh();
      if (!activeId) { const ids = sortedIds(); ids.length ? openNote(ids[0]) : showEditorView(false); }
    }
    settleInitial();
  });
  return initialLoad;
}

// Listen to the user doc for shared note IDs — syncs across devices.
function listenToSharedNotes() {
  if (unsubUserDoc) unsubUserDoc();
  let initialSettled = false;
  let resolveInitial;
  const initialLoad = new Promise(resolve => { resolveInitial = resolve; });
  const settleInitial = loads => {
    if (initialSettled) return;
    initialSettled = true;
    Promise.all(loads || []).catch(() => {}).then(resolveInitial);
  };
  const localLoads = [];
  const localMeta = _readSharedLibraryFromLocal();
  if (Object.keys(localMeta).length) {
    _applySharedLibraryMeta(_mergeSharedLibraries(sharedLibraryMeta, localMeta));
    localLoads.push(_syncSharedSubscriptions(Object.keys(sharedLibraryMeta)));
  }
  unsubUserDoc = onSnapshot(_getUserDocRef(), snap => {
    const data = snap.data() || {};
    applyUserProfileData(data);
    const rawRemoteMeta = _readSharedLibraryFromRemote(data);
    const remoteMeta = _filterRemovedSharedLibraryMeta(rawRemoteMeta);
    const latestLocalMeta = _readSharedLibraryFromLocal();
    const nextMeta = _mergeSharedLibraries(latestLocalMeta, remoteMeta);
    const ids = Object.keys(nextMeta);
    _applySharedLibraryMeta(nextMeta);
    const remoteLoad = _syncSharedSubscriptions(ids);
    const hasLocalOnlyIds = Object.keys(latestLocalMeta).some(id => !remoteMeta[id]);
    if (hasLocalOnlyIds) {
      const localOnlyMeta = {};
      Object.keys(latestLocalMeta).forEach(id => { if (!remoteMeta[id]) localOnlyMeta[id] = latestLocalMeta[id]; });
      _syncSharedLibraryToCloud(localOnlyMeta);
    }
    Object.keys(rawRemoteMeta).forEach(id => {
      if (_isSharedIdRemoved(id)) _removeSharedId(id).catch(err => console.error('retry removed shared note cleanup:', err));
    });
    renderSidebar();
    if (!activeId && !(typeof shouldDeferInitialNoteFallback === 'function' && shouldDeferInitialNoteFallback())) {
      const sorted = sortedIds();
      sorted.length ? openNote(sorted[0]) : showEditorView(false);
    }
    settleInitial([remoteLoad]);
  }, err => {
    console.error('user doc listener:', err);
    const fallbackLoads = [...localLoads];
    const fallbackMeta = _readSharedLibraryFromLocal();
    if (Object.keys(fallbackMeta).length) {
      _applySharedLibraryMeta(fallbackMeta);
      fallbackLoads.push(_syncSharedSubscriptions(Object.keys(sharedLibraryMeta)));
      renderSidebar();
      if (!activeId && !(typeof shouldDeferInitialNoteFallback === 'function' && shouldDeferInitialNoteFallback())) {
        const sorted = sortedIds();
        sorted.length ? openNote(sorted[0]) : showEditorView(false);
      }
    }
    settleInitial(fallbackLoads);
  });
  return initialLoad;
}

// Called when the user opens a ?note=<id> link.
// Loads the note, populates it immediately, subscribes for future real-time
// updates, stores the ID in localStorage, then navigates to it.
async function handleShareLink(noteId) {
  try {
    const snap = await getDoc(doc(fsDb, 'notes', noteId));
    if (!snap.exists()) {
      showToast('This shared note is no longer available', 'error');
      window.history.replaceState({}, '', location.pathname);
      return;
    }
    const d = snap.data();
    const accessSnap = await getDoc(doc(fsDb, 'noteAccess', noteAccessDocId(noteId, userId))).catch(() => null);
    if (accessSnap?.exists?.()) {
      const accessDoc = normalizeNoteAccess(accessSnap.id, accessSnap.data() || {});
      noteAccessById[accessSnap.id] = accessDoc;
      myNoteAccessByNote[noteId] = accessDoc;
      rebuildNoteAccessGroups();
    }
    const sharedWith = d.sharedWith && typeof d.sharedWith === 'object' ? d.sharedWith : {};
    const sharedAccessKeys = Array.isArray(d.sharedAccessKeys) ? d.sharedAccessKeys : [];
    const sharedAccess = directAccessForNote(noteId) || getSharedAccessEntry(sharedWith) || {};
    if (!canReadLoadedSharedNote(noteId, d)) {
      showToast('This shared note is no longer available', 'error');
      window.history.replaceState({}, '', location.pathname);
      return;
    }
    // Own note — already in the main listener, just navigate to it
    if (d.owner === userId) {
      window.history.replaceState({}, '', location.pathname);
      if (notes[noteId]) openNote(noteId);
      return;
    }
    // Populate the note immediately from the data we just fetched
    notes[noteId] = noteFromFirestoreData(noteId, d, {
      folderId: _applySharedFolderFromData(noteId, sharedAccess) || _getSharedNoteFolder(noteId),
      pinnedAt: _getSharedNotePinnedAt(noteId),
      pinScope: _getSharedNotePinScope(noteId),
      directAccessRole: sharedAccess.role || '',
      directAccess: sharedAccess
    });
    // Persist and subscribe for real-time edits going forward
    const syncedToCloud = await _addSharedId(noteId);
    _subscribeSharedNote(noteId);
    window.history.replaceState({}, '', location.pathname);
    // Navigate right away — no timeout needed
    renderSidebar();
    openNote(noteId);
    showToast(syncedToCloud ? 'Note added to your library' : 'Note added locally; cloud sync failed', syncedToCloud ? 'success' : 'error');
  } catch (err) {
    console.error('handleShareLink:', err);
    showToast('Could not access this shared note', 'error');
    window.history.replaceState({}, '', location.pathname);
  }
}

async function openDirectSharedNote(noteId) {
  try {
    const snap = await getDoc(doc(fsDb, 'notes', noteId));
    if (!snap.exists()) {
      showToast('This shared note is no longer available', 'error');
      return false;
    }
    const d = snap.data();
    if (d.owner === userId) {
      if (notes[noteId]) openNote(noteId);
      return !!notes[noteId];
    }
    const accessSnap = await getDoc(doc(fsDb, 'noteAccess', noteAccessDocId(noteId, userId))).catch(() => null);
    if (accessSnap?.exists?.()) {
      const accessDoc = normalizeNoteAccess(accessSnap.id, accessSnap.data() || {});
      noteAccessById[accessSnap.id] = accessDoc;
      myNoteAccessByNote[noteId] = accessDoc;
      rebuildNoteAccessGroups();
    }
    const sharedWith = d.sharedWith && typeof d.sharedWith === 'object' ? d.sharedWith : {};
    const sharedAccessKeys = Array.isArray(d.sharedAccessKeys) ? d.sharedAccessKeys : [];
    const sharedAccess = directAccessForNote(noteId) || getSharedAccessEntry(sharedWith) || {};
    if (!canReadLoadedSharedNote(noteId, d)) {
      showToast('This shared note is no longer available', 'error');
      return false;
    }

    notes[noteId] = noteFromFirestoreData(noteId, d, {
      folderId: _applySharedFolderFromData(noteId, sharedAccess) || _getSharedNoteFolder(noteId),
      pinnedAt: _getSharedNotePinnedAt(noteId),
      pinScope: _getSharedNotePinScope(noteId),
      directAccessRole: sharedAccess.role || '',
      directAccess: sharedAccess
    });
    await _addSharedId(noteId);
    _subscribeSharedNote(noteId);
    renderSidebar();
    openNote(noteId);
    return true;
  } catch (err) {
    console.error('open direct shared note:', err);
    showToast('Could not access this shared note', 'error');
    return false;
  }
}

// Remove a shared note from the user's library without deleting it from Firestore.
async function removeFromLibrary(noteId, options = {}) {
  const { render = true, selectNext = true, notify = true } = options;
  if (notes[noteId]?.owner === userId) return; // can't remove owned notes this way
  if (sharedNoteUnsubs[noteId]) { sharedNoteUnsubs[noteId](); delete sharedNoteUnsubs[noteId]; delete sharedNoteInitialLoads[noteId]; }
  delete notes[noteId];
  const cloudSynced = await _removeSharedId(noteId, { removedByUser: true });
  if (activeId === noteId) { clearActiveNoteBodyListener(); activeId = null; }
  if (render) renderSidebar();
  if (selectNext && !activeId) { const ids = sortedIds(); ids.length ? openNote(ids[0]) : showEditorView(false); }
  if (notify) showToast(cloudSynced ? 'Removed From Library' : 'Removed locally; cloud sync failed', cloudSynced ? 'success' : 'error');
  return cloudSynced;
}

async function getImportableSharedFolderNotes(folderId) {
  const byId = {};
  const queries = [
    query(collection(fsDb, 'notes'), where('folderId', '==', folderId), where('public', '==', true)),
    query(collection(fsDb, 'notes'), where('publicFolderIds', 'array-contains', folderId))
  ];
  let succeeded = false;
  let lastErr = null;
  for (const qRef of queries) {
    try {
      const snap = await getDocs(qRef);
      succeeded = true;
      snap.forEach(noteSnap => { byId[noteSnap.id] = noteSnap; });
    } catch (err) {
      lastErr = err;
      console.warn('shared folder notes query:', err);
    }
  }
  if (!succeeded && lastErr) throw lastErr;
  return Object.values(byId);
}

// Folder sharing: create a recipient-local folder shell, then subscribe to each note.
async function importSharedFolder(folderId) {
  try {
    const folderSnap = await getDoc(doc(fsDb, 'folders', folderId));
    const folderData = folderSnap.data() || {};
    if (!folderSnap.exists() || !folderData.public) {
      showToast('Shared folder is no longer available', 'error');
      window.history.replaceState({}, '', location.pathname);
      return;
    }
    if (folderData.owner === userId) { window.history.replaceState({}, '', location.pathname); return; }
    const localFolderId = _ensureSharedFolderShell({
      sourceFolderId: folderId,
      title: folderData.title || 'Shared Folder',
      sourceOwnerUid: folderData.owner || ''
    });
    const noteDocs = await getImportableSharedFolderNotes(folderId);
    let added = 0;
    let firstAddedId = '';
    const persistJobs = [];
    noteDocs.forEach(noteSnap => {
      const data = noteSnap.data() || {};
      const folderPublic = normalizePublicFolderIds(data.publicFolderIds).includes(folderId) ||
        (data.folderId === folderId && noteLinkPublicFromData(data));
      if (data.owner !== userId && folderPublic) {
        if (localFolderId) _placeSharedNoteInFolder(noteSnap.id, localFolderId);
        notes[noteSnap.id] = noteFromFirestoreData(noteSnap.id, data, {
          folderId: localFolderId || _getSharedNoteFolder(noteSnap.id),
          pinnedAt: _getSharedNotePinnedAt(noteSnap.id),
          pinScope: _getSharedNotePinScope(noteSnap.id)
        });
        persistJobs.push(_addSharedId(noteSnap.id));
        _subscribeSharedNote(noteSnap.id);
        if (!firstAddedId) firstAddedId = noteSnap.id;
        added++;
      }
    });
    await Promise.all(persistJobs);
    window.history.replaceState({}, '', location.pathname);
    renderSidebar();
    if (firstAddedId) openNote(firstAddedId);
    if (added) showToast('Folder notes added to your library!', 'success');
    else showToast('Folder added to your library!', 'success');
  } catch (err) {
    console.error('importSharedFolder:', err);
    showToast('Could not access shared folder', 'error');
    window.history.replaceState({}, '', location.pathname);
  }
}
