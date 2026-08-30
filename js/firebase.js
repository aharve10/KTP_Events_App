/* ==========================================================================
   Firebase bootstrap. Everything else imports the SDK through this file so
   there's exactly one place that pins the SDK version.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, where, orderBy, limit, serverTimestamp,
  Timestamp, runTransaction, increment, writeBatch, collectionGroup,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { firebaseConfig } from "./config.js";

/** True when config.js still holds the placeholder values. */
export const isConfigured = !/^PASTE_/.test(firebaseConfig.apiKey || "PASTE_") &&
  Boolean(firebaseConfig.projectId) && !/^PASTE_/.test(firebaseConfig.projectId);

let app = null, auth = null, db = null;

if (isConfigured) {
  app  = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db   = getFirestore(app);
}

export { app, auth, db };

export {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile, sendPasswordResetEmail,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, Timestamp,
  runTransaction, increment, writeBatch, collectionGroup,
};

/** Turn a Firebase error into something a human wants to read. */
export function friendlyError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/user-not-found": "No account with that email. Try creating one.",
    "auth/wrong-password": "Wrong password.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/email-already-in-use": "There's already an account with that email — sign in instead.",
    "auth/weak-password": "Password needs to be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/network-request-failed": "Network problem — check your connection.",
    "auth/operation-not-allowed": "Email/password sign-in isn't enabled in the Firebase console yet.",
    "auth/unauthorized-domain": "This domain isn't in the Firebase authorized-domains list yet.",
    "permission-denied": "You don't have permission to do that.",
    "unavailable": "Can't reach the database right now. Check your connection.",
    "failed-precondition": "The database needs an index for this query — check the browser console for the link.",
  };
  if (map[code]) return map[code];
  return err?.message?.replace(/^Firebase:\s*/, "") || "Something went wrong.";
}
