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
// next card down each tied player's pile until the tie breaks. In the
// astronomically unlikely case every tied pile is identical all the way
// down, the remaining candidates are picked at random.
function determineFirstPlayer() {
  let candidates = state.players.map((_, i) => i);
  let depth = 1; // 1 = top (face-up) card, 2 = next card down, etc.
  while (candidates.length > 1) {
    let bestRank = -1;
    let next = [];
    for (const i of candidates) {
      const pile = state.players[i].goalPile;
      const card = pile[pile.length - depth];
      if (!card) continue; // this pile is exhausted at this depth
      const rank = VALUES.indexOf(card.value);
      if (rank > bestRank) {
        bestRank = rank;
        next = [i];
      } else if (rank === bestRank) {
        next.push(i);
      }
    }
    if (next.length === 0) break; // every candidate exhausted — fall back to random below
    candidates = next;
    depth++;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
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

// The real post-play length of a stack after adding one card: 0 if this
// completes it, since checkStackCompletion immediately clears a finished
// stack away. AI risk/lookahead code must use this instead of a raw +1, or
// it ends up predicting exposure against a length-12 state that can never
// actually exist.
function afterPlayLen(currentLen) {
  const next = currentLen + 1;
  return next === STACK_LENGTH ? 0 : next;
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
  checkStalemate();
}

// True dead end: no cards left to ever draw (stock and reserve both empty)
// and no player -- via goal pile, side stacks, or hand -- has any card that
// legally fits any center stack right now. Since nothing can complete a
// center stack from here, the reserve can never refill either, so this
// state can never change on its own.
function hasAnyLegalPlay() {
  return state.players.some(p => {
    if (p.finished) return false;
    const goalCard = topOf(p.goalPile);
    if (goalCard && legalCenterTargets(goalCard).length) return true;
    if (p.sideStacks.some(s => { const c = topOf(s); return c && legalCenterTargets(c).length; })) return true;
    return p.hand.some(c => legalCenterTargets(c).length);
  });
}

function checkStalemate() {
  if (state.phase === 'playing' && state.stock.length === 0 && state.reserve.length === 0 && !hasAnyLegalPlay()) {
    state.phase = 'stalemate';
  }
}

// ── AI decision-making ───────────────────────────────────────────────────────
//
// The AI plans its whole turn rather than grabbing one card at a time. It
// searches every order it could play its cards in -- including stopping
// early and holding cards back -- and picks the sequence whose final board
// scores best: its own progress, minus every way the board it leaves behind
// lets an opponent play from their goal pile. computeAiPlay re-plans from
// scratch before every single play, so a mid-turn hand refill (five new,
// previously unseen cards) is picked up naturally on the next call.

const AI_SCORE = {
  WIN: 1e6,
  OWN_GOAL_CARD: 100, // each of our own goal cards played this turn
  OWN_GOAL_READY: 20, // our next goal card left close to playable (scaled by GAP_PROB)
  SIDE_CARD: 6,       // each side-stack card cleared -- unburies the one beneath
  HAND_CARD: 2,       // each hand card played -- more fresh cards drawn next turn
  KING_SPENT: -12,    // a King played from hand is a wildcard we no longer hold
  REFILL: 25,         // emptying the hand mid-turn draws five more and the turn continues
  OPP_GOAL_CARD: 80,  // an opponent goal card we leave playable (scaled by threat and GAP_PROB)
};

// Chance an opponent can reach their goal card when the nearest center stack
// is `gap` cards short of it. 0 = already playable. Beyond that they need the
// missing rank(s) -- or a wild King -- in a hand we can't see: with two decks,
// roughly half the time for one specific rank, much less for two in a row.
const GAP_PROB = [1, 0.5, 0.15, 0.04];

// How much an opponent's goal card is worth denying, keyed by how many goal
// cards they have left. Every goal card counts all game long, but the closer
// they are to winning the more each one matters; at one card left, letting
// them play it is a loss, which nothing short of our own win outweighs.
function oppThreatMultiplier(goalPileLength) {
  if (goalPileLength === 1) return 50;
  if (goalPileLength === 2) return 3;
  if (goalPileLength <= 4) return 1.5;
  return 1;
}

// Gap (0-3, or Infinity) between `goalCard` and the nearest center stack it
// could eventually land on, after first chaining whatever `sideTops` (cards
// face-up and visible to everyone) can legally play. Hand cards are never
// considered here: an opponent's hand is hidden information, which is what
// GAP_PROB is for.
function goalCardGap(goalCard, lens, sideTops) {
  if (isWild(goalCard)) return 0;
  const workingLens = lens.slice();
  const used = new Array(sideTops.length).fill(false);
  let progressed = true;
  while (progressed) {
    if (workingLens.some(len => matchesCenterPos(goalCard, len))) return 0;
    progressed = false;
    for (let i = 0; i < sideTops.length; i++) {
      if (used[i] || !sideTops[i]) continue;
      const idx = workingLens.findIndex(len => matchesCenterPos(sideTops[i], len));
      if (idx !== -1) {
        workingLens[idx] = afterPlayLen(workingLens[idx]);
        used[i] = true;
        progressed = true;
      }
    }
  }
  const pos = RANK_SEQ.indexOf(goalCard.value);
  let gap = Infinity;
  for (const len of workingLens) if (len <= pos) gap = Math.min(gap, pos - len);
  return gap;
}

function gapProb(gap) {
  return gap < GAP_PROB.length ? GAP_PROB[gap] : 0;
}

// Score of ending our turn on center stack lengths `lens`, having made the
// plays recorded in the other arguments.
function scoreAiTurnEnd(playerIdx, lens, goalUsed, sideUsed, handMask, hand) {
  const p = state.players[playerIdx];
  let score = goalUsed * AI_SCORE.OWN_GOAL_CARD;

  sideUsed.forEach(n => { score += n * AI_SCORE.SIDE_CARD; });
  hand.forEach((card, j) => {
    if (!(handMask & (1 << j))) return;
    score += AI_SCORE.HAND_CARD + (isWild(card) ? AI_SCORE.KING_SPENT : 0);
  });

  const ownGoal = p.goalPile[p.goalPile.length - 1 - goalUsed];
  if (ownGoal) {
    const ownSideTops = p.sideStacks.map((s, i) => s[s.length - 1 - sideUsed[i]] || null);
    score += AI_SCORE.OWN_GOAL_READY * gapProb(goalCardGap(ownGoal, lens, ownSideTops));
  }

  const n = state.players.length;
  state.players.forEach((opp, oppIdx) => {
    if (oppIdx === playerIdx || opp.finished || opp.goalPile.length === 0) return;
    const prob = gapProb(goalCardGap(topOf(opp.goalPile), lens, opp.sideStacks.map(topOf)));
    if (!prob) return;
    // The next player to move gets the board exactly as we leave it; anyone
    // further around the table sees it only after others have changed it.
    const turnWeight = (oppIdx - playerIdx + n) % n === 1 ? 1 : 0.5;
    score -= AI_SCORE.OPP_GOAL_CARD * oppThreatMultiplier(opp.goalPile.length) * prob * turnWeight;
  });

  return score;
}

// Searches every sequence of plays available this turn and returns
// { score, move }, where move is the first play of the best sequence
// ({ source, targetLen }) or null if the best option is to stop playing now.
// Center stacks are interchangeable apart from their lengths, so plays are
// expressed by target length and states are memoized on sorted lengths.
const AI_SEARCH_NODE_LIMIT = 15000;

function planAiTurn(playerIdx) {
  const p = state.players[playerIdx];
  const hand = p.hand.slice();
  const fullHandMask = (1 << hand.length) - 1;
  const memo = new Map();
  let nodes = 0;

  function search(lens, goalUsed, sideUsed, handMask) {
    const key = `${lens.slice().sort((a, b) => a - b).join(',')}|${goalUsed}|${sideUsed.join(',')}|${handMask}`;
    const cached = memo.get(key);
    if (cached) return cached;

    let best = { score: scoreAiTurnEnd(playerIdx, lens, goalUsed, sideUsed, handMask, hand), move: null };
    if (++nodes > AI_SEARCH_NODE_LIMIT) { memo.set(key, best); return best; }

    const sources = [];
    const goalCard = p.goalPile[p.goalPile.length - 1 - goalUsed];
    if (goalCard) sources.push({ card: goalCard, source: { type: 'goal' } });
    p.sideStacks.forEach((s, i) => {
      const card = s[s.length - 1 - sideUsed[i]];
      if (card) sources.push({ card, source: { type: 'side', idx: i } });
    });
    const seenValues = new Set();
    hand.forEach((card, j) => {
      if ((handMask & (1 << j)) || seenValues.has(card.value)) return;
      seenValues.add(card.value);
      sources.push({ card, source: { type: 'hand', cardId: card.id }, handBit: 1 << j });
    });

    for (const { card, source, handBit } of sources) {
      const triedLens = new Set();
      for (const len of lens) {
        if (triedLens.has(len) || !matchesCenterPos(card, len)) continue;
        triedLens.add(len);
        const move = { source, targetLen: len };

        // Our last goal card ends the game on the spot.
        if (source.type === 'goal' && goalUsed + 1 === p.goalPile.length) {
          best = { score: AI_SCORE.WIN, move };
          memo.set(key, best);
          return best;
        }

        const nextLens = lens.slice();
        nextLens[nextLens.indexOf(len)] = afterPlayLen(len);
        const nextGoalUsed = goalUsed + (source.type === 'goal' ? 1 : 0);
        const nextSideUsed = source.type === 'side'
          ? sideUsed.map((n, i) => (i === source.idx ? n + 1 : n))
          : sideUsed;
        const nextHandMask = handMask | (handBit || 0);

        let score;
        if (handBit && nextHandMask === fullHandMask) {
          // Emptying the hand refills it with unseen cards; value the refill
          // and re-plan once it actually happens.
          score = scoreAiTurnEnd(playerIdx, nextLens, nextGoalUsed, nextSideUsed, nextHandMask, hand) + AI_SCORE.REFILL;
        } else {
          score = search(nextLens, nextGoalUsed, nextSideUsed, nextHandMask).score;
        }
        if (score > best.score) best = { score, move };
      }
    }

    memo.set(key, best);
    return best;
  }

  return search(state.centerStacks.map(s => s.length), 0, p.sideStacks.map(() => 0), 0);
}

// Returns the next play of the AI's best plan for this turn ({ source,
// stackIdx }), or null if the plan is to stop playing and discard.
function computeAiPlay(playerIdx) {
  const { move } = planAiTurn(playerIdx);
  if (!move) return null;
  const stackIdx = state.centerStacks.findIndex(s => s.length === move.targetLen);
  return { source: move.source, stackIdx };
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
