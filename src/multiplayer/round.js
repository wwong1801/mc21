// src/multiplayer/round.js
import { db, auth, ready } from "./firebase.js";
import {
  doc, setDoc, updateDoc, getDoc, getDocs, collection, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { buildShoe, drawFromShoe, needsShuffle } from "./shoe.js";
import { scoreHand, isFiveCard, isBust, isBlackjack, isDoubleAce } from "../rules.js";

/** Start a new round: create rounds/{roundId}, set table to BETTING. */
export async function startRound(tableId) {
  await ready;
  const roundId = crypto.randomUUID();
  const tableRef = doc(db, "tables", tableId);
  const roundRef = doc(db, "tables", tableId, "rounds", roundId);

  await Promise.all([
    setDoc(roundRef, {
      phase: "BETTING",                // BETTING | DEALING | PLAYER_TURNS | DEALER_TURN | SETTLING | DONE
      dealerHand: [],
      results: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }),
    updateDoc(tableRef, {
      status: "BETTING",
      updatedAt: serverTimestamp()
    })
  ]);

  return roundId;
}

/** Deal initial 2 cards to each occupied seat + 2 to dealer. Creates/refreshes shoe if needed. */
export async function dealInitial(tableId, roundId) {
  await ready;
  const tableRef = doc(db, "tables", tableId);
  const roundRef = doc(db, "tables", tableId, "rounds", roundId);

  // Load table + seats
  const [tableSnap, seatsSnap] = await Promise.all([
    getDoc(tableRef),
    getDocs(collection(db, "tables", tableId, "seats"))
  ]);
  if (!tableSnap.exists()) throw new Error("Table not found");
  const table = tableSnap.data();
  let shoe = table.shoe;
  if (needsShuffle(shoe)) shoe = buildShoe(6);

  // find occupied seats
  const seats = [];
  seatsSnap.forEach(s => {
    const d = s.data();
    if (d.uid) seats.push({ id: s.id, ref: s.ref, data: d });
  });

  // deal 2 each to players
  const seatUpdates = [];
  for (const s of seats) {
    const hand = drawFromShoe(shoe, 2);
    seatUpdates.push(updateDoc(s.ref, {
      hand, state: "PLAYING", updatedAt: serverTimestamp()
    }));
  }
  // dealer gets 2
  const dealerHand = drawFromShoe(shoe, 2);

  await Promise.all([
    ...seatUpdates,
    updateDoc(roundRef, {
      phase: "PLAYER_TURNS",
      dealerHand,
      updatedAt: serverTimestamp()
    }),
    updateDoc(tableRef, {
      status: "PLAYER_TURNS",
      shoe,
      updatedAt: serverTimestamp()
    })
  ]);
}

/** Host plays dealer hand to >=16 (or bust/5-card), then calls settleRound. */
export async function dealerTurn(tableId, roundId) {
  await ready;
  const tableRef = doc(db, "tables", tableId);
  const roundRef = doc(db, "tables", tableId, "rounds", roundId);

  const [tableSnap, roundSnap] = await Promise.all([getDoc(tableRef), getDoc(roundRef)]);
  const table = tableSnap.data();
  const round = roundSnap.data();
  if (!table || !round) throw new Error("Missing table/round");

  let shoe = table.shoe;
  if (needsShuffle(shoe)) shoe = buildShoe(6);

  let dealer = round.dealerHand || [];
  const value = () => scoreHand(dealer);
  while (!isBust(dealer) && !isFiveCard(dealer) && value() < 16) {
    dealer = [...dealer, ...drawFromShoe(shoe, 1)];
  }

  await Promise.all([
    updateDoc(roundRef, { phase: "SETTLING", dealerHand: dealer, updatedAt: serverTimestamp() }),
    updateDoc(tableRef, { status: "SETTLING", shoe, updatedAt: serverTimestamp() })
  ]);

  await settleRound(tableId, roundId);
}

/** Settle all seats against dealer using MC rules; write results into round doc. */
export async function settleRound(tableId, roundId) {
  await ready;
  const tableRef = doc(db, "tables", tableId);
  const roundRef = doc(db, "tables", tableId, "rounds", roundId);
  const seatsCol = collection(db, "tables", tableId, "seats");

  const [roundSnap, seatsSnap] = await Promise.all([getDoc(roundRef), getDocs(seatsCol)]);
  if (!roundSnap.exists()) throw new Error("Round not found");
  const round = roundSnap.data();
  const dealer = round.dealerHand || [];

  const results = {};
  const seatUpdates = [];
  seatsSnap.forEach(s => {
    const d = s.data();
    if (!d.uid || !d.bet) return;

    const res = mcOutcome(d.hand || [], dealer);
    const delta = (d.bet || 0) * res.mult;
    results[d.uid] = { code: res.code, mult: res.mult, bet: d.bet, delta };

    // store end-state (optional)
    seatUpdates.push(updateDoc(s.ref, {
      state: res.mult >= 0 ? "DONE_WIN" : "DONE_LOSE",
      updatedAt: serverTimestamp()
    }));
  });

  await Promise.all([
    ...seatUpdates,
    updateDoc(roundRef, { phase: "DONE", results, updatedAt: serverTimestamp() }),
    updateDoc(tableRef, { status: "OPEN", updatedAt: serverTimestamp() })
  ]);

  // (Optional) Also save a single-player style history doc for the host’s analytics
  // Object.values(results).forEach(r => window.saveRound?.({ bet: r.bet, delta: r.delta, outcome: r.code, pt: 0, dt: 0, player: [], dealer: [] }));
}

/** MC custom outcome logic (mirrors your single-player settleWithMCRules). */
function mcOutcome(p, d) {
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
