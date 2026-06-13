/* Authentication and auth-state lifecycle - extracted from index.original.html. */
function closeTransientSurfaces() {
  [
    'settings-modal',
    'profile-link-modal',
    'share-modal',
    'notifications-modal',
    'alarms-modal',
    'note-alarm-modal',
    'mention-share-modal',
    'modal',
    'folder-modal',
    'delete-modal',
    'move-modal',
    'link-modal'
  ].forEach(id => document.getElementById(id)?.classList.remove('open'));
  document.getElementById('color-popover')?.setAttribute('hidden', '');
  if (typeof closeCtxMenu === 'function') closeCtxMenu();
  if (typeof hideMentionPopover === 'function') hideMentionPopover();
  _pendingProfileLink = null;
  _alarmNoteId = null;
  _alarmContext = null;
  document.getElementById('app-rail')?.classList.remove('open');
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('drawer-overlay')?.classList.remove('open');
  if (typeof updateMobileSidebarToggleLabel === 'function') updateMobileSidebarToggleLabel(false);
  if (_mentionShareResolver) {
    const resolve = _mentionShareResolver;
    _mentionShareResolver = null;
    resolve(false);
  }
}

function prepareAuthenticatedHome() {
  closeTransientSurfaces();
  activeFolderId = null;
  sidebarView = 'notes';
  sidebarFilter = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  renderSidebar();
  showEditorView(false);
}

/* Auth */
onAuthStateChanged(auth, async user => {
  const loadingEl = document.getElementById('loading-overlay');
  if (loadingEl) { loadingEl.style.opacity = '0'; setTimeout(() => { loadingEl.style.display = 'none'; }, 300); }
  const overlay = document.getElementById('auth-overlay');
  if (user) {
    userId = user.uid;
    prepareAuthenticatedHome();
    overlay.style.display = 'none';
    updateUserAvatar(user);
    const signoutRow = document.getElementById('signout-row');
    if (signoutRow) signoutRow.style.display = '';
    migrateFromLocalStorage();
    await ensureProfileDocument(user);
    linkedProfiles = _readLinkedProfilesFromLocal();
    removedSharedNoteIds = _readRemovedSharedIdsFromLocal();
    renderProfileConnectionUI();
    renderShareProfileList();
    listenToNotes();
    listenToFolders();
    listenToSharedNotes();
    listenFriends();
    listenIncomingFriendRequests();
    listenSentFriendRequests();
    listenOwnedNoteAccess();
    listenSharedWithMe();
    _flushOfflineEdits();
    if (_sharedNoteId)   handleShareLink(_sharedNoteId);
    if (_sharedFolderId) importSharedFolder(_sharedFolderId);
  } else {
    closeTransientSurfaces();
    overlay.style.display = 'flex';
    const signInBtn = document.getElementById('google-signin-btn');
    if (signInBtn) signInBtn.disabled = false;
    const av = document.getElementById('user-avatar');
    av?.removeAttribute('src');
    if (av) av.style.display = 'none';
    const signoutRow = document.getElementById('signout-row');
    if (signoutRow) signoutRow.style.display = 'none';
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (unsubFolders) { unsubFolders(); unsubFolders = null; }
    if (unsubUserDoc) { unsubUserDoc(); unsubUserDoc = null; }
    if (unsubProfileShares) { unsubProfileShares(); unsubProfileShares = null; }
    if (unsubProfileLinkRequests) { unsubProfileLinkRequests(); unsubProfileLinkRequests = null; }
    if (unsubFriends) { unsubFriends(); unsubFriends = null; }
    if (unsubIncomingFriendRequests) { unsubIncomingFriendRequests(); unsubIncomingFriendRequests = null; }
    if (unsubSentFriendRequests) { unsubSentFriendRequests(); unsubSentFriendRequests = null; }
    if (unsubOwnedNoteAccess) { unsubOwnedNoteAccess(); unsubOwnedNoteAccess = null; }
    if (unsubSharedWithMe) { unsubSharedWithMe(); unsubSharedWithMe = null; }
    directShareUnsubs.forEach(fn => fn());
    directShareUnsubs = [];
    Object.values(sharedNoteUnsubs).forEach(fn => fn());
    sharedNoteUnsubs = {};
    sharedLibraryMeta = {};
    removedSharedNoteIds = {};
    currentProfile = null;
    linkedProfiles = {};
    friends = {};
    incomingFriendRequests = {};
    sentFriendRequests = {};
    noteAccessByNote = {};
    noteAccessById = {};
    myNoteAccessByNote = {};
    profileLinkRequests = {};
    profileLinkRequestSources = {};
    readNotifications = {};
    noteAlarms = {};
    profileShareNotifications = {};
    notificationsUnavailable = false;
    _processingProfileLinkResponses = new Set();
    _processingAcceptedFriendRequests = new Set();
    _sendingFriendRequests = new Set();
    declinedMentionShares = new Set();
    notes = {}; folders = {}; activeId = null; activeFolderId = null; sidebarView = 'notes'; sidebarFilter = '';
    showEditorView(false);
    renderSidebar();
    renderNotificationButton();
    renderAlarmButton();
    renderProfileConnectionUI();
    renderProfileLinkRequestsUI();
  }
});

async function signInWithGoogle() {
  const btn = document.getElementById('google-signin-btn');
  const err = document.getElementById('auth-error');
  btn.disabled = true; err.style.display = 'none';
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    console.error('signInWithPopup:', e);
    err.textContent = e.message || e.code;
    err.style.display = ''; btn.disabled = false;
  }
}

/* Profiles */
