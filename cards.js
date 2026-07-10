// ── Card / deck utilities ─────────────────────────────────────────────────────

const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Sequence a center building stack fills, in order. King is wild and matches
// any position — it is intentionally excluded from this array.
const RANK_SEQ = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'];
const STACK_LENGTH = RANK_SEQ.length; // 12 — a complete center stack has 12 cards

let _cardSeq = 0;

function buildDeck(numDecks) {
  const deck = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const value of VALUES) {
        deck.push({ id: _cardSeq++, suit, value });
      }
    }
  }
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardColor(card) {
  return (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
}

function isWild(card) {
  return card.value === 'K';
}

// Does `card` legally extend a center stack that currently holds `stackLen` cards?
function matchesCenterPos(card, stackLen) {
  if (stackLen >= STACK_LENGTH) return false;
  return isWild(card) || card.value === RANK_SEQ[stackLen];
}
