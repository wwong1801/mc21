// src/multiplayer/shoe.js
import { createDeck, shuffleDeck } from "../rules.js";

/** Build a multi-deck shoe (default 6 decks), shuffled. */
export function buildShoe(decks = 6) {
  let all = [];
  for (let i = 0; i < decks; i++) all = all.concat(createDeck());
  const cards = shuffleDeck(all); // our rules.js returns new shuffled array
  return {
    cards,                         // array of { s, r }
    cutCardAt: Math.floor(cards.length * 0.75),
    cardsLeft: cards.length,
    decks
  };
}

/** Draw N cards from shoe "top" (we use end of array as top). Mutates the shoe object. */
export function drawFromShoe(shoe, n = 1) {
  const hand = shoe.cards.slice(-n);
  shoe.cards = shoe.cards.slice(0, -n);
  shoe.cardsLeft = shoe.cards.length;
  return hand;
}

/** Whether the shoe needs a reshuffle (hit cut card). */
export function needsShuffle(shoe) {
  return !shoe || !Array.isArray(shoe.cards) || shoe.cards.length <= (shoe.cutCardAt || 0);
}
