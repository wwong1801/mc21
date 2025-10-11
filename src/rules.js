// src/rules.js
// Pure rules for M.C. 21点. No DOM, no UI. Easy to test & reuse.

// ---- Public API (named exports) ----
export {
  SUITS,
  RANKS,
  createDeck,
  shuffleDeck,
  dealFromTop,
  scoreHand,
  isBlackjack,
  isDoubleAce,
  isFiveCard,
  isBust,
};

// ---- Cards & deck ----
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/** Create a fresh ordered 52-card deck. */
function createDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push({ s, r });
  }
  return deck;
}

/**
 * Fisher–Yates shuffle. Uses crypto RNG if available for fairness.
 * Returns a NEW array (non-mutating) so callers can keep originals if needed.
 */
function shuffleDeck(deck) {
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomInt(min, max) {
  // [min, max)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const range = max - min;
    const buf = new Uint32Array(1);
    let x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0] / 0x100000000; // 0..1 (exclusive of 1 effectively)
    } while (x === 1);
    return min + Math.floor(x * range);
  }
  return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Deal N cards from the TOP of the deck.
 * Returns { hand, deck } where deck is the remaining deck (non-mutating).
 */
function dealFromTop(deck, count = 1) {
  const hand = deck.slice(-count);          // take from end to treat end as "top"
  const remaining = deck.slice(0, -count);
  return { hand, deck: remaining };
}

// ---- Scoring ----

/**
 * Score a hand with Ace as 11 then downgrade to 1 while busting.
 * Returns a number (total). Keep it simple for v0.
 */
function scoreHand(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === "A") {
      aces += 1;
      total += 11;
    } else if (c.r === "K" || c.r === "Q" || c.r === "J") {
      total += 10;
    } else {
      total += Number(c.r);
    }
  }
  // Downgrade Aces from 11 to 1 until no bust or no aces left
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

// ---- Helpers for specials & limits ----

/** First two cards form Blackjack: A + (10/J/Q/K) and totals 21. */
function isBlackjack(hand) {
  if (hand.length !== 2) return false;
  const ranks = hand.map((c) => c.r);
  const hasA = ranks.includes("A");
  const hasTenish = ranks.some((r) => r === "10" || r === "J" || r === "Q" || r === "K");
  return hasA && hasTenish && scoreHand(hand) === 21;
}

/** First two cards are both Aces. */
function isDoubleAce(hand) {
  return hand.length === 2 && hand[0].r === "A" && hand[1].r === "A";
}

/** Reached or exceeded the 5-card limit for your rules. */
function isFiveCard(hand) {
  return hand.length >= 5;
}

/** Hand is bust (> 21). */
function isBust(hand) {
  return scoreHand(hand) > 21;
}
