// src/multiplayer/tables.js
import { auth, db, ready } from "./firebase.js";
import {
  doc, setDoc, updateDoc, getDoc, serverTimestamp,
  collection, onSnapshot, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** Create a new table and pre-create seats (S1..S4). Returns tableId. */
export async function createTable({ maxSeats = 4 } = {}) {
  await ready;
  const tableId = crypto.randomUUID();
  const tableRef = doc(db, "tables", tableId);

  await setDoc(tableRef, {
    hostUid: auth.currentUser.uid,
    status: "OPEN",              // OPEN | BETTING | DEALING | PLAYER_TURNS | DEALER_TURN | SETTLING | CLOSED
    maxSeats,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Pre-create seat docs
  const seatIds = ["S1", "S2", "S3", "S4"].slice(0, maxSeats);
  const seatsCol = collection(db, "tables", tableId, "seats");
  await Promise.all(seatIds.map(id => setDoc(doc(seatsCol, id), {
    uid: null,
    displayName: null,
    bet: null,
    hand: [],
    state: "EMPTY",            // EMPTY | READY | BETTING | PLAYING | STAND | BUST | BLACKJACK | LEFT
    joinedAt: null,
    updatedAt: serverTimestamp(),
  })));

  return tableId;
}

/** Join a seat. Pass displayName; returns true if success. */
export async function joinSeat(tableId, seatId, displayName = "Player") {
  await ready;
  const seatRef = doc(db, "tables", tableId, "seats", seatId);
  const snap = await getDoc(seatRef);
  if (!snap.exists()) throw new Error("Seat not found");
  const data = snap.data();
  if (data.uid && data.uid !== auth.currentUser.uid) {
    throw new Error("Seat already taken");
  }
  await updateDoc(seatRef, {
    uid: auth.currentUser.uid,
    displayName,
    state: "READY",
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Leave a seat (clear ownership). */
export async function leaveSeat(tableId, seatId) {
  await ready;
  const seatRef = doc(db, "tables", tableId, "seats", seatId);
  await updateDoc(seatRef, {
    uid: null,
    displayName: null,
    bet: null,
    hand: [],
    state: "EMPTY",
    updatedAt: serverTimestamp(),
  });
}

/** Subscribe to open tables for the lobby UI. Calls cb(list) on updates. */
export function watchOpenTables(cb, { limitCount = 20 } = {}) {
  const q = query(
    collection(db, "tables"),
    where("status", "in", ["OPEN", "BETTING", "PLAYER_TURNS", "DEALER_TURN"]),
    orderBy("createdAt", "desc"),
    limit(limitCount)
  );
  return onSnapshot(q, (snap) => {
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    cb(rows);
  });
}

/** Subscribe to one table (header + seats). Calls cb({table, seats}) on updates. */
export function watchTable(tableId, cb) {
  const unsubs = [];
  unsubs.push(onSnapshot(doc(db, "tables", tableId), (s) => cb({ table: { id: s.id, ...s.data() } })));
  unsubs.push(onSnapshot(collection(db, "tables", tableId, "seats"), (snap) => {
    const seats = [];
    snap.forEach(d => seats.push({ id: d.id, ...d.data() }));
    cb({ seats });
  }));
  return () => unsubs.forEach(u => u && u());
}

/** Convenience: fetch a list of available seatIds for a table. */
export async function getAvailableSeats(tableId) {
  const seatSnaps = await getDocs(collection(db, "tables", tableId, "seats"));
  const free = [];
  seatSnaps.forEach(s => {
    const d = s.data();
    if (!d.uid) free.push(s.id);
  });
  return free;
}
