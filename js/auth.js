/* Authentication and auth-state lifecycle. */
function closeTransientSurfaces() {
  [
    'shortcuts-modal',
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
  if (typeof hideConversationSelectionPopover === 'function') hideConversationSelectionPopover();
  if (typeof closeConversationsSidebar === 'function') closeConversationsSidebar();
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
  if (typeof resetAppNavigationState === 'function') resetAppNavigationState();
  activeFolderId = null;
  sidebarView = 'notes';
  sidebarFilter = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  renderSidebar();
  showEditorView(false);
  window.dispatchEvent(new CustomEvent('notas:home-prepared'));
}

function showLoadingOverlay() {
  const loadingEl = document.getElementById('loading-overlay');
  if (!loadingEl) return;
  loadingEl.style.display = 'flex';
  loadingEl.style.opacity = '1';
}

function hideLoadingOverlay() {
  const loadingEl = document.getElementById('loading-overlay');
  if (!loadingEl) return;
  loadingEl.style.opacity = '0';
  setTimeout(() => {
    if (loadingEl.style.opacity === '0') loadingEl.style.display = 'none';
  }, 300);
}

function isDesktopWarmNoteShell() {
  if (!window.desktop?.isElectron) return false;
  const params = new URLSearchParams(location.search);
  return params.get('desktopWindow') === 'note' && params.get('desktopWarm') === '1';
}

const TEST_PASSWORD_AUTH_DOMAIN = 'test.notas.local';

function envValue(key) {
  const env = window.__env || {};
  return Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
}

function booleanEnv(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function configuredBooleanEnv(key) {
  const value = envValue(key);
  return value === undefined ? null : booleanEnv(value);
}

function isLocalTestAuthHost() {
  if (window.desktop?.isElectron) return false;
  const host = location.hostname;
  return location.protocol === 'file:' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost');
}

function isTestPasswordAuthEnabled() {
  const explicit = configuredBooleanEnv('NOTAS_ENABLE_TEST_PASSWORD_AUTH');
  if (explicit !== null) return explicit;
  const legacy = configuredBooleanEnv('ENABLE_TEST_PASSWORD_AUTH');
  if (legacy !== null) return legacy;
  return isLocalTestAuthHost();
}

function testPasswordAuthDomain() {
  const configured = String(envValue('NOTAS_TEST_PASSWORD_AUTH_DOMAIN') || '').trim().toLowerCase();
  const validDomain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  return validDomain.test(configured) ? configured : TEST_PASSWORD_AUTH_DOMAIN;
}

function testPasswordAuthProfileFromName(name) {
  const displayName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const slug = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48);
  if (!displayName || !slug) return null;
  return {
    displayName,
    email: slug + '@' + testPasswordAuthDomain()
  };
}

function setAuthError(message) {
  const err = document.getElementById('auth-error');
  if (!err) return;
  err.textContent = message || '';
  err.style.display = message ? '' : 'none';
}

function setAuthControlsDisabled(disabled) {
  const googleBtn = document.getElementById('google-signin-btn');
  const testBtn = document.getElementById('test-password-signin-btn');
  if (googleBtn) googleBtn.disabled = disabled;
  if (testBtn) testBtn.disabled = disabled;
}

function testPasswordAuthErrorMessage(err) {
  if (err?.code === 'notas/test-password-mismatch') {
    return 'That test name already exists. Check the password.';
  }
  if (err?.code === 'auth/operation-not-allowed') {
    return 'Password sign-in is not enabled for this Firebase project.';
  }
  if (err?.code === 'auth/weak-password') {
    return 'Use at least 6 characters for the test password.';
  }
  if (err?.code === 'auth/too-many-requests') {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (err?.code === 'auth/network-request-failed') {
    return 'Could not reach Firebase. Check the connection and try again.';
  }
  return err?.message || err?.code || 'Could not sign in.';
}

function configureTestPasswordAuthUI() {
  const form = document.getElementById('test-password-signin-form');
  if (!form) return;
  const enabled = isTestPasswordAuthEnabled();
  form.hidden = !enabled;
  if (!enabled) return;

  const nameInput = document.getElementById('test-password-name');
  const hint = document.getElementById('test-password-email-hint');
  const updateHint = () => {
    if (!hint) return;
    const profile = testPasswordAuthProfileFromName(nameInput?.value || '');
    hint.textContent = profile ? 'Share to ' + profile.email : 'Shareable email appears here';
  };

  if (!form.dataset.configured) {
    nameInput?.addEventListener('input', updateHint);
    form.dataset.configured = 'true';
  }
  updateHint();
}

async function authenticateTestPasswordUser(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (signInErr) {
    if (!['auth/user-not-found', 'auth/invalid-credential'].includes(signInErr?.code)) {
      throw signInErr;
    }
    try {
      return await createUserWithEmailAndPassword(auth, email, password);
    } catch (createErr) {
      if (createErr?.code === 'auth/email-already-in-use') {
        const err = new Error('Test password mismatch');
        err.code = 'notas/test-password-mismatch';
        throw err;
      }
      throw createErr;
    }
  }
}

/* Auth */
onAuthStateChanged(auth, async user => {
  const overlay = document.getElementById('auth-overlay');
  if (user) {
    showLoadingOverlay();
    try {
      userId = user.uid;
      prepareAuthenticatedHome();
      if (typeof beginInitialNoteRestore === 'function') beginInitialNoteRestore();
      overlay.style.display = 'none';
      updateUserAvatar(user);
      const signoutRow = document.getElementById('signout-row');
      if (signoutRow) signoutRow.style.display = '';
      await migrateFromLocalStorage();
      await ensureProfileDocument(user);
      linkedProfiles = _readLinkedProfilesFromLocal();
      removedSharedNoteIds = _readRemovedSharedIdsFromLocal();
      renderProfileConnectionUI();
      renderShareProfileList();
      const initialNotesLoad = listenToNotes();
      const initialFoldersLoad = listenToFolders();
      const initialSharedLibraryLoad = listenToSharedNotes();
      listenFriends();
      listenIncomingFriendRequests();
      listenSentFriendRequests();
      listenToProfileLinkRequests();
      listenToProfileShares();
      listenOwnedNoteAccess();
      if (typeof listenToAllConversations === 'function') listenToAllConversations();
      const initialSharedWithMeLoad = listenSharedWithMe();
      _flushOfflineEdits();
      if (_sharedNoteId)   handleShareLink(_sharedNoteId);
      if (_sharedFolderId) importSharedFolder(_sharedFolderId);
      await Promise.all([initialNotesLoad, initialFoldersLoad, initialSharedLibraryLoad, initialSharedWithMeLoad]);
      if (!isDesktopWarmNoteShell() && typeof openInitialNoteOrFirst === 'function') openInitialNoteOrFirst();
    } catch (err) {
      console.error('auth state startup:', err);
      showToast('Could Not Finish Loading Notes', 'error');
    } finally {
      hideLoadingOverlay();
    }
  } else {
    closeTransientSurfaces();
    overlay.style.display = 'flex';
    setAuthControlsDisabled(false);
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
    if (typeof clearActiveNoteBodyListener === 'function') clearActiveNoteBodyListener();
    if (typeof clearConversationState === 'function') clearConversationState({ close: true });
    directShareUnsubs.forEach(fn => fn());
    directShareUnsubs = [];
    Object.values(sharedNoteUnsubs).forEach(fn => fn());
    sharedNoteUnsubs = {};
    sharedNoteInitialLoads = {};
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
    sentReminders = {};
    profileShareNotifications = {};
    notificationsUnavailable = false;
    noteConversations = {};
    allConversations = {};
    conversationMessages = {};
    conversationMessageUnsubs = {};
    unsubNoteConversations = null;
    activeNoteBodyUnsub = null;
    activeNoteBodyListeningId = null;
    activeNoteBodyRequestSeq = 0;
    legacyBodyMigrationIds = new Set();
    activeConversationId = null;
    conversationsOpen = false;
    conversationComposeAnchor = null;
    conversationListeningNoteId = null;
    _processingProfileLinkResponses = new Set();
    _processingAcceptedFriendRequests = new Set();
    _sendingFriendRequests = new Set();
    declinedMentionShares = new Set();
    notes = {}; folders = {}; activeId = null; activeFolderId = null; sidebarView = 'notes'; sidebarFilter = '';
    initialNoteRestoreId = '';
    initialNoteRestorePending = false;
    if (typeof resetAppNavigationState === 'function') resetAppNavigationState();
    showEditorView(false);
    renderSidebar();
    window.dispatchEvent(new CustomEvent('notas:notes-updated'));
    renderNotificationButton();
    renderAlarmButton();
    renderProfileConnectionUI();
    renderProfileLinkRequestsUI();
    hideLoadingOverlay();
  }
});

async function signInWithGoogle() {
  setAuthControlsDisabled(true);
  setAuthError('');
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('signInWithPopup:', e);
    setAuthError(e.message || e.code);
    setAuthControlsDisabled(false);
  }
}

async function signInWithTestPassword(event) {
  event?.preventDefault();
  setAuthError('');
  if (!isTestPasswordAuthEnabled()) {
    setAuthError('Test sign-in is only available in local development.');
    return;
  }

  const nameInput = document.getElementById('test-password-name');
  const passwordInput = document.getElementById('test-password-password');
  const profile = testPasswordAuthProfileFromName(nameInput?.value || '');
  const password = passwordInput?.value || '';

  if (!profile) {
    setAuthError('Enter a test name.');
    nameInput?.focus();
    return;
  }
  if (password.length < 6) {
    setAuthError('Use at least 6 characters for the test password.');
    passwordInput?.focus();
    return;
  }

  setAuthControlsDisabled(true);
  try {
    const credential = await authenticateTestPasswordUser(profile.email, password);
    if (credential?.user && credential.user.displayName !== profile.displayName) {
      try {
        await updateProfile(credential.user, { displayName: profile.displayName });
      } catch (profileErr) {
        console.warn('update test auth profile:', profileErr);
      }
    }
    if (credential?.user && userId === credential.user.uid && typeof ensureProfileDocument === 'function') {
      await ensureProfileDocument(credential.user);
    }
    if (passwordInput) passwordInput.value = '';
  } catch (err) {
    console.error('signInWithTestPassword:', err);
    setAuthError(testPasswordAuthErrorMessage(err));
    setAuthControlsDisabled(false);
  }
}

/* Profiles */
