// src/multiplayer/actions.js
import { db, ready } from "./firebase.js";
import {
  doc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { scoreHand } from "../rules.js";
import { drawFromShoe } from "./shoe.js";

/** Set or change a bet during BETTING. */
export async function placeBet(tableId, seatId, amount) {
  await ready;
  const seatRef = doc(db, "tables", tableId, "seats", seatId);
  await updateDoc(seatRef, {
    bet: Math.max(1, Math.floor(Number(amount) || 1)),
    state: "BETTING",
    updatedAt: serverTimestamp()
  });
}

/** Player hits: draw 1 card to seat.hand, update state if bust/five. */
export async function hit(tableId, seatId) {
  await ready;
  const tableRef = doc(db, "tables", tableId);
  const seatRef  = doc(db, "tables", tableId, "seats", seatId);
  const [tableSnap, seatSnap] = await Promise.all([getDoc(tableRef), getDoc(seatRef)]);
  if (!tableSnap.exists() || !seatSnap.exists()) throw new Error("Table/Seat not found");

  const table = tableSnap.data();
  const seat  = seatSnap.data();
  if (!table.shoe) throw new Error("No shoe on table");
  const shoe = table.shoe;

  // draw one card
  const newCard = drawFromShoe(shoe, 1)[0];
  const hand = [...(seat.hand || []), newCard];
  const total = scoreHand(hand);
  const state = hand.length >= 5 ? "STAND" : (total > 21 ? "BUST" : "PLAYING");

  await Promise.all([
    updateDoc(seatRef, { hand, state, updatedAt: serverTimestamp() }),
    updateDoc(tableRef, { shoe, updatedAt: serverTimestamp() })
  ]);
}

/** Player stands: lock their state. */
export async function stand(tableId, seatId) {
  await ready;
  const seatRef  = doc(db, "tables", tableId, "seats", seatId);
  await updateDoc(seatRef, { state: "STAND", updatedAt: serverTimestamp() });
}
