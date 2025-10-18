// src/multiplayer/presence.js
import { auth, rtdb, ready } from "./firebase.js";
import {
  ref, set, onDisconnect, serverTimestamp, update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/**
 * Mark this user online in RTDB and auto-set offline on disconnect.
 * Call once after Firebase is ready (e.g., from index.html).
 */
export async function startPresence() {
  await ready; // ensure we have a UID

  const uid = auth.currentUser.uid;
  const statusRef = ref(rtdb, `/status/${uid}`);

  // Mark online now
  await set(statusRef, {
    state: "online",
    last_changed: serverTimestamp()
  });

  // When tab/window closes or network drops → set offline automatically
  onDisconnect(statusRef).update({
    state: "offline",
    last_changed: serverTimestamp()
  });

  // Optional: also refresh "online" ping on visibility changes
  const touch = () =>
    update(statusRef, { state: "online", last_changed: serverTimestamp() }).catch(() => {});
  ["visibilitychange", "focus", "online"].forEach(evt =>
    window.addEventListener(evt, touch, { passive: true })
  );
}
