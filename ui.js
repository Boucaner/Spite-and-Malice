// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const elOpponentsRow    = $('opponents-row');
const elStockPile       = $('stock-pile');
const elCenterStacks    = $('center-stacks');
const elPlayerName      = $('player-name');
const elTurnIndicator   = $('turn-indicator');
const elPlayerGoalPile  = $('player-goal-pile');
const elPlayerSideStacks = $('player-side-stacks');
const elHand            = $('hand');
const elStatusMsg       = $('status-msg');
const elModalSettings   = $('modal-settings');
const elModalGameOver   = $('modal-gameover');
const elModalPileView   = $('modal-pile-view');

const STACK_PREVIEW_COUNT = 2; // side stacks only show their top N cards in place

let selected = null; // { type:'goal' } | { type:'side', idx } | { type:'hand', cardId }

console.log('%c[Spite and Malice] ui.js loaded', 'color:lime;font-weight:bold');

// ── Boot ──────────────────────────────────────────────────────────────────────

function bootGame(settings) {
  newGame(settings || {});
  selected = null;
  $('modal-gameover').classList.add('hidden');
  render();
  scheduleAiIfNeeded();
}

document.addEventListener('DOMContentLoaded', () => bootGame({}));

$('btn-new-game').addEventListener('click', () => bootGame(state.settings));

// ── Settings modal ────────────────────────────────────────────────────────────

$('btn-settings').addEventListener('click', () => {
  $('setting-game-name').value = state.settings.gameName;
  $('setting-players').value = String(state.settings.numPlayers);
  $('setting-ai-speed').value = String(state.settings.aiDelay);
  $('setting-your-name').value = state.settings.humanName || '';
  $('setting-goal-pile-size').value = String(state.settings.goalPileSize);
  for (let i = 1; i <= 3; i++) {
    $(`ai-name-${i}`).value = state.settings.aiNames[i - 1] || '';
  }
  syncCardBackPicker();
  elModalSettings.classList.remove('hidden');
});

$('btn-settings-close').addEventListener('click', () => elModalSettings.classList.add('hidden'));

$('btn-settings-apply').addEventListener('click', () => {
  const gameName = $('setting-game-name').value.trim() || 'Spite and Malice';
  const numPlayers = parseInt($('setting-players').value, 10);
  const aiDelay = parseInt($('setting-ai-speed').value, 10);
  const humanName = $('setting-your-name').value.trim() || 'You';
  const aiNames = [1, 2, 3].map(i => $(`ai-name-${i}`).value.trim() || DEFAULT_AI_NAMES[i - 1]);
  const cardBack = state.settings.cardBack;
  const goalPileSizeRaw = parseInt($('setting-goal-pile-size').value, 10);
  const goalPileSize = Math.min(26, Math.max(12, isNaN(goalPileSizeRaw) ? 20 : goalPileSizeRaw));

  localStorage.setItem('spiteMaliceGameName', JSON.stringify(gameName));
  localStorage.setItem('spiteMaliceHumanName', JSON.stringify(humanName));
  localStorage.setItem('spiteMaliceAiNames', JSON.stringify(aiNames));
  localStorage.setItem('spiteMaliceGoalPileSize', JSON.stringify(goalPileSize));

  elModalSettings.classList.add('hidden');
  bootGame({ gameName, numPlayers, aiDelay, humanName, aiNames, cardBack, goalPileSize });
});

function syncCardBackPicker() {
  const val = state.settings.cardBack || 'blue';
  document.querySelectorAll('#cb-picker-settings .cb-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.value === val);
  });
}

document.querySelectorAll('#cb-picker-settings .cb-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    state.settings.cardBack = swatch.dataset.value;
    localStorage.setItem('spiteMaliceCardBack', JSON.stringify(swatch.dataset.value));
    syncCardBackPicker();
    render();
  });
});

$('btn-gameover-newgame').addEventListener('click', () => bootGame(state.settings));

// ── Pile viewer (full contents of a side stack) ──────────────────────────────

function openPileView(stack, { title, interactiveTop = false, onTopClick = null } = {}) {
  $('pile-view-title').textContent = title;
  $('pile-view-hint').textContent = interactiveTop
    ? 'Only the top card (highlighted) can be played or discarded to.'
    : 'Only the top card (highlighted) is in play.';

  const container = $('pile-view-cards');
  container.innerHTML = '';
  // Top card first (leftmost), then down to the bottom of the pile.
  [...stack].reverse().forEach((card, i) => {
    const isTop = i === 0;
    const el = buildCardEl(card, isTop && interactiveTop);
    if (isTop) {
      el.classList.add('pile-view-top');
      if (interactiveTop && onTopClick) {
        el.addEventListener('click', () => { onTopClick(); closePileView(); });
      } else {
        el.classList.add('not-selectable');
      }
    } else {
      el.classList.add('not-selectable');
    }
    container.appendChild(el);
  });

  elModalPileView.classList.remove('hidden');
}

function closePileView() {
  elModalPileView.classList.add('hidden');
}

$('btn-pile-view-close').addEventListener('click', closePileView);

// ── Selection helpers ─────────────────────────────────────────────────────────

function isHumanTurn() {
  return state.phase === 'playing' && !!currentPlayer()?.isHuman;
}

function sameSource(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'side') return a.idx === b.idx;
  if (a.type === 'hand') return a.cardId === b.cardId;
  return true; // 'goal'
}

function selectSource(src) {
  if (!isHumanTurn()) return;
  selected = sameSource(selected, src) ? null : src;
  render();
}

function onCenterSlotClick(stackIdx) {
  if (!selected || !isHumanTurn()) return;
  const playerIdx = state.currentTurn;
  const card = getSourceCard(playerIdx, selected);
  if (!card || !legalCenterTargets(card).includes(stackIdx)) return;

  playToCenter(playerIdx, selected, stackIdx);
  selected = null;
  render();
  if (state.phase === 'gameEnd') showGameOver();
}

function onOwnSideSlotClick(sideIdx) {
  if (!selected || selected.type !== 'hand' || !isHumanTurn()) return;
  const playerIdx = state.currentTurn;

  discardToSideStack(playerIdx, selected.cardId, sideIdx);
  selected = null;
  render();
  endTurn();
  render();
  scheduleAiIfNeeded();
}

// ── AI scheduling ─────────────────────────────────────────────────────────────

function scheduleAiIfNeeded() {
  if (state.phase !== 'playing') return;
  const cur = currentPlayer();
  if (!cur || cur.isHuman) return;
  setTimeout(() => runAiStep(state.currentTurn), state.settings.aiDelay);
}

function runAiStep(playerIdx) {
  if (state.phase !== 'playing' || state.currentTurn !== playerIdx) return;

  const action = computeAiPlay(playerIdx);
  if (action) {
    playToCenter(playerIdx, action.source, action.stackIdx);
    render();
    if (state.phase === 'gameEnd') { showGameOver(); return; }
    setTimeout(() => runAiStep(playerIdx), state.settings.aiDelay);
    return;
  }

  const discard = computeAiDiscard(playerIdx);
  if (discard) discardToSideStack(playerIdx, discard.cardId, discard.sideIdx);
  render();
  endTurn();
  render();
  scheduleAiIfNeeded();
}

// ── Game over ─────────────────────────────────────────────────────────────────

function showGameOver() {
  const winner = state.players[state.winner];
  $('gameover-title').textContent = winner.isHuman ? 'You win!' : `${winner.name} wins!`;
  elModalGameOver.classList.remove('hidden');
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  $('game-title').textContent = state.settings.gameName;
  document.title = state.settings.gameName;
  renderOpponents();
  renderCenter();
  renderPlayerZone();
}

function renderOpponents() {
  elOpponentsRow.innerHTML = '';
  state.players.forEach((p, idx) => {
    if (p.isHuman) return;

    const seat = document.createElement('div');
    seat.className = 'opponent-seat' + (state.currentTurn === idx && state.phase === 'playing' ? ' active' : '');

    const nameEl = document.createElement('div');
    nameEl.className = 'opponent-name';
    nameEl.textContent = p.finished ? `${p.name} — WINNER` : p.name;
    seat.appendChild(nameEl);

    const pilesRow = document.createElement('div');
    pilesRow.className = 'opponent-row-piles';

    const goalWrap = document.createElement('div');
    goalWrap.className = 'opponent-goal';
    const goalLabel = document.createElement('div');
    goalLabel.className = 'opponent-goal-label';
    goalLabel.textContent = `Goal (${p.goalPile.length})`;
    if (p.goalPile.length > 0) {
      const top = buildCardEl(topOf(p.goalPile), false);
      top.classList.add('mini-card');
      goalWrap.appendChild(top);
    } else {
      const empty = document.createElement('div');
      empty.className = `card-back card-back--${state.settings.cardBack || 'blue'} mini-card`;
      empty.style.opacity = '0.2';
      goalWrap.appendChild(empty);
    }
    goalWrap.appendChild(goalLabel);
    pilesRow.appendChild(goalWrap);

    const sideWrap = document.createElement('div');
    sideWrap.className = 'opponent-side-stacks';
    p.sideStacks.forEach((stack, sIdx) => {
      const wrap = buildStackPreviewEl(stack, { mini: true });
      if (stack.length > STACK_PREVIEW_COUNT) {
        wrap.addEventListener('click', () => {
          openPileView(stack, { title: `${p.name} — Side Stack ${sIdx + 1}` });
        });
      }
      sideWrap.appendChild(wrap);
    });
    pilesRow.appendChild(sideWrap);

    seat.appendChild(pilesRow);
    elOpponentsRow.appendChild(seat);
  });
}

function renderCenter() {
  elStockPile.innerHTML = '';
  if (state.stock.length > 0) {
    const back = document.createElement('div');
    back.className = `card-back card-back--${state.settings.cardBack || 'blue'} count-badge`;
    back.dataset.count = state.stock.length;
    elStockPile.appendChild(back);
  } else {
    const empty = document.createElement('div');
    empty.className = 'center-stack-slot stack-slot-empty';
    empty.innerHTML = '<span class="stack-slot-ghost">Empty</span>';
    elStockPile.appendChild(empty);
  }

  const selectedCard = (selected && isHumanTurn()) ? getSourceCard(state.currentTurn, selected) : null;
  const centerTargets = selectedCard ? legalCenterTargets(selectedCard) : [];

  elCenterStacks.innerHTML = '';
  state.centerStacks.forEach((stack, idx) => {
    let el;
    if (stack.length === 0) {
      el = document.createElement('div');
      el.className = 'center-stack-slot stack-slot-empty';
      el.innerHTML = '<span class="stack-slot-ghost">A</span>';
    } else {
      const topCard = topOf(stack);
      el = buildCardEl(topCard, false);
      el.classList.add('center-stack-slot');
      const badge = document.createElement('span');
      badge.className = 'stack-slot-count';
      badge.textContent = stack.length;
      el.appendChild(badge);

      if (isWild(topCard)) {
        const wildLabel = document.createElement('span');
        wildLabel.className = 'wild-represents';
        wildLabel.textContent = RANK_SEQ[stack.length - 1];
        wildLabel.title = `This King is standing in for a ${RANK_SEQ[stack.length - 1]}`;
        el.appendChild(wildLabel);
      }
    }
    if (centerTargets.includes(idx)) el.classList.add('valid-target');
    el.addEventListener('click', () => onCenterSlotClick(idx));
    elCenterStacks.appendChild(el);
  });
}

function renderPlayerZone() {
  const human = state.players.find(p => p.isHuman);
  if (!human) return;
  const myTurn = isHumanTurn();
  const humanIdx = state.players.indexOf(human);

  elPlayerName.textContent = human.finished ? `${human.name} — WINNER` : human.name;
  elTurnIndicator.classList.toggle('hidden', !myTurn);

  // Goal pile
  elPlayerGoalPile.innerHTML = '';
  if (human.goalPile.length > 0) {
    const top = buildCardEl(topOf(human.goalPile), myTurn);
    if (sameSource(selected, { type: 'goal' })) top.classList.add('selected');
    if (!myTurn) top.classList.add('not-selectable');
    top.addEventListener('click', () => selectSource({ type: 'goal' }));
    const badge = document.createElement('span');
    badge.className = 'stack-slot-count';
    badge.textContent = human.goalPile.length;
    top.appendChild(badge);
    elPlayerGoalPile.appendChild(top);
  } else {
    const empty = document.createElement('div');
    empty.className = 'center-stack-slot stack-slot-empty';
    empty.innerHTML = '<span class="stack-slot-ghost">Empty</span>';
    elPlayerGoalPile.appendChild(empty);
  }

  // Side stacks
  const selectedCard = (selected && myTurn) ? getSourceCard(humanIdx, selected) : null;
  const handSelected = selected && selected.type === 'hand';

  elPlayerSideStacks.innerHTML = '';
  human.sideStacks.forEach((stack, idx) => {
    const topSelected = sameSource(selected, { type: 'side', idx });
    const wrap = buildStackPreviewEl(stack, { topInteractive: myTurn, topSelected });

    const doAction = () => {
      if (handSelected) onOwnSideSlotClick(idx);
      else if (myTurn && stack.length > 0) selectSource({ type: 'side', idx });
    };

    if (handSelected) wrap.classList.add('valid-target');
    wrap.addEventListener('click', () => {
      if (!handSelected && stack.length > STACK_PREVIEW_COUNT) {
        openPileView(stack, { title: `Side Stack ${idx + 1}`, interactiveTop: myTurn, onTopClick: doAction });
      } else {
        doAction();
      }
    });

    elPlayerSideStacks.appendChild(wrap);
  });

  // Hand
  elHand.innerHTML = '';
  human.hand.forEach(card => {
    const el = buildCardEl(card, myTurn);
    if (sameSource(selected, { type: 'hand', cardId: card.id })) el.classList.add('selected');
    if (!myTurn) el.classList.add('not-selectable');
    el.addEventListener('click', () => selectSource({ type: 'hand', cardId: card.id }));
    elHand.appendChild(el);
  });

  // Status message
  elStatusMsg.textContent = statusMessage(myTurn, selectedCard, selected);
}

function statusMessage(myTurn, selectedCard, sel) {
  if (state.phase === 'gameEnd') return '';
  if (!myTurn) return `${currentPlayer().name}'s turn…`;
  if (!sel) return 'Your turn — select a card to play, or select a hand card to discard.';
  if (!selectedCard) return 'Your turn — select a card to play, or select a hand card to discard.';
  const canCenter = legalCenterTargets(selectedCard).length > 0;
  if (sel.type === 'hand') {
    return canCenter
      ? 'Play it on a highlighted center stack, or discard it to one of your side stacks.'
      : 'No center play available — discard it to one of your side stacks.';
  }
  return canCenter ? 'Play it on the highlighted center stack.' : 'No legal play for that card right now.';
}

// Builds a side-stack slot previewing only its top STACK_PREVIEW_COUNT cards,
// fanned in place. Anything buried deeper is only reachable via the full
// pile viewer modal (see openPileView) so the slot never grows unbounded.
function buildStackPreviewEl(stack, { mini = false, topInteractive = false, topSelected = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'side-stack-slot' + (mini ? ' mini-slot' : '');

  if (stack.length === 0) {
    wrap.classList.add('stack-slot-empty');
    return wrap;
  }

  if (stack.length > STACK_PREVIEW_COUNT) wrap.classList.add('has-more');

  const preview = stack.slice(-STACK_PREVIEW_COUNT);
  wrap.classList.add('side-stack-fan');
  const offset = 22;
  const cardH = mini ? 58 : 100;
  wrap.style.height = `${offset * (preview.length - 1) + cardH}px`;

  preview.forEach((card, i) => {
    const isTop = i === preview.length - 1;
    const el = buildCardEl(card, topInteractive && isTop);
    if (mini) el.classList.add('mini-card');
    el.style.top = `${i * offset}px`;
    el.style.zIndex = String(i);
    if (!isTop) el.classList.add('buried-card');
    if (isTop && topSelected) el.classList.add('selected');
    if (!isTop || !topInteractive) el.classList.add('not-selectable');
    wrap.appendChild(el);
  });

  const badge = document.createElement('span');
  badge.className = 'stack-slot-count';
  badge.textContent = stack.length;
  wrap.appendChild(badge);

  return wrap;
}

// ── Card element builder ──────────────────────────────────────────────────────

function buildCardEl(card, interactive) {
  const el = document.createElement('div');
  el.className = `card ${cardColor(card)}${isWild(card) ? ' wild' : ''}`;
  if (!interactive) el.style.cursor = 'default';

  const top = document.createElement('div');
  top.className = 'card-value';
  top.textContent = card.value;

  const suit = document.createElement('div');
  suit.className = 'card-suit';
  suit.textContent = card.suit;

  const bot = document.createElement('div');
  bot.className = 'card-value-bottom';
  bot.textContent = card.value;

  el.appendChild(top);
  el.appendChild(suit);
  el.appendChild(bot);
  return el;
}
