import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, deleteDoc, getDocs, getDoc,
  onSnapshot, query, where, Timestamp, writeBatch, serverTimestamp, deleteField, updateDoc,
  arrayUnion, arrayRemove, FieldPath, limit
} from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js';

const __env = window.__env || {};

export const firebaseConfig = {
  apiKey:            __env.FIREBASE_API_KEY             || '__FIREBASE_API_KEY__',
  authDomain:        __env.FIREBASE_AUTH_DOMAIN         || '__FIREBASE_AUTH_DOMAIN__',
  projectId:         __env.FIREBASE_PROJECT_ID          || '__FIREBASE_PROJECT_ID__',
  storageBucket:     __env.FIREBASE_STORAGE_BUCKET      || '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: __env.FIREBASE_MESSAGING_SENDER_ID || '__FIREBASE_MESSAGING_SENDER_ID__',
  appId:             __env.FIREBASE_APP_ID              || '__FIREBASE_APP_ID__',
  measurementId:     __env.FIREBASE_MEASUREMENT_ID      || '__FIREBASE_MEASUREMENT_ID__'
};

export const fbApp = initializeApp(firebaseConfig);
getAnalytics(fbApp);
export const auth = getAuth(fbApp);
export const fsDb = getFirestore(fbApp);

export {
  initializeApp,
  getAnalytics,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  where,
  Timestamp,
  writeBatch,
  serverTimestamp,
  deleteField,
  updateDoc,
  arrayUnion,
  arrayRemove,
  FieldPath,
  limit
};
