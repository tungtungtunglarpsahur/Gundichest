// The server keeps its own small copy of the card table. It has to match the game's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const server = require('../server/items');

function clientData() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', '01_data.js'), 'utf8');
  const box = { rand: Math.random, randInt: (n) => Math.floor(Math.random() * n) };
  vm.runInNewContext(src + '\n;this.out = { RARITY: RARITY, ITEMS: ITEMS, RARITY_ORDER: RARITY_ORDER, rollItem: rollItem, shortName: shortName, MUTATIONS: MUTATIONS, ALL_CARDS: ALL_CARDS, ITEM_BY_ID: ITEM_BY_ID, rollMutation: rollMutation, mutate: mutate, cardName: cardName };', box);
  return box.out;
}

test('server and game agree on every card and its value', () => {
  const { ITEMS } = clientData();
  assert.equal(ITEMS.length, server.ITEM_COUNT);
  for (const it of ITEMS) {
    assert.ok(server.isItem(it.id), it.id);
    assert.equal(server.ITEMS[it.id].rarity, it.rarity, it.id);
    assert.equal(server.ITEMS[it.id].sell, it.sell, it.id);
  }
  assert.equal(server.isItem('toString'), false);
  assert.equal(server.isItem('i26'), false);
});

test('cards keep their ids', () => {
  const { ITEMS } = clientData();
  const byId = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
  assert.equal(Object.keys(byId).length, 26);                         // no id used twice
  for (let i = 0; i < 26; i++) assert.ok(byId['i' + i], 'i' + i);
  // saved games and trades hold these ids: the card behind an id must never become another card
  const fixed = { i0: 'Frau Vogtmann', i1: 'Herr Lein', i2: 'Frau Zapf', i3: 'Frau Ullmann', i4: 'Herr Schreivogel', i7: 'Frau Masi', i13: 'Herr Sieder',
    i14: 'Herr Reuther', i16: 'Frau Geuß', i17: 'Frau Kaese', i20: 'Herr Franke', i21: 'Herr Lang', i22: 'Frau Ploß', i24: 'Herr Bäumler', i25: 'Frau Hübner' };
  for (const id of Object.keys(fixed)) assert.equal(byId[id].name, fixed[id], id);
  assert.equal(byId.i21.rarity, 'rare');
  assert.equal(server.ITEMS.i21.sell, 100);
  assert.equal(byId.i25.rarity, 'epic');
  assert.deepEqual(Object.keys(server.ITEMS).slice(0, 26), Array.from({ length: 26 }, (_, i) => 'i' + i));
});

test('cards are listed by rarity', () => {
  const { ITEMS, RARITY, RARITY_ORDER } = clientData();
  const tiers = ITEMS.map((it) => RARITY[it.rarity].tier);
  assert.deepEqual(tiers.slice().sort((a, b) => b - a), tiers);
  assert.deepEqual(Array.from(RARITY_ORDER, (k) => ITEMS.filter((it) => it.rarity === k).length), [3, 5, 8, 3, 7]);
});

test('drop chances add up to 100% and follow the rarity order', () => {
  const { RARITY, RARITY_ORDER, ITEMS } = clientData();
  const total = RARITY_ORDER.reduce((s, k) => s + RARITY[k].chance, 0);
  assert.ok(Math.abs(total - 100) < 1e-9, 'total ' + total);
  assert.ok(Math.abs(ITEMS.reduce((s, it) => s + it.chance, 0) - 100) < 1e-9);
  assert.equal(RARITY.epic.chance, 0.5);
  assert.equal(RARITY.legendary.chance, 0.1);
  const c = RARITY_ORDER.map((k) => RARITY[k].chance);
  assert.deepEqual(c.slice().sort((a, b) => a - b), c);      // legendary is the rarest, common the most likely
});

test('a chest gives each rarity about as often as the table says', () => {
  const { RARITY, rollItem } = clientData();
  const n = 400000, seen = {};
  for (let i = 0; i < n; i++) { const r = rollItem().rarity; seen[r] = (seen[r] || 0) + 1; }
  for (const k of Object.keys(RARITY)) {
    const p = RARITY[k].chance / 100, sd = Math.sqrt(p * (1 - p) / n);
    assert.ok(Math.abs(seen[k] / n - p) < 5 * sd, k + ': ' + (seen[k] / n * 100).toFixed(3) + '% vs ' + RARITY[k].chance + '%');
  }
});

test('server and game agree on every mutation, and a mutated card is worth its multiple', () => {
  const { MUTATIONS, ALL_CARDS, ITEMS, ITEM_BY_ID, cardName } = clientData();
  assert.deepEqual(Object.fromEntries(MUTATIONS.map((m) => [m.key, m.mult])), Object.assign({}, server.MUTATIONS));
  assert.equal(ALL_CARDS.length, ITEMS.length * (1 + MUTATIONS.length));
  assert.equal(ALL_CARDS.length, Object.keys(server.ITEMS).length);
  for (const c of ALL_CARDS) {
    assert.ok(server.isItem(c.id), c.id);
    assert.equal(server.ITEMS[c.id].sell, c.sell, c.id);
    assert.equal(server.ITEMS[c.id].rarity, c.rarity, c.id);
  }
  assert.equal(ITEM_BY_ID.i17_gold.sell, 20);
  assert.equal(ITEM_BY_ID.i0_rainbow.sell, 300000);
  assert.equal(cardName(ITEM_BY_ID.i17_gold), 'Gold F. Kaese');
  assert.equal(cardName(ITEM_BY_ID.i17_gold, true), 'Gold Frau Kaese');
  assert.equal(server.isItem('i17_gold_gold'), false);
});

test('one chest in ten is mutated, each mutation about as often as its chance says', () => {
  const { MUTATIONS, rollMutation, mutate, ITEMS } = clientData();
  const total = MUTATIONS.reduce((s, m) => s + m.chance, 0);
  assert.ok(Math.abs(total - 10) < 1e-9, 'total ' + total);
  const n = 600000, seen = {};
  let none = 0;
  for (let i = 0; i < n; i++) { const m = rollMutation(); if (m) seen[m.key] = (seen[m.key] || 0) + 1; else none++; }
  assert.ok(Math.abs(none / n - 0.9) < 0.003, 'plain: ' + none / n);
  for (const m of MUTATIONS) {
    const p = m.chance / 100, sd = Math.sqrt(p * (1 - p) / n);
    assert.ok(Math.abs((seen[m.key] || 0) / n - p) < 5 * sd, m.key + ': ' + ((seen[m.key] || 0) / n * 100).toFixed(3) + '% vs ' + m.chance + '%');
  }
  // rarer means worth more
  const byChance = MUTATIONS.slice().sort((a, b) => b.chance - a.chance);
  assert.deepEqual(byChance.map((m) => m.mult), byChance.map((m) => m.mult).slice().sort((a, b) => a - b));
  assert.equal(mutate(ITEMS[0], null), ITEMS[0]);
  assert.equal(mutate(ITEMS[0], MUTATIONS[0]).id, ITEMS[0].id + '_' + MUTATIONS[0].key);
});

test('card names are shortened to "H. Name" and "F. Name"', () => {
  const { shortName } = clientData();
  assert.equal(shortName('Herr Lein'), 'H. Lein');
  assert.equal(shortName('Frau Vogtmann'), 'F. Vogtmann');
  assert.equal(shortName('Herr Weber-Hänel'), 'H. Weber-Hänel');
});

test('offer values use the sell prices', () => {
  assert.equal(server.offerValue({ items: { i0: 1, i17: 3, nope: 4 }, coins: 5 }), 10000 + 30 + 5);
  assert.equal(server.offerValue(null), 0);
});
