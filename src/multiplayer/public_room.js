// src/multiplayer/public_room.js
import { auth, db, ready } from "./firebase.js";
import {
  doc, setDoc, getDoc, updateDoc, getDocs, collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { buildShoe, drawFromShoe, needsShuffle } from "./shoe.js";
import { scoreHand, isFiveCard, isBust, isBlackjack, isDoubleAce } from "../rules.js";

const TABLE_ID = "public-room";

export async function initPublicRoom(displayName = "Player") {
  await ready;
  await ensureTable();
  const seatId = await autoJoinSeat(displayName);
  return { tableId: TABLE_ID, seatId };
}

async function ensureTable() {
  const tableRef = doc(db, "tables", TABLE_ID);
  const snap = await getDoc(tableRef);
  if (!snap.exists()) {
    await setDoc(tableRef, {
      hostUid: "ANYONE",
      status: "OPEN",
      maxSeats: 4,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const seatsCol = collection(db, "tables", TABLE_ID, "seats");
    const ids = ["S1","S2","S3","S4"];
    await Promise.all(ids.map(id => setDoc(doc(seatsCol, id), {
      uid: null, displayName: null, bet: null, hand: [],
      state: "EMPTY", joinedAt: null, updatedAt: serverTimestamp()
    })));
  }
}

async function autoJoinSeat(displayName) {
  const seatsCol = collection(db, "tables", TABLE_ID, "seats");
  const snaps = await getDocs(seatsCol);
  let chosen = null;
  snaps.forEach(s => { const d = s.data(); if (!chosen && !d.uid) chosen = s.id; });
  if (!chosen) throw new Error("Table full");
  await updateDoc(doc(db, "tables", TABLE_ID, "seats", chosen), {
    uid: auth.currentUser.uid,
    displayName: `${displayName} · ${auth.currentUser.uid.slice(0,4)}`,
    state: "READY",
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return chosen;
}

/* ---------- Round & actions (anyone can press) ---------- */

export async function startRound() {
  const tableRef = doc(db, "tables", TABLE_ID);
  await updateDoc(tableRef, { status: "BETTING", updatedAt: serverTimestamp() });
}

export async function dealInitial() {
  const tableRef = doc(db, "tables", TABLE_ID);
  const tableSnap = await getDoc(tableRef);
  let table = tableSnap.data() || {};
  let shoe = table.shoe;
  if (needsShuffle(shoe)) shoe = buildShoe(6);

  // give 2 to each occupied seat + 2 to dealer (kept on table)
  const seatsCol = collection(db, "tables", TABLE_ID, "seats");
  const snaps = await getDocs(seatsCol);
  const seatUpdates = [];
  const dealer = drawFromShoe(shoe, 2);
  snaps.forEach(s => {
    const d = s.data(); if (!d.uid) return;
    const hand = drawFromShoe(shoe, 2);
    seatUpdates.push(updateDoc(s.ref, { hand, state: "PLAYING", updatedAt: serverTimestamp() }));
  });

  await Promise.all([
    ...seatUpdates,
    updateDoc(tableRef, { status: "PLAYER_TURNS", dealerHand: dealer, shoe, updatedAt: serverTimestamp() })
  ]);
}

export async function placeBet(seatId, amount) {
  const seatRef = doc(db, "tables", TABLE_ID, "seats", seatId);
  await updateDoc(seatRef, { bet: Math.max(1, Math.floor(Number(amount)||1)), state: "BETTING", updatedAt: serverTimestamp() });
}

export async function hit(seatId) {
  const tableRef = doc(db, "tables", TABLE_ID);
  const seatRef  = doc(db, "tables", TABLE_ID, "seats", seatId);
  const [tableSnap, seatSnap] = await Promise.all([getDoc(tableRef), getDoc(seatRef)]);
  const table = tableSnap.data() || {};
  let shoe = table.shoe;
  if (!shoe) throw new Error("No shoe");
  const s = seatSnap.data() || {};
  const newCard = drawFromShoe(shoe, 1)[0];
  const hand = [...(s.hand||[]), newCard];
  const total = scoreHand(hand);
  const state = hand.length >= 5 ? "STAND" : (total > 21 ? "BUST" : "PLAYING");

  await Promise.all([
    updateDoc(seatRef, { hand, state, updatedAt: serverTimestamp() }),
    updateDoc(tableRef, { shoe, updatedAt: serverTimestamp() })
  ]);
}

export async function stand(seatId) {
  const seatRef = doc(db, "tables", TABLE_ID, "seats", seatId);
  await updateDoc(seatRef, { state: "STAND", updatedAt: serverTimestamp() });
}

export async function dealerAndSettle() {
  const tableRef = doc(db, "tables", TABLE_ID);
  const tableSnap = await getDoc(tableRef);
  let table = tableSnap.data() || {};
  let shoe = table.shoe;
  if (needsShuffle(shoe)) shoe = buildShoe(6);

  let dealer = table.dealerHand || [];
  while (!isBust(dealer) && !isFiveCard(dealer) && scoreHand(dealer) < 16) {
    dealer = [...dealer, ...drawFromShoe(shoe, 1)];
  }

  // compute results per seat
  const seatsCol = collection(db, "tables", TABLE_ID, "seats");
  const snaps = await getDocs(seatsCol);
  const seatUpdates = [];
  snaps.forEach(s => {
    const d = s.data(); if (!d.uid || !d.bet) return;
    const { mult } = outcome(d.hand||[], dealer);
    seatUpdates.push(updateDoc(s.ref, { state: mult >= 0 ? "DONE_WIN" : "DONE_LOSE", updatedAt: serverTimestamp() }));
  });

  await Promise.all([
    ...seatUpdates,
    updateDoc(tableRef, { status: "OPEN", dealerHand: dealer, shoe, updatedAt: serverTimestamp() })
  ]);
}

function outcome(p, d) {
  const pt = scoreHand(p), dt = scoreHand(d);
  const pFive = isFiveCard(p), pBJ = isBlackjack(p), pAA = isDoubleAce(p);
  const dBust = isBust(d), pBust = isBust(p);
  if (pFive && pt <= 21) return { mult:  2, code: "P_5CARD_WIN" };
  if (pFive && pt >  21) return { mult: -2, code: "P_5CARD_BUST" };
  if (pAA)               return { mult:  3, code: "P_AA" };
  if (pBJ)               return { mult:  2, code: "P_BJ" };
  if (pBust && dBust)    return { mult: -1, code: "BOTH_BUST_D_WINS" };
  if (pBust)             return { mult: -1, code: "P_BUST" };
  if (dBust)             return { mult:  1, code: "D_BUST" };
  if (pt === dt)         return { mult:  0, code: "PUSH" };
  if ((21 - pt) < (21 - dt)) return { mult: 1, code: "P_NORMAL_WIN" };
  return { mult: -1, code: "P_NORMAL_LOSE" };
}
