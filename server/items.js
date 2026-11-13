// Card table as the server needs it: which ids exist and what each is worth.
// A card keeps its id for good; only its rarity is listed here. src/js/01_data.js has the names and the same
// rarities (tests/items.test.js keeps the two in step).
const RARITIES = {
  legendary: { tier: 4, sell: 10000 },
  epic: { tier: 3, sell: 1500 },
  rare: { tier: 2, sell: 100 },
  uncommon: { tier: 1, sell: 25 },
  common: { tier: 0, sell: 10 },
};
// card numbers per rarity: "i0" .. "i25"
const BY_RARITY = {
  legendary: [0, 1, 2],
  epic: [3, 4, 5, 6, 25],
  rare: [7, 8, 9, 10, 11, 12, 13, 21],
  uncommon: [14, 15, 16],
  common: [17, 18, 19, 20, 22, 23, 24],
};
const rarityOf = {};
for (const rarity of Object.keys(BY_RARITY)) for (const n of BY_RARITY[rarity]) rarityOf['i' + n] = rarity;
const ITEMS = {};
const n = Object.keys(rarityOf).length;
// in number order, so saved games always list their cards the same way
for (let i = 0; i < n; i++) {
  const id = 'i' + i, rarity = rarityOf[id];
  if (!rarity) throw new Error('card ' + id + ' has no rarity');
  ITEMS[id] = { id, rarity, sell: RARITIES[rarity].sell };
}
// Mutations: special versions of a card, worth a multiple of it. "i17_gold" is the gold version of i17.
// src/js/01_data.js has the same list with the chances and the looks.
const MUTATIONS = { gold: 2, frozen: 3, lava: 3, toxic: 4, candy: 4, halloween: 5, neon: 6, diamond: 8, galaxy: 12, void: 18, rainbow: 30 };
for (let i = 0; i < n; i++) {
  const base = ITEMS['i' + i];
  for (const mut of Object.keys(MUTATIONS)) ITEMS[base.id + '_' + mut] = { id: base.id + '_' + mut, base: base.id, mut, rarity: base.rarity, sell: base.sell * MUTATIONS[mut] };
}
const isItem = (id) => Object.prototype.hasOwnProperty.call(ITEMS, id);
// Worth of one side of a trade in coins.
function offerValue(offer) {
  let v = Math.max(0, Math.floor(Number(offer && offer.coins) || 0));
  const items = (offer && offer.items) || {};
  for (const id of Object.keys(items)) if (isItem(id)) v += ITEMS[id].sell * Math.max(0, Math.floor(Number(items[id]) || 0));
  return v;
}
module.exports = { ITEMS, RARITIES, MUTATIONS, isItem, offerValue, ITEM_COUNT: n };
