// ── Game state ────────────────────────────────────────────────────────────────

const DEFAULT_HUMAN_NAME = 'Emma';
const DEFAULT_AI_NAMES = ['Kate', 'Jack', 'Andrew'];
const DEFAULT_GOAL_PILE_SIZE = 20;
const MIN_GOAL_PILE_SIZE = 12;
const MAX_GOAL_PILE_SIZE = 26;
const HAND_SIZE = 5;
const SIDE_STACK_COUNT = 4;
const CENTER_STACK_COUNT = 4;

function loadStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

const state = {
  players: [],        // { name, isHuman, goalPile:[], sideStacks:[[],[],[],[]], hand:[], finished }
  centerStacks: [],    // 4 slots, each an array of cards played in sequence (A..Q)
  reserve: [],         // cards from completed center stacks, reshuffled into stock when it runs dry
  stock: [],           // face-down draw pile (top = last element)
  currentTurn: 0,
  phase: 'start',      // 'start' | 'playing' | 'gameEnd'
  winner: null,
  settings: {
    numPlayers: 2,
    humanName: loadStored('spiteMaliceHumanName', DEFAULT_HUMAN_NAME),
    aiNames: loadStored('spiteMaliceAiNames', [...DEFAULT_AI_NAMES]),
    gameName: loadStored('spiteMaliceGameName', 'Spite and Malice'),
    cardBack: loadStored('spiteMaliceCardBack', 'blue'),
    goalPileSize: loadStored('spiteMaliceGoalPileSize', DEFAULT_GOAL_PILE_SIZE),
    aiDelay: 1000,
  },
};

function topOf(pile) {
  return pile.length ? pile[pile.length - 1] : null;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function newGame(settings) {
  state.settings = { ...state.settings, ...settings };
  const numPlayers = state.settings.numPlayers;
  const goalPileSize = Math.min(MAX_GOAL_PILE_SIZE, Math.max(MIN_GOAL_PILE_SIZE, state.settings.goalPileSize || DEFAULT_GOAL_PILE_SIZE));
  state.settings.goalPileSize = goalPileSize;

  let deck = shuffle(buildDeck(numPlayers)); // 1 deck per player keeps the card pool comfortable

  // Randomize which AI identities show up (and in what order) each game,
  // rather than always facing the same opponent(s) in the same slots.
  const aiNamePool = (state.settings.aiNames && state.settings.aiNames.length) ? state.settings.aiNames : DEFAULT_AI_NAMES;
  const shuffledAiNames = shuffle(aiNamePool);

  state.players = [];
  for (let i = 0; i < numPlayers; i++) {
    state.players.push({
      name: i === 0 ? (state.settings.humanName || 'You') : (shuffledAiNames[i - 1] || DEFAULT_AI_NAMES[i - 1] || `AI ${i}`),
      isHuman: i === 0,
      goalPile: deck.splice(0, goalPileSize),
      sideStacks: Array.from({ length: SIDE_STACK_COUNT }, () => []),
      hand: [],
      finished: false,
    });
  }

  state.stock = deck;
  state.centerStacks = Array.from({ length: CENTER_STACK_COUNT }, () => []);
  state.reserve = [];
  state.winner = null;
  state.phase = 'playing';
  state.currentTurn = determineFirstPlayer();

  drawToFive(state.players[state.currentTurn]);
}

// Highest face-up goal-pile card goes first; ties are broken by comparing the
// next card down each tied player's pile until the tie breaks.
function determineFirstPlayer() {
  return Math.floor(Math.random() * state.players.length);
}

// ── Draw ──────────────────────────────────────────────────────────────────────

function reshuffleReserveIntoStock() {
  if (state.reserve.length === 0) return;
  state.stock = shuffle(state.reserve);
  state.reserve = [];
}

function drawToFive(player) {
  while (player.hand.length < HAND_SIZE) {
    if (state.stock.length === 0) {
      reshuffleReserveIntoStock();
      if (state.stock.length === 0) break; // no cards left anywhere; draw what we can
    }
    player.hand.push(state.stock.pop());
  }
}

// ── Playing to the center ────────────────────────────────────────────────────

function currentPlayer() {
  return state.players[state.currentTurn];
}

function getSourceCard(playerIdx, source) {
  const p = state.players[playerIdx];
  if (source.type === 'goal') return topOf(p.goalPile);
  if (source.type === 'side') return topOf(p.sideStacks[source.idx]);
  if (source.type === 'hand') return p.hand.find(c => c.id === source.cardId) || null;
  return null;
}

// Which center stack slots (0-3) will legally accept this card right now?
function legalCenterTargets(card) {
  const targets = [];
  state.centerStacks.forEach((stack, idx) => {
    if (matchesCenterPos(card, stack.length)) targets.push(idx);
  });
  return targets;
}

function removeSourceCard(playerIdx, source) {
  const p = state.players[playerIdx];
  if (source.type === 'goal') return p.goalPile.pop();
  if (source.type === 'side') return p.sideStacks[source.idx].pop();
  if (source.type === 'hand') {
    const i = p.hand.findIndex(c => c.id === source.cardId);
    return i === -1 ? null : p.hand.splice(i, 1)[0];
  }
  return null;
}

function checkStackCompletion(stackIdx) {
  if (state.centerStacks[stackIdx].length >= STACK_LENGTH) {
    state.reserve.push(...state.centerStacks[stackIdx]);
    state.centerStacks[stackIdx] = [];
  }
}

// source: { type: 'goal' } | { type: 'side', idx } | { type: 'hand', cardId }
function playToCenter(playerIdx, source, stackIdx) {
  const card = getSourceCard(playerIdx, source);
  if (!card) return { ok: false, error: 'No such card' };
  if (!matchesCenterPos(card, state.centerStacks[stackIdx].length)) {
    return { ok: false, error: 'Illegal play' };
  }

  removeSourceCard(playerIdx, source);
  state.centerStacks[stackIdx].push(card);
  checkStackCompletion(stackIdx);

  const p = state.players[playerIdx];
  if (source.type === 'goal' && p.goalPile.length === 0) {
    p.finished = true;
    state.phase = 'gameEnd';
    state.winner = playerIdx;
  }

  // Playing out a full hand mid-turn refills it immediately so the turn
  // continues instead of leaving the player stuck with nothing to discard.
  if (state.phase === 'playing' && p.hand.length === 0) {
    drawToFive(p);
  }

  return { ok: true };
}

// ── Discard (ends the turn) ──────────────────────────────────────────────────

function discardToSideStack(playerIdx, cardId, sideIdx) {
  const p = state.players[playerIdx];
  const i = p.hand.findIndex(c => c.id === cardId);
  if (i === -1) return { ok: false, error: 'No such card in hand' };
  const [card] = p.hand.splice(i, 1);
  p.sideStacks[sideIdx].push(card);
  return { ok: true };
}

function endTurn() {
  state.currentTurn = (state.currentTurn + 1) % state.players.length;
  drawToFive(currentPlayer());
}

// ── AI decision-making ───────────────────────────────────────────────────────

// How urgent it is to avoid exposing an opponent's current goal-pile card,
// keyed by how many cards are left in their goal pile. 3 = they'd very
// likely win outright on their next turn; 0 = far enough out not to matter.
function baseExposureUrgency(goalPileLength) {
  if (goalPileLength === 1) return 3;
  if (goalPileLength === 2) return 2;
  if (goalPileLength <= 4) return 1;
  return 0;
}

// If we're already this far behind a threatened opponent, playing defense
// against them costs tempo we can't spare -- they'll likely find another
// opening soon regardless, so there's little point sacrificing our own
// plays to delay them. Ease off by a tier instead.
const DESPERATION_GAP = 6;

// Worst-case urgency (0-3) of growing centerStacks[stackIdx] to newLen,
// across every active opponent it would expose -- using only cards already
// visible to every player (their goal-pile top and side-stack tops, chained
// through the center stacks). Never their hand, which is hidden information
// in the real game.
function worstExposureUrgency(playerIdx, stackIdx, newLen) {
  const lens = state.centerStacks.map((s, i) => (i === stackIdx ? newLen : s.length));
  const self = state.players[playerIdx];
  let worst = 0;

  state.players.forEach((opp, oppIdx) => {
    if (oppIdx === playerIdx || opp.finished || opp.goalPile.length === 0) return;
    const baseUrgency = baseExposureUrgency(opp.goalPile.length);
    if (baseUrgency === 0) return;

    const goalCard = topOf(opp.goalPile);
    const workingLens = lens.slice();
    const used = new Array(opp.sideStacks.length).fill(false);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < opp.sideStacks.length; i++) {
        if (used[i] || opp.sideStacks[i].length === 0) continue;
        const card = topOf(opp.sideStacks[i]);
        const idx = workingLens.findIndex(len => matchesCenterPos(card, len));
        if (idx !== -1) {
          workingLens[idx]++;
          used[i] = true;
          progressed = true;
        }
      }
    }
    if (!workingLens.some(len => matchesCenterPos(goalCard, len))) return;

    const urgency = self.goalPile.length - opp.goalPile.length >= DESPERATION_GAP ? baseUrgency - 1 : baseUrgency;
    worst = Math.max(worst, urgency);
  });

  return worst;
}

// Urgency of playing `source` onto centerStacks[stackIdx] (growing it to
// newLen). Goal-pile plays get a trade offset: if removing our own top goal
// card immediately hands us a legal play for the card beneath it, exposing
// an opponent is far more acceptable since we get something concrete back
// the same turn.
function playUrgency(playerIdx, source, stackIdx, newLen) {
  if (setsUpImmediateWin(playerIdx, source, newLen)) return 0;

  const urgency = worstExposureUrgency(playerIdx, stackIdx, newLen);
  if (urgency === 0 || source.type !== 'goal') return urgency;

  const p = state.players[playerIdx];
  const nextCard = p.goalPile[p.goalPile.length - 2];
  if (!nextCard) return urgency;

  const lens = state.centerStacks.map((s, i) => (i === stackIdx ? newLen : s.length));
  return lens.some(len => matchesCenterPos(nextCard, len)) ? Math.max(0, urgency - 2) : urgency;
}

// Would playing `source` onto centerStacks[stackIdx] (growing it to newLen)
// immediately open a legal spot for our own current goal-pile card? A card
// with several legal targets -- most notably a wild King -- should chain
// into our own goal pile whenever it can, since advancing the goal pile is
// how we actually win; that always outranks generic "extend the tallest
// stack" tie-breaking.
function enablesOwnGoalFollowUp(playerIdx, source, newLen) {
  if (source.type === 'goal') return false;
  const goalCard = topOf(state.players[playerIdx].goalPile);
  return goalCard != null && matchesCenterPos(goalCard, newLen);
}

// If our goal pile is down to its last card, does playing `source` onto
// centerStacks[stackIdx] set up an immediate win -- i.e. will that final
// goal card now have a legal target? If so the game ends on our very next
// move this same turn, before any opponent gets a turn to exploit whatever
// this exposed, so ordinary exposure-risk checks don't apply.
function setsUpImmediateWin(playerIdx, source, newLen) {
  const p = state.players[playerIdx];
  return source.type !== 'goal' && p.goalPile.length === 1 && matchesCenterPos(topOf(p.goalPile), newLen);
}

// Prefer continuing the most-advanced stack so completed stacks recycle
// sooner, but steer away from targets with higher exposure urgency (see
// playUrgency) whenever a less risky legal target is available, and prefer
// a target that chains into our own goal pile over either of those.
function pickBestTarget(playerIdx, source, targets) {
  const urgencies = targets.map(t => playUrgency(playerIdx, source, t, state.centerStacks[t].length + 1));
  const minUrgency = Math.min(...urgencies);
  const pool = targets.filter((t, i) => urgencies[i] === minUrgency);

  const chaining = pool.filter(t => enablesOwnGoalFollowUp(playerIdx, source, state.centerStacks[t].length + 1));
  const finalPool = chaining.length ? chaining : pool;

  return finalPool.reduce((best, t) =>
    state.centerStacks[t].length > state.centerStacks[best].length ? t : best, finalPool[0]);
}

// Returns the best available play for playerIdx, or null if none exists --
// including the case where every legal play is too dangerous to make (see
// playUrgency), in which case the AI deliberately holds back and just discards.
function computeAiPlay(playerIdx) {
  const p = state.players[playerIdx];
  const candidates = [];

  if (p.goalPile.length > 0) {
    const card = topOf(p.goalPile);
    const targets = legalCenterTargets(card);
    if (targets.length) candidates.push({ priority: 0, source: { type: 'goal' }, stackIdx: pickBestTarget(playerIdx, { type: 'goal' }, targets) });
  }

  // After the goal pile, clearing side stacks outranks the hand -- freeing a
  // blocked side stack unlocks whatever's buried beneath it, whereas hand
  // cards are better held back to connect plays or cover the end-of-turn
  // discard. Kings stay lowest of all, saved for when nothing else fits.
  p.sideStacks.forEach((s, idx) => {
    if (s.length === 0) return;
    const card = topOf(s);
    const targets = legalCenterTargets(card);
    if (targets.length) candidates.push({ priority: 1, source: { type: 'side', idx }, stackIdx: pickBestTarget(playerIdx, { type: 'side', idx }, targets) });
  });

  p.hand.forEach(card => {
    if (isWild(card)) return;
    const targets = legalCenterTargets(card);
    if (targets.length) candidates.push({ priority: 2, source: { type: 'hand', cardId: card.id }, stackIdx: pickBestTarget(playerIdx, { type: 'hand', cardId: card.id }, targets) });
  });

  p.hand.forEach(card => {
    if (!isWild(card)) return;
    const targets = legalCenterTargets(card);
    if (targets.length) candidates.push({ priority: 3, source: { type: 'hand', cardId: card.id }, stackIdx: pickBestTarget(playerIdx, { type: 'hand', cardId: card.id }, targets) });
  });

  if (!candidates.length) return null;

  // Finishing our goal pile -- or setting up an unstoppable follow-up that
  // will finish it on the very next iteration this same turn (see
  // setsUpImmediateWin) -- ends the game before any opponent gets another
  // turn. That overrides normal source-type priority and safety checks, so
  // a wild King setting up the win beats a mundane side-stack play every
  // time, not just when the goal card already happens to sort first.
  const winningPlay = candidates.find(c =>
    (c.source.type === 'goal' && p.goalPile.length === 1) ||
    setsUpImmediateWin(playerIdx, c.source, state.centerStacks[c.stackIdx].length + 1));
  if (winningPlay) return winningPlay;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Among equally-ranked side-stack plays, clear the most-blocked (tallest) one first.
    if (a.source.type === 'side' && b.source.type === 'side') {
      return p.sideStacks[b.source.idx].length - p.sideStacks[a.source.idx].length;
    }
    return 0;
  });

  // Rule out only the critical-urgency plays (tier 3 -- an opponent who'd
  // very likely win outright next turn); anything milder is an acceptable
  // trade-off, not a reason to skip a play. If every candidate is that
  // dangerous, we deliberately pass on playing this cycle -- unless
  // worstExposureUrgency has already discounted it for desperation, in
  // which case it won't reach tier 3 and we'll take it below.
  const acceptable = candidates.filter(c => playUrgency(playerIdx, c.source, c.stackIdx, state.centerStacks[c.stackIdx].length + 1) < 3);
  return acceptable.length ? acceptable[0] : null;
}

const SIDE_STACK_RANK_VALUE = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };

// Chooses where to discard `card` among the player's side stacks:
//  1. Continue a descending "staircase" (this card sits one rank below an
//     existing stack's top) so the pile stays organized and the next card
//     it exposes is already the next logical one to unbury.
//  2. Otherwise keep at least one stack completely open as a safety valve --
//     only start a new stack while 2 or fewer are already in use.
//  3. Otherwise balance by adding to whichever active stack is shortest.
function pickAiSideStackTarget(player, card) {
  const cardVal = SIDE_STACK_RANK_VALUE[card.value];
  if (cardVal != null) {
    const staircaseIdx = player.sideStacks.findIndex(s =>
      s.length > 0 && SIDE_STACK_RANK_VALUE[topOf(s).value] === cardVal + 1);
    if (staircaseIdx !== -1) return staircaseIdx;
  }

  const nonEmpty = player.sideStacks.filter(s => s.length > 0).length;
  if (nonEmpty < player.sideStacks.length - 1) {
    const emptyIdx = player.sideStacks.findIndex(s => s.length === 0);
    if (emptyIdx !== -1) return emptyIdx;
  }

  let best = -1;
  player.sideStacks.forEach((s, i) => {
    if (s.length > 0 && (best === -1 || s.length < player.sideStacks[best].length)) best = i;
  });
  if (best !== -1) return best;

  const emptyIdx = player.sideStacks.findIndex(s => s.length === 0);
  return emptyIdx !== -1 ? emptyIdx : 0;
}

// Returns { cardId, sideIdx } for the AI's mandatory end-of-turn discard, or
// null if the hand is empty (nothing left to discard).
function computeAiDiscard(playerIdx) {
  const p = state.players[playerIdx];
  if (p.hand.length === 0) return null;

  const RANK_ORDER = { A: 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8, '10': 9, J: 10, Q: 11, K: 12 };

  // A card buried in a side stack never returns to the shared stock (unlike
  // one played to a center stack, which recirculates once that stack
  // completes). So if an opponent's goal pile is topped with a rank we're
  // holding, burying that rank denies them the chance to ever draw it back.
  const opponentWantedRanks = new Set(
    state.players
      .filter((pl, i) => i !== playerIdx && !pl.finished && pl.goalPile.length > 0)
      .map(pl => topOf(pl.goalPile).value)
  );

  // Keep Kings (wild) and Aces (stack-starters) in hand as long as possible;
  // among ordinary cards, shed the highest ranks first, favoring cards an
  // opponent is stuck waiting on.
  const scored = p.hand.map(c => {
    if (c.value === 'K') return { card: c, score: -2 };
    if (c.value === 'A') return { card: c, score: -1 };
    let score = RANK_ORDER[c.value];
    if (opponentWantedRanks.has(c.value)) score += 15;
    return { card: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const choice = scored[0].card;

  const sideIdx = pickAiSideStackTarget(p, choice);

  return { cardId: choice.id, sideIdx };
}
