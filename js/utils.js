/* Utility and profile normalization helpers for the modular Notas app. */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function emailProfileDocId(email) {
  return encodeURIComponent(normalizeEmail(email)).replace(/\./g, '%2E');
}

function emailProfileKey(email) {
  const id = emailProfileDocId(email);
  return id ? 'email_' + id : '';
}

function _linkedProfilesStorageKey() {
  return 'notas_linked_profiles_' + userId;
}

function _notificationStateStorageKey() {
  return 'notas_read_notifications_' + userId;
}

function _noteAlarmsStorageKey() {
  return 'notas_note_alarms_' + userId;
}

function _sentRemindersStorageKey() {
  return 'notas_sent_reminders_' + userId;
}

function _readLinkedProfilesFromLocal() {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(_linkedProfilesStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('read linked profiles local:', err);
    return {};
  }
}

function _writeLinkedProfilesToLocal() {
  if (!userId) return;
  try {
    const keys = Object.keys(linkedProfiles);
    if (keys.length) localStorage.setItem(_linkedProfilesStorageKey(), JSON.stringify(linkedProfiles));
    else localStorage.removeItem(_linkedProfilesStorageKey());
  } catch (err) {
    console.error('write linked profiles local:', err);
  }
}

function _readNotificationStateFromLocal() {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(_notificationStateStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('read notification local:', err);
    return {};
  }
}

function _writeNotificationStateToLocal() {
  if (!userId) return;
  try {
    const keys = Object.keys(readNotifications).filter(key => readNotifications[key]);
    if (keys.length) localStorage.setItem(_notificationStateStorageKey(), JSON.stringify(keys.reduce((acc, key) => {
      acc[key] = true;
      return acc;
    }, {})));
    else localStorage.removeItem(_notificationStateStorageKey());
  } catch (err) {
    console.error('write notification local:', err);
  }
}

function _mergeNotificationState(...states) {
  const out = {};
  states.forEach(state => {
    Object.keys(state || {}).forEach(id => { if (state[id]) out[id] = true; });
  });
  return out;
}

function normalizeAlarmAt(value) {
  if (!value) return '';
  const date = value?.toDate?.() || new Date(value);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function _readNoteAlarmsFromLocal() {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(_noteAlarmsStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    const out = {};
    Object.keys(parsed || {}).forEach(id => {
      const alarmAt = normalizeAlarmAt(parsed[id]);
      if (alarmAt) out[id] = alarmAt;
    });
    return out;
  } catch (err) {
    console.error('read note alarms local:', err);
    return {};
  }
}

function _writeNoteAlarmsToLocal() {
  if (!userId) return;
  try {
    const keys = Object.keys(noteAlarms).filter(id => normalizeAlarmAt(noteAlarms[id]));
    if (keys.length) localStorage.setItem(_noteAlarmsStorageKey(), JSON.stringify(keys.reduce((acc, id) => {
      acc[id] = normalizeAlarmAt(noteAlarms[id]);
      return acc;
    }, {})));
    else localStorage.removeItem(_noteAlarmsStorageKey());
  } catch (err) {
    console.error('write note alarms local:', err);
  }
}

function _readNoteAlarms(data) {
  const raw = data?.noteAlarms && typeof data.noteAlarms === 'object' ? data.noteAlarms : {};
  const out = {};
  Object.keys(raw).forEach(id => {
    const alarmAt = normalizeAlarmAt(raw[id]);
    if (alarmAt) out[id] = alarmAt;
  });
  return out;
}

function _mergeNoteAlarms(...states) {
  const out = {};
  states.forEach(state => {
    Object.keys(state || {}).forEach(id => {
      const alarmAt = normalizeAlarmAt(state[id]);
      if (!alarmAt) return;
      if (!out[id] || new Date(alarmAt) > new Date(out[id])) out[id] = alarmAt;
    });
  });
  return out;
}

function normalizeSentReminder(id, data = {}) {
  if (!data || typeof data !== 'object') return null;
  const reminderAt = normalizeAlarmAt(data.reminderAt || data.alarmAt);
  if (!reminderAt) return null;
  const createdDate = data.created?.toDate?.() || (data.createdIso ? new Date(data.createdIso) : null);
  const created = createdDate instanceof Date && Number.isFinite(createdDate.getTime())
    ? createdDate.toISOString()
    : new Date().toISOString();
  const targetPhotos = profilePhotoFields(data.targetPhotoURL, data.targetPhotoURLCandidates);
  return {
    id: data.id || id,
    type: 'sent_reminder',
    noteId: data.noteId || '',
    noteTitle: data.noteTitle || 'Untitled Note',
    reminderText: data.reminderText || data.text || data.noteTitle || 'Reminder',
    reminderAt,
    targetUid: data.targetUid || data.recipientUid || '',
    targetName: data.targetName || data.recipientName || 'Friend',
    targetEmail: normalizeEmail(data.targetEmail || data.recipientEmail || ''),
    targetPhotoURL: targetPhotos.photoURL,
    targetPhotoURLCandidates: targetPhotos.photoURLCandidates,
    created
  };
}

function _readSentRemindersFromLocal() {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(_sentRemindersStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    const out = {};
    Object.keys(parsed || {}).forEach(id => {
      const reminder = normalizeSentReminder(id, parsed[id]);
      if (reminder) out[reminder.id] = reminder;
    });
    return out;
  } catch (err) {
    console.error('read sent reminders local:', err);
    return {};
  }
}

function _writeSentRemindersToLocal() {
  if (!userId) return;
  try {
    const entries = Object.keys(sentReminders || {})
      .map(id => normalizeSentReminder(id, sentReminders[id]))
      .filter(Boolean)
      .sort((a, b) => new Date(a.reminderAt) - new Date(b.reminderAt));
    if (entries.length) localStorage.setItem(_sentRemindersStorageKey(), JSON.stringify(entries.reduce((acc, reminder) => {
      acc[reminder.id] = reminder;
      return acc;
    }, {})));
    else localStorage.removeItem(_sentRemindersStorageKey());
  } catch (err) {
    console.error('write sent reminders local:', err);
  }
}

function _readSentReminders(data) {
  const raw = data?.sentReminders && typeof data.sentReminders === 'object' ? data.sentReminders : {};
  const out = {};
  Object.keys(raw).forEach(id => {
    const reminder = normalizeSentReminder(id, raw[id]);
    if (reminder) out[reminder.id] = reminder;
  });
  return out;
}

function _mergeSentReminders(...states) {
  const out = {};
  states.forEach(state => {
    Object.keys(state || {}).forEach(id => {
      const normalized = normalizeSentReminder(id, state[id]);
      if (!normalized) return;
      const existing = out[normalized.id];
      if (!existing || new Date(normalized.created) >= new Date(existing.created)) out[normalized.id] = normalized;
    });
  });
  return out;
}

function normalizePhotoURL(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|data:image\/)/i.test(url)) return url;
  return '';
}

function normalizePhotoURLList(...values) {
  const out = [];
  const add = value => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    const url = normalizePhotoURL(value);
    if (url && !out.includes(url)) out.push(url);
  };
  values.forEach(add);
  return out;
}

function avatarURLVariants(url) {
  const src = normalizePhotoURL(url);
  if (!src) return [];
  const out = [src];
  if (/googleusercontent\.com/i.test(src)) {
    const sized = src.replace(/=s\d+(-c)?(?=($|[&#?]))/i, '=s256-c');
    if (sized !== src) out.push(sized);
    if (!/[?&]sz=\d+/i.test(src)) out.push(src + (src.includes('?') ? '&' : '?') + 'sz=256');
  }
  return [...new Set(out)];
}

function avatarSourcesForProfile(profile) {
  return [...new Set(normalizePhotoURLList(
    profile?.photoURL,
    profile?.providerPhotoURL,
    profile?.photoURLCandidates
  ).flatMap(avatarURLVariants))];
}

function photoCandidatesFromUser(user) {
  return normalizePhotoURLList(
    user?.photoURL,
    (user?.providerData || []).map(provider => provider?.photoURL)
  );
}

function profilePhotoFromUser(user) {
  return photoCandidatesFromUser(user)[0] || '';
}

function profilePhotoFields(...sources) {
  const candidates = normalizePhotoURLList(...sources);
  return {
    photoURL: candidates[0] || '',
    photoURLCandidates: candidates
  };
}

function normalizeLinkedProfile(key, value) {
  if (!value || typeof value !== 'object') return null;
  const email = normalizeEmail(value.email || '');
  const uid = value.uid || key || (email ? emailProfileKey(email) : '');
  if (!uid) return null;
  const photos = profilePhotoFields(value.photoURL, value.providerPhotoURL, value.photoURLCandidates);
  return {
    uid,
    displayName: value.displayName || value.name || (email ? email.split('@')[0] : 'Linked Profile'),
    email,
    photoURL: photos.photoURL,
    photoURLCandidates: photos.photoURLCandidates,
    linkedAt: value.linkedAt || '',
    emailOnly: !!value.emailOnly || uid === emailProfileKey(email)
  };
}

function testPasswordProfileDomain() {
  return normalizeEmail((window.__env || {}).NOTAS_TEST_PASSWORD_AUTH_DOMAIN || 'test.notas.local');
}

function displayNameFromEmail(email) {
  const normalized = normalizeEmail(email);
  const localPart = normalized.split('@')[0] || '';
  if (normalized.endsWith('@' + testPasswordProfileDomain())) {
    const name = localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return name || localPart;
  }
  return localPart;
}

function profileNameFromUser(user) {
  return user?.displayName || (user?.email ? displayNameFromEmail(user.email) : 'Notas User');
}

function profileInitials(profile) {
  const name = profile?.displayName || profile?.name || 'U';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'U';
}

function handleAvatarImageError(img) {
  if (!img) return;
  let sources = [];
  try { sources = JSON.parse(img.dataset.avatarSrcs || '[]'); }
  catch (err) { sources = []; }
  const current = img.currentSrc || img.src || '';
  let next = '';
  while (sources.length && !next) {
    const candidate = normalizePhotoURL(sources.shift());
    if (candidate && candidate !== current) next = candidate;
  }
  if (next) {
    img.dataset.avatarSrcs = JSON.stringify(sources);
    img.src = next;
    return;
  }
  img.remove();
}
window.handleAvatarImageError = handleAvatarImageError;

function renderAvatar(profile, className) {
  const initials = esc(profileInitials(profile));
  const sources = avatarSourcesForProfile(profile);
  if (sources.length) {
    return '<span class="' + className + '">' + initials + '<img src="' + esc(sources[0]) + '" alt="" referrerpolicy="no-referrer" data-avatar-srcs="' + esc(JSON.stringify(sources.slice(1))) + '" onerror="window.handleAvatarImageError(this)" /></span>';
  }
  return '<span class="' + className + '">' + initials + '</span>';
}

function renderProfileAvatar(profile) {
  return renderAvatar(profile, 'profile-avatar');
}

function updateUserAvatar(user) {
  const av = document.getElementById('user-avatar');
  if (!av) return;
  const sources = avatarSourcesForProfile({
    photoURL: profilePhotoFromUser(user),
    photoURLCandidates: photoCandidatesFromUser(user)
  });
  const loadNext = () => {
    const current = av.currentSrc || av.src || '';
    let next = '';
    while (sources.length && !next) {
      const candidate = normalizePhotoURL(sources.shift());
      if (candidate && candidate !== current) next = candidate;
    }
    if (next) {
      av.src = next;
      av.style.display = '';
    } else {
      av.removeAttribute('src');
      av.style.display = 'none';
    }
  };
  av.referrerPolicy = 'no-referrer';
  av.onerror = loadNext;
  if (sources.length) loadNext();
  else {
    av.removeAttribute('src');
    av.style.display = 'none';
  }
}

async function ensureProfileDocument(user) {
  if (!userId) return;
  let existing = {};
  try {
    const snap = await getDoc(_getUserDocRef());
    existing = snap.data() || {};
  } catch (err) {
    console.error('read profile:', err);
  }

  const existingProfile = existing.profile || {};
  const email = normalizeEmail(user.email || existingProfile.email || '');
  const photos = profilePhotoFields(photoCandidatesFromUser(user), existingProfile.photoURL, existingProfile.photoURLCandidates);
  currentProfile = {
    uid: user.uid,
    displayName: profileNameFromUser(user),
    photoURL: photos.photoURL,
    photoURLCandidates: photos.photoURLCandidates,
    email
  };

  try {
    const userPayload = {
      uid: user.uid,
      displayName: currentProfile.displayName || '',
      email: user.email || existing.email || existingProfile.email || '',
      emailLower: email,
      photoURL: currentProfile.photoURL || '',
      lastLogin: serverTimestamp(),
      profile: { ...currentProfile, updated: serverTimestamp() }
    };
    if (!existing.created) userPayload.created = serverTimestamp();
    await setDoc(_getUserDocRef(), userPayload, { merge: true });
    if (email) {
      await setDoc(doc(fsDb, 'profileEmails', emailProfileDocId(email)), {
        uid: user.uid,
        email,
        displayName: currentProfile.displayName,
        photoURL: currentProfile.photoURL,
        photoURLCandidates: currentProfile.photoURLCandidates,
        updated: serverTimestamp()
      }, { merge: true });
    }
  } catch (err) {
    console.error('ensure profile:', err);
  }

  renderProfileConnectionUI();
  refreshOpenSidebarPage('friends');
}

function _readLinkedProfiles(data) {
  const raw = data?.linkedProfiles && typeof data.linkedProfiles === 'object' ? data.linkedProfiles : {};
  const out = {};
  Object.keys(raw).forEach(uid => {
    const profile = normalizeLinkedProfile(uid, raw[uid]);
    if (!profile || profile.uid === userId) return;
    out[profile.uid] = profile;
  });
  return out;
}

function mergeLinkedProfileRecords(...records) {
  const normalized = records.map(record => normalizeLinkedProfile(record?.uid, record)).filter(Boolean);
  if (!normalized.length) return null;
  const merged = normalized.reduce((acc, profile) => {
    const photos = profilePhotoFields(profile.photoURL, profile.photoURLCandidates, acc.photoURL, acc.photoURLCandidates);
    const email = normalizeEmail(profile.email || acc.email || '');
    const profileEmailOnly = !!profile.emailOnly || profile.uid === emailProfileKey(profile.email);
    const accEmailOnly = !!acc.emailOnly || acc.uid === emailProfileKey(acc.email);
    const uid = (!profileEmailOnly && profile.uid) || (!accEmailOnly && acc.uid) || profile.uid || acc.uid;
    return {
      ...acc,
      ...profile,
      uid,
      displayName: (!profileEmailOnly && profile.displayName) || acc.displayName || profile.displayName,
      email,
      photoURL: photos.photoURL,
      photoURLCandidates: photos.photoURLCandidates,
      linkedAt: profile.linkedAt || acc.linkedAt || '',
      emailOnly: !!(uid && email && uid === emailProfileKey(email))
    };
  }, {});
  return normalizeLinkedProfile(merged.uid, merged);
}

function mergeLinkedProfileMaps(...maps) {
  const out = {};
  maps.forEach(map => {
    Object.values(map || {}).forEach(profile => {
      const normalized = normalizeLinkedProfile(profile?.uid, profile);
      if (!normalized || normalized.uid === userId) return;
      const existingKey = Object.keys(out).find(key => profileMatchesLink(out[key], normalized));
      const key = existingKey || normalized.uid;
      const merged = mergeLinkedProfileRecords(out[key], normalized);
      if (existingKey && existingKey !== merged.uid) delete out[existingKey];
      out[merged.uid] = merged;
    });
  });
  return out;
}

function _readNotificationState(data) {
  const raw = data?.readNotifications && typeof data.readNotifications === 'object' ? data.readNotifications : {};
  const out = {};
  Object.keys(raw).forEach(id => { if (raw[id]) out[id] = true; });
  return out;
}

function applyUserProfileData(data) {
  if (data?.profile) {
    const photos = profilePhotoFields(
      currentProfile?.photoURL,
      currentProfile?.photoURLCandidates,
      data.profile.photoURL,
      data.profile.photoURLCandidates
    );
    currentProfile = {
      ...(data.profile || {}),
      ...(currentProfile || {}),
      photoURL: photos.photoURL,
      photoURLCandidates: photos.photoURLCandidates
    };
  }
  linkedProfiles = mergeLinkedProfileMaps(_readLinkedProfilesFromLocal(), _readLinkedProfiles(data));
  _writeLinkedProfilesToLocal();
  scheduleLinkedProfileRefresh();
  const remoteReadNotifications = _readNotificationState(data);
  const localReadNotifications = _readNotificationStateFromLocal();
  readNotifications = _mergeNotificationState(remoteReadNotifications, localReadNotifications);
  _writeNotificationStateToLocal();
  const localOnly = {};
  Object.keys(localReadNotifications).forEach(id => {
    if (!remoteReadNotifications[id]) localOnly[id] = true;
  });
  if (Object.keys(localOnly).length) {
    setDoc(_getUserDocRef(), { readNotifications: localOnly }, { merge: true })
      .catch(err => console.error('sync local notification reads:', err));
  }
  const remoteNoteAlarms = _readNoteAlarms(data);
  const localNoteAlarms = _readNoteAlarmsFromLocal();
  noteAlarms = _mergeNoteAlarms(remoteNoteAlarms, localNoteAlarms);
  _writeNoteAlarmsToLocal();
  const localOnlyAlarms = {};
  Object.keys(localNoteAlarms).forEach(id => {
    if (!remoteNoteAlarms[id]) localOnlyAlarms[id] = localNoteAlarms[id];
  });
  if (Object.keys(localOnlyAlarms).length) {
    setDoc(_getUserDocRef(), { noteAlarms: localOnlyAlarms }, { merge: true })
      .catch(err => console.error('sync local note alarms:', err));
  }
  const remoteSentReminders = _readSentReminders(data);
  const localSentReminders = _readSentRemindersFromLocal();
  sentReminders = _mergeSentReminders(remoteSentReminders, localSentReminders);
  _writeSentRemindersToLocal();
  const localOnlySentReminders = {};
  Object.keys(localSentReminders).forEach(id => {
    if (!remoteSentReminders[id]) localOnlySentReminders[id] = localSentReminders[id];
  });
  if (Object.keys(localOnlySentReminders).length) {
    setDoc(_getUserDocRef(), { sentReminders: localOnlySentReminders }, { merge: true })
      .catch(err => console.error('sync local sent reminders:', err));
  }
  renderProfileConnectionUI();
  renderProfileLinkRequestsUI();
  renderShareProfileList();
  renderNotificationButton();
  renderAlarmButton();
  if (document.getElementById('notifications-modal')?.classList.contains('open')) renderNotificationsList();
  if (document.getElementById('alarms-modal')?.classList.contains('open')) renderAlarmsList();
  refreshOpenSidebarPage('friends');
  refreshOpenSidebarPage('notifications');
  refreshOpenSidebarPage('alarms');
}

function scheduleLinkedProfileRefresh() {
  clearTimeout(_linkedProfileRefreshTimer);
  _linkedProfileRefreshTimer = setTimeout(refreshLinkedProfileDetails, 300);
}

async function refreshLinkedProfileDetails() {
  if (_refreshingLinkedProfiles || !userId) return;
  const candidates = Object.values(linkedProfiles)
    .filter(profile => profile?.email);
  if (!candidates.length) return;

  _refreshingLinkedProfiles = true;
  const updates = {};
  let changed = false;
  try {
    for (const profile of candidates) {
      const email = normalizeEmail(profile.email);
      if (!email) continue;
      const snap = await getDoc(doc(fsDb, 'profileEmails', emailProfileDocId(email)));
      if (!snap.exists()) continue;
      const data = snap.data() || {};
      if (!data.uid || data.uid === userId) continue;
      const photos = profilePhotoFields(data.photoURL, data.photoURLCandidates, profile.photoURL, profile.photoURLCandidates);
      const next = {
        ...profile,
        uid: data.uid,
        email: normalizeEmail(data.email || email),
        displayName: data.displayName || profile.displayName || email.split('@')[0],
        photoURL: photos.photoURL,
        photoURLCandidates: photos.photoURLCandidates,
        emailOnly: false
      };
      const oldUid = profile.uid;
      if (oldUid !== next.uid) {
        delete linkedProfiles[oldUid];
        updates[oldUid] = deleteField();
        changed = true;
      }
      if (JSON.stringify(linkedProfiles[next.uid] || {}) !== JSON.stringify(next)) {
        linkedProfiles[next.uid] = next;
        updates[next.uid] = next;
        changed = true;
      }
    }
    if (!changed) return;
    _writeLinkedProfilesToLocal();
    renderProfileConnectionUI();
    renderShareProfileList();
    renderSidebar();
    if (Object.keys(updates).length) {
      await setDoc(_getUserDocRef(), { linkedProfiles: updates }, { merge: true });
    }
  } catch (err) {
    console.warn('refresh linked profiles:', err);
  } finally {
    _refreshingLinkedProfiles = false;
  }
}

function hasProfileShareMetadata(note) {
  const sharedWith = note?.sharedWith && typeof note.sharedWith === 'object' ? note.sharedWith : {};
  return Object.keys(sharedWith).length > 0 || (Array.isArray(note?.sharedAccessKeys) && note.sharedAccessKeys.length > 0);
}

function normalizePublicFolderIds(value) {
  return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id))] : [];
}

function normalizeSharedWith(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeSharedAccessKeys(value) {
  return Array.isArray(value) ? [...new Set(value.filter(Boolean))] : [];
}

function noteLinkPublicFromData(data) {
  if (typeof data?.linkPublic === 'boolean') return data.linkPublic;
  return !!data?.public && !normalizePublicFolderIds(data?.publicFolderIds).length;
}

function computeEffectiveNotePublic(note) {
  return !!(note?.linkPublic || normalizePublicFolderIds(note?.publicFolderIds).length);
}

function normalizePinnedAt(value) {
  if (!value) return '';
  const date = value?.toDate?.() || new Date(value);
  if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
  return '';
}

function normalizeNoteTimestamp(value) {
  if (!value) return '';
  const date = value?.toDate?.() || new Date(value);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function trashExpiryFromDeletedAt(deletedAt) {
  const deletedTime = new Date(deletedAt || 0).getTime();
  if (!Number.isFinite(deletedTime)) return '';
  return new Date(deletedTime + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function isTrashedNote(note) {
  return !!note?.deletedAt;
}

function trashDaysRemaining(note) {
  const expiresAt = note?.trashExpiresAt || trashExpiryFromDeletedAt(note?.deletedAt);
  const expiresTime = new Date(expiresAt || 0).getTime();
  if (!Number.isFinite(expiresTime)) return TRASH_RETENTION_DAYS;
  return Math.max(0, Math.ceil((expiresTime - Date.now()) / (24 * 60 * 60 * 1000)));
}

function isTrashExpired(note) {
  return isTrashedNote(note) && trashDaysRemaining(note) <= 0;
}

const NOTE_PREVIEW_TEXT_LIMIT = 220;
const NOTE_SEARCH_TEXT_LIMIT = 4000;

function normalizeNotePlainText(value, limit = NOTE_SEARCH_TEXT_LIMIT) {
  const clean = String(value || '').replace(/\u200b/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? clean.slice(0, limit).trimEnd() : clean;
}

function noteTextFromHtml(html, limit = NOTE_SEARCH_TEXT_LIMIT) {
  if (!html) return '';
  const root = document.createElement('div');
  root.innerHTML = String(html || '');
  return normalizeNotePlainText(root.innerText || root.textContent || '', limit);
}

function noteTextFromRoot(root, limit = NOTE_SEARCH_TEXT_LIMIT) {
  return normalizeNotePlainText(root?.innerText || root?.textContent || '', limit);
}

function normalizeInlineAlarmMetadata(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const alarmAt = normalizeAlarmAt(item?.alarmAt);
    if (!alarmAt) return null;
    return {
      alarmId: String(item?.alarmId || item?.id || 'alarm_' + index).slice(0, 180),
      alarmAt,
      text: normalizeNotePlainText(item?.text || item?.reminderText || 'Reminder', 180) || 'Reminder',
      direction: item?.direction === 'sent' || item?.alarmDirection === 'sent' ? 'sent' : 'mine',
      targetUid: String(item?.targetUid || '').slice(0, 180),
      targetName: normalizeNotePlainText(item?.targetName || '', 120)
    };
  }).filter(Boolean);
}

function inlineAlarmsFromRoot(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll('.note-alarm')].map((mark, index) => {
    const alarmAt = normalizeAlarmAt(mark.dataset.alarmAt);
    if (!alarmAt) return null;
    return {
      alarmId: mark.dataset.alarmId || 'alarm_' + index,
      alarmAt,
      text: normalizeNotePlainText(mark.textContent || 'Reminder', 180) || 'Reminder',
      direction: mark.dataset.alarmDirection === 'sent' ? 'sent' : 'mine',
      targetUid: mark.dataset.alarmTargetUid || '',
      targetName: normalizeNotePlainText(mark.dataset.alarmTargetName || '', 120)
    };
  }).filter(Boolean);
}

function inlineAlarmsFromContent(content) {
  if (!content) return [];
  const root = document.createElement('div');
  root.innerHTML = String(content || '');
  return inlineAlarmsFromRoot(root);
}

function buildNoteContentMetadata(content, options = {}) {
  const root = options.root || null;
  const text = typeof options.text === 'string'
    ? normalizeNotePlainText(options.text, NOTE_SEARCH_TEXT_LIMIT)
    : (root ? noteTextFromRoot(root, NOTE_SEARCH_TEXT_LIMIT) : noteTextFromHtml(content, NOTE_SEARCH_TEXT_LIMIT));
  return {
    previewText: normalizeNotePlainText(text, NOTE_PREVIEW_TEXT_LIMIT),
    searchText: normalizeNotePlainText(text, NOTE_SEARCH_TEXT_LIMIT).toLowerCase(),
    inlineAlarms: normalizeInlineAlarmMetadata(root ? inlineAlarmsFromRoot(root) : inlineAlarmsFromContent(content))
  };
}

function noteContentMetadataFromData(data, fallback = {}) {
  const legacyContent = typeof data?.content === 'string' ? data.content : '';
  const derived = legacyContent ? buildNoteContentMetadata(legacyContent) : {};
  return {
    previewText: normalizeNotePlainText(data?.previewText || derived.previewText || fallback.previewText || '', NOTE_PREVIEW_TEXT_LIMIT),
    searchText: normalizeNotePlainText(data?.searchText || derived.searchText || fallback.searchText || '', NOTE_SEARCH_TEXT_LIMIT).toLowerCase(),
    inlineAlarms: normalizeInlineAlarmMetadata(
      Array.isArray(data?.inlineAlarms) ? data.inlineAlarms :
      (Array.isArray(derived.inlineAlarms) && derived.inlineAlarms.length ? derived.inlineAlarms : fallback.inlineAlarms)
    )
  };
}

function noteFromFirestoreData(id, data = {}, overrides = {}) {
  const existing = notes?.[id] || {};
  const hasOverrideContent = Object.prototype.hasOwnProperty.call(overrides || {}, 'content');
  const metadata = hasOverrideContent
    ? buildNoteContentMetadata(overrides.content || '')
    : noteContentMetadataFromData(data, existing);
  const bodyLoaded = hasOverrideContent || !!existing._bodyLoaded;
  const base = {
    id,
    owner: data.owner || existing.owner || '',
    title: data.title || existing.title || 'Untitled Note',
    content: bodyLoaded ? (hasOverrideContent ? String(overrides.content || '') : String(existing.content || '')) : '',
    _bodyLoaded: bodyLoaded,
    _bodyError: !!existing._bodyError,
    previewText: metadata.previewText,
    searchText: metadata.searchText,
    inlineAlarms: metadata.inlineAlarms,
    folderId: Object.prototype.hasOwnProperty.call(overrides || {}, 'folderId') ? overrides.folderId : (data.folderId || null),
    created: normalizeNoteTimestamp(data.created) || existing.created || new Date().toISOString(),
    modified: normalizeNoteTimestamp(data.modified) || existing.modified || new Date().toISOString(),
    ...overrides
  };
  if (!bodyLoaded && !hasOverrideContent) {
    base.content = '';
    base._bodyLoaded = false;
  }
  return hydrateNoteShareState(data, base);
}

function applyNoteBodyContent(noteId, content, options = {}) {
  const note = notes?.[noteId];
  if (!note) return null;
  const body = String(content || '');
  const metadata = buildNoteContentMetadata(body, options);
  note.content = body;
  note._bodyLoaded = true;
  note._bodyError = false;
  note.previewText = metadata.previewText;
  note.searchText = metadata.searchText;
  note.inlineAlarms = metadata.inlineAlarms;
  if (options.modified) note.modified = options.modified;
  return note;
}

function notePreviewText(note, fallback = 'Empty Note') {
  const preview = normalizeNotePlainText(note?.previewText || (note?._bodyLoaded ? note.content : ''), 65);
  return preview || fallback;
}

function noteSearchText(note) {
  return normalizeNotePlainText(note?.searchText || note?.previewText || (note?._bodyLoaded ? note.content : ''), NOTE_SEARCH_TEXT_LIMIT).toLowerCase();
}

function hydrateNoteShareState(data, base = {}) {
  const sharedWith = normalizeSharedWith(data?.sharedWith);
  const sharedAccessKeys = normalizeSharedAccessKeys(data?.sharedAccessKeys);
  const publicFolderIds = normalizePublicFolderIds(data?.publicFolderIds);
  const linkPublic = noteLinkPublicFromData(data);
  const pinnedAt = normalizePinnedAt(_hasOwn(base, 'pinnedAt') ? base.pinnedAt : data?.pinnedAt);
  const pinScope = pinnedAt ? ((_hasOwn(base, 'pinScope') ? base.pinScope : data?.pinScope) === 'minor' ? 'minor' : 'major') : '';
  const deletedAt = normalizeNoteTimestamp(_hasOwn(base, 'deletedAt') ? base.deletedAt : data?.deletedAt);
  const trashExpiresAt = normalizeNoteTimestamp(_hasOwn(base, 'trashExpiresAt') ? base.trashExpiresAt : data?.trashExpiresAt) || trashExpiryFromDeletedAt(deletedAt);
  return {
    ...base,
    public: !!data?.public,
    linkPublic,
    publicFolderIds,
    sharedWith,
    sharedAccessKeys,
    pinnedAt,
    pinScope,
    deletedAt,
    trashExpiresAt,
    mentionedUids: Array.isArray(data?.mentionedUids) ? data.mentionedUids : []
  };
}

function ensureOwnedDirectShareReadable(noteId) {
  const note = notes[noteId];
  if (!note) return;
  note.public = computeEffectiveNotePublic(note);
  setDoc(doc(fsDb, 'notes', noteId), { public: note.public }, { merge: true })
    .catch(err => console.error('repair direct share access:', err));
}
