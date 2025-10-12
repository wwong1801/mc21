// src/game.js
import {
  createDeck, shuffleDeck, dealFromTop,
  scoreHand, isFiveCard, isBust, isBlackjack, isDoubleAce
} from "./rules.js";

/* -------------------- SFX helper (no files; WebAudio synth) -------------------- */
const sfx = (() => {
  let ctx;
  function ensureCtx() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  }
  function beep({freq=440, ms=120, type="sine", vol=0.12}) {
    ensureCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + ms/1000);
    o.start(now);
    o.stop(now + ms/1000);
  }
  const play = (name) => {
    // simple sound design
    if (name === "click") { beep({freq:700, ms:60, type:"square", vol:0.15}); return; }
    if (name === "deal")  { beep({freq:520, ms:90, type:"triangle", vol:0.12}); return; }
    if (name === "win")   { beep({freq:660, ms:120}); setTimeout(()=>beep({freq:880, ms:140}),110); return; }
    if (name === "lose")  { beep({freq:300, ms:160, type:"sawtooth"}); return; }
  };

  // unlock on first gesture
  const unlock = () => { try { ensureCtx(); } catch {} 
    window.removeEventListener("click", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock, {passive:true});
  };
  window.addEventListener("click", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock, {passive:true});

  return { play };
})();


/* -------------------- State -------------------- */
const state = {
  deck: [],
  player: [],
  dealer: [],
  phase: "idle",     // idle | player | dealer | done
  revealed: false,
  history: [],
  bet: 100,
};

/* -------------------- DOM -------------------- */
const dealerHandEl = document.getElementById("dealerHand");
const dealerTotalEl = document.getElementById("dealerTotal");
const playerHandEl = document.getElementById("playerHand");
const playerTotalEl = document.getElementById("playerTotal");
const bannerEl = document.getElementById("banner");

const btnNew = document.getElementById("newBtn");
const btnHit = document.getElementById("hitBtn");
const btnStand = document.getElementById("standBtn");
const betInput = document.getElementById("betInput");

/* Button click sfx */
[btnNew, btnHit, btnStand].forEach(btn => {
  if (!btn) return;
  btn.addEventListener("click", () => sfx.play("click"));
});

/* Keyboard shortcuts */
window.addEventListener("keydown", (e) => {
  if (e.key === "n" || e.key === "N") { sfx.play("click"); newRound(); }
  if (e.key === "h" || e.key === "H") { sfx.play("click"); onHit(); }
  if (e.key === "s" || e.key === "S") { sfx.play("click"); onStand(); }
});

/* Wire buttons */
btnNew?.addEventListener("click", newRound);
btnHit?.addEventListener("click", onHit);
btnStand?.addEventListener("click", onStand);

/* -------------------- Flow -------------------- */
function newRound() {
  // read bet (min 1)
  const b = Math.max(1, parseInt(betInput?.value || "100", 10) || 100);
  state.bet = b;
  if (betInput) betInput.value = String(b);

  state.deck = shuffleDeck(createDeck());
  state.player = [];
  state.dealer = [];
  state.phase = "player";
  state.revealed = false;
  hideBanner();

  setBetLocked(true);

  // initial deal: 2 each (play deal sfx twice)
  let pkg = dealFromTop(state.deck, 2);
  state.player = pkg.hand; state.deck = pkg.deck;
  sfx.play("deal");

  pkg = dealFromTop(state.deck, 2);
  state.dealer = pkg.hand; state.deck = pkg.deck;
  setTimeout(() => sfx.play("deal"), 80);

  render();
}

function onHit() {
  if (state.phase !== "player") return;

  const pkg = dealFromTop(state.deck, 1);
  state.player.push(...pkg.hand);
  state.deck = pkg.deck;

  sfx.play("deal");

  if (isFiveCard(state.player)) {
    showBanner("你已达到 5 张上限。进入结算…");
    dealerTurnAndSettle();
    return;
  }
  if (isBust(state.player)) {
    showBanner("玩家爆了（>21）。进入结算…");
    sfx.play("lose"); // bust sound
    dealerTurnAndSettle();
    return;
  }

  render();
}

function onStand() {
  if (state.phase !== "player") return;

  const pt = scoreHand(state.player);
  if (state.player.length === 2 && pt < 16) {
    showBanner("两张牌合计 < 16，必须要牌一次。");
    return;
  }

  dealerTurnAndSettle();
}

function dealerTurnAndSettle() {
  state.phase = "dealer";
  state.revealed = true;

  // Dealer draws with little delays for feel
  const step = () => {
    if (isBust(state.dealer) || isFiveCard(state.dealer) || scoreHand(state.dealer) >= 16) {
      const outcome = settleWithMCRules();
      endRound(outcome);
      return;
    }
    const pkg = dealFromTop(state.deck, 1);
    state.dealer.push(...pkg.hand);
    state.deck = pkg.deck;
    sfx.play("deal");
    render();
    setTimeout(step, 220);
  };

  render();
  setTimeout(step, 180);
}

/* -------------------- Outcome / payouts -------------------- */
function settleWithMCRules() {
  const p = state.player, d = state.dealer;
  const pt = scoreHand(p), dt = scoreHand(d);
  const pBust = pt > 21, dBust = dt > 21;
  const pFive = isFiveCard(p), dFive = isFiveCard(d);
  const pBJ = isBlackjack(p), dBJ = isBlackjack(d);
  const pAA = isDoubleAce(p), dAA = isDoubleAce(d);

  if (pFive && pt <= 21) return { text: "玩家五张 ≤21 · 双倍胜 (×2)", mult: 2, code: "P_5CARD_WIN" };
  if (pFive && pt > 21)  return { text: "玩家五张爆 · 双倍输 (−2×)", mult: -2, code: "P_5CARD_BUST" };

  if (pAA) return { text: "玩家双A · 三倍胜 (×3)", mult: 3, code: "P_AA" };
  if (pBJ) return { text: "玩家黑杰克 · 双倍胜 (×2)", mult: 2, code: "P_BJ" };

  if (pBust && dBust) return { text: "双方爆 · 庄家胜（规则）", mult: -1, code: "BOTH_BUST_D_WINS" };
  if (pBust)           return { text: "玩家爆 · 庄家胜",       mult: -1, code: "P_BUST" };
  if (dBust)           return { text: "庄家爆 · 玩家胜",       mult:  1, code: "D_BUST" };

  if (pt === dt) return { text: "点数相同 · 和局 (Push)", mult: 0, code: "PUSH" };
  if ((21 - pt) < (21 - dt)) return { text: "玩家更接近 21 · 单倍胜 (×1)", mult: 1, code: "P_NORMAL_WIN" };
  return { text: "庄家更接近 21 · 玩家负 (×1)", mult: -1, code: "P_NORMAL_LOSE" };
}

function endRound(res) {
  state.phase = "done";

  const bet = state.bet;
  const delta = bet * res.mult;
  const sign = delta > 0 ? "+" : "";
  showBanner(`${res.text} · 下注：${bet} · 变动：${sign}${delta}`);

  // win/lose sounds
  if (res.mult > 0) sfx.play("win");
  else if (res.mult < 0) sfx.play("lose");

  setBetLocked(false);

  state.history.unshift({
    t: new Date().toLocaleString(),
    p: state.player.map(c => c.r + c.s).join(" "),
    d: state.dealer.map(c => c.r + c.s).join(" "),
    pt: scoreHand(state.player),
    dt: scoreHand(state.dealer),
    code: res.code, mult: res.mult, bet, delta
  });
  state.history = state.history.slice(0, 10);

  render();
}

/* -------------------- View helpers -------------------- */
function showBanner(msg) { bannerEl.hidden = false; bannerEl.textContent = msg; }
function hideBanner() { bannerEl.hidden = true; bannerEl.textContent = ""; }
function setBetLocked(locked) { if (betInput) betInput.disabled = locked; }

function render() {
  // dealer
  dealerHandEl.innerHTML = "";
  state.dealer.forEach((c) => {
    const div = document.createElement("div");
    if (state.revealed) {
      div.className = "card";
      div.textContent = `${c.r}${c.s}`;
    } else {
      div.className = "card back";
      div.textContent = "🂠";
    }
    dealerHandEl.appendChild(div);
  });
  dealerTotalEl.textContent = state.revealed ? `点数：${scoreHand(state.dealer)}` : "点数：—（未公开）";

  // player
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

  btnNew.disabled   = (state.phase === "player" || state.phase === "dealer");
  btnHit.disabled   = !(state.phase === "player") || playerFull || playerBust;
  btnStand.disabled = !(state.phase === "player") || mustHitAfterTwo || playerBust;
}

/* boot */
newRound();
