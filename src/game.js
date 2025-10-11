// src/game.js
import {
  createDeck, shuffleDeck, dealFromTop,
  scoreHand, isFiveCard, isBust
} from "./rules.js";

// --- State ---
const state = {
  deck: [],
  player: [],
  dealer: [],
  phase: "idle",     // idle | player | done
  revealed: false,   // dealer hidden this phase
};

// --- DOM ---
const dealerHandEl = document.getElementById("dealerHand");
const dealerTotalEl = document.getElementById("dealerTotal");
const playerHandEl = document.getElementById("playerHand");
const playerTotalEl = document.getElementById("playerTotal");
const bannerEl = document.getElementById("banner");

const btnNew = document.getElementById("newBtn");
const btnHit = document.getElementById("hitBtn");
const btnStand = document.getElementById("standBtn");

btnNew.addEventListener("click", newRound);
btnHit.addEventListener("click", onHit);
btnStand.addEventListener("click", onStand);

window.addEventListener("keydown", (e) => {
  if (e.key === "n" || e.key === "N") newRound();
  if (e.key === "h" || e.key === "H") onHit();
  if (e.key === "s" || e.key === "S") onStand();
});

// --- Flow ---
function newRound() {
  state.deck = shuffleDeck(createDeck());
  state.player = [];
  state.dealer = [];
  state.phase = "player";
  state.revealed = false;
  bannerEl.hidden = true; bannerEl.textContent = "";

  // initial deal: 2 each (dealer hidden)
  let pkg = dealFromTop(state.deck, 2);
  state.player = pkg.hand; state.deck = pkg.deck;

  pkg = dealFromTop(state.deck, 2);
  state.dealer = pkg.hand; state.deck = pkg.deck;

  render();
}

function onHit() {
  if (state.phase !== "player") return;
  // draw 1
  const pkg = dealFromTop(state.deck, 1);
  state.player.push(...pkg.hand);
  state.deck = pkg.deck;

  // If max 5 reached or bust, lock round (dealer to be added next phase)
  if (isFiveCard(state.player)) {
    showBanner("你已达到 5 张上限。");
    lockRound();
  } else if (isBust(state.player)) {
    showBanner("玩家爆了（>21）。");
    lockRound();
  }
  render();
}

function onStand() {
  if (state.phase !== "player") return;

  // Rule: after exactly 2 cards, if total < 16 → must hit
  const pt = scoreHand(state.player);
  if (state.player.length === 2 && pt < 16) {
    showBanner("两张牌合计 < 16，必须要牌一次。");
    return;
  }

  // For this phase we stop here (dealer logic next phase)
  showBanner("玩家停牌（下一阶段将加入庄家逻辑）");
  lockRound();
  render();
}

// --- Helpers ---
function lockRound() {
  state.phase = "done";
}

function showBanner(msg) {
  bannerEl.hidden = false;
  bannerEl.textContent = msg;
}

function render() {
  // dealer (hidden)
  dealerHandEl.innerHTML = "";
  state.dealer.forEach(() => {
    const div = document.createElement("div");
    div.className = "card back";
    div.textContent = "🂠";
    dealerHandEl.appendChild(div);
  });
  dealerTotalEl.textContent = "点数：—（未公开）";

  // player (visible)
  playerHandEl.innerHTML = "";
  state.player.forEach((c) => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = `${c.r}${c.s}`;
    playerHandEl.appendChild(div);
  });
  playerTotalEl.textContent = `点数：${scoreHand(state.player)}`;

  // buttons
  const pt = scoreHand(state.player);
  const mustHitAfterTwo = (state.player.length === 2 && pt < 16);
  const playerFull = isFiveCard(state.player);
  const playerBust = isBust(state.player);

  btnNew.disabled  = (state.phase === "player");
  btnHit.disabled  = !(state.phase === "player") || playerFull || playerBust;
  btnStand.disabled = !(state.phase === "player") || mustHitAfterTwo || playerBust;
}

// start once
newRound();
