// src/multiplayer/firebase.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ---- Your existing project config (from index.html) ----
const firebaseConfig = {
  apiKey: "AIzaSyAIro5ymv33s82pZQYuNV_8Uo4TzOp4Fe8",
  authDomain: "mc21-8e9d1.firebaseapp.com",
  projectId: "mc21-8e9d1",
  storageBucket: "mc21-8e9d1.firebasestorage.app",
  messagingSenderId: "32721916885",
  appId: "1:32721916885:web:7731d35283c3e91995a35c"
};

// ---- Initialize exactly once (avoid double-init errors) ----
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Core SDKs we’ll reuse across all multiplayer modules
const auth = getAuth(app);
const db   = getFirestore(app);
const rtdb = getDatabase(app);

// Small helper: a Promise that resolves once we have a user
const ready = (async () => {
  // If already signed in, just resolve
  if (auth.currentUser) return auth.currentUser;

  // Try anonymous sign-in
  try { await signInAnonymously(auth); } catch (e) {
    // Ignore "already signed in" type errors safely
    console.warn("Anon sign-in:", e?.message || e);
  }

  // Wait until auth state is ready
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { if (u) { off(); resolve(u); } });
  });
})();

export { app, auth, db, rtdb, ready };
