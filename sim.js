// Headless rules-engine smoke test (Node, no DOM) — not part of the shipped app.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function loadIntoContext(ctx, file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  vm.runInContext(code, ctx, { filename: file });
}

function runGame(numPlayers, maxTurns) {
  const ctx = vm.createContext({ console, Math });
  loadIntoContext(ctx, 'cards.js');
  loadIntoContext(ctx, 'game.js');

  vm.runInContext(`newGame({ numPlayers: ${numPlayers} });`, ctx);

  let turns = 0;
  while (vm.runInContext('state.phase', ctx) === 'playing' && turns < maxTurns) {
    turns++;
    // Play out the current player's turn: greedy plays until stalled, then discard.
    let guard = 0;
    while (guard++ < 500) {
      const action = vm.runInContext('computeAiPlay(state.currentTurn)', ctx);
      if (!action) break;
      ctx.__action = action;
      vm.runInContext('playToCenter(state.currentTurn, __action.source, __action.stackIdx)', ctx);
      if (vm.runInContext('state.phase', ctx) === 'gameEnd') break;
    }
    if (vm.runInContext('state.phase', ctx) === 'gameEnd') break;

    const discard = vm.runInContext('computeAiDiscard(state.currentTurn)', ctx);
    if (discard) {
      ctx.__discard = discard;
      vm.runInContext('discardToSideStack(state.currentTurn, __discard.cardId, __discard.sideIdx)', ctx);
    }
    vm.runInContext('endTurn()', ctx);
  }

  const phase = vm.runInContext('state.phase', ctx);
  const winner = vm.runInContext('state.winner', ctx);
  const players = vm.runInContext('state.players', ctx);
  const stockLen = vm.runInContext('state.stock.length', ctx);
  const reserveLen = vm.runInContext('state.reserve.length', ctx);

  // Sanity: total card count must stay constant (no cards created/lost).
  const centerStacks = vm.runInContext('state.centerStacks', ctx);
  let total = stockLen + reserveLen;
  players.forEach(p => {
    total += p.goalPile.length + p.hand.length;
    p.sideStacks.forEach(s => total += s.length);
  });
  centerStacks.forEach(s => total += s.length);

  console.log(`players=${numPlayers} turns=${turns} phase=${phase} winner=${phase === 'gameEnd' ? players[winner].name : '-'} totalCards=${total} expected=${52 * numPlayers}`);
  if (total !== 52 * numPlayers) throw new Error('Card count mismatch! Cards were lost or duplicated.');
  if (phase !== 'gameEnd') throw new Error(`Game did not finish within ${maxTurns} turns`);
}

for (const n of [2, 3, 4]) {
  for (let trial = 0; trial < 5; trial++) {
    runGame(n, 4000);
  }
}
console.log('All sim trials passed.');
