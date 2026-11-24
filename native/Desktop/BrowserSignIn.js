import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import {
  browserPopupRedirectResolver, GoogleAuthProvider, initializeAuth, inMemoryPersistence, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';

const state = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const { FIREBASE_API_KEY: apiKey, FIREBASE_AUTH_DOMAIN: authDomain, FIREBASE_PROJECT_ID: projectId } = window.__env || {};
const status = document.getElementById('status');
const proceed = document.getElementById('continue');
const cancel = document.getElementById('cancel');

async function complete(result) {
  const response = await fetch('/complete-sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, projectId, ...result })
  });
  if (!response.ok) throw new Error('This sign-in request has expired. Start again in Notas.');
}

if (!/^[0-9a-f]{64}$/.test(state) || !apiKey || !authDomain || !projectId) {
  status.textContent = 'Start a new sign-in request in Notas.';
} else {
  const auth = initializeAuth(initializeApp({ apiKey, authDomain, projectId }), {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver
  });
  proceed.disabled = false;
  cancel.disabled = false;

  proceed.addEventListener('click', async () => {
    proceed.disabled = true;
    cancel.disabled = true;
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.idToken && !credential?.accessToken) throw new Error('Google did not return a sign-in credential.');
      await complete({ idToken: credential.idToken, accessToken: credential.accessToken });
      status.textContent = 'Google Sign-In Finished. Return to Notas to open your workspace.';
    } catch (error) {
      status.textContent = error.message || 'Could Not Sign In. Try again.';
      proceed.disabled = false;
      cancel.disabled = false;
    }
  });
  cancel.addEventListener('click', async () => {
    proceed.disabled = true;
    cancel.disabled = true;
    try {
      await complete({ cancelled: true });
      status.textContent = 'Sign-In Cancelled. You can close this tab.';
    } catch (error) {
      status.textContent = error.message || 'Return to Notas to start again.';
    }
  });
}
