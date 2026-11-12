// Card table as the server needs it: which ids exist and what each is worth.
// Order and rarities mirror src/js/01_data.js (tests/items.test.js keeps the two in step).
const RARITIES = {
  legendary: { tier: 4, sell: 10000 },
  epic: { tier: 3, sell: 1500 },
  rare: { tier: 2, sell: 100 },
  uncommon: { tier: 1, sell: 25 },
  common: { tier: 0, sell: 10 },
};
const LAYOUT = [['legendary', 3], ['epic', 4], ['rare', 7], ['uncommon', 3], ['common', 8]];
const ITEMS = {};
let n = 0;
for (const [rarity, count] of LAYOUT) {
  for (let i = 0; i < count; i++, n++) ITEMS['i' + n] = { id: 'i' + n, rarity, sell: RARITIES[rarity].sell };
}
const isItem = (id) => Object.prototype.hasOwnProperty.call(ITEMS, id);
// Worth of one side of a trade in coins.
function offerValue(offer) {
  let v = Math.max(0, Math.floor(Number(offer && offer.coins) || 0));
  const items = (offer && offer.items) || {};
  for (const id of Object.keys(items)) if (isItem(id)) v += ITEMS[id].sell * Math.max(0, Math.floor(Number(items[id]) || 0));
  return v;
}
module.exports = { ITEMS, RARITIES, isItem, offerValue, ITEM_COUNT: n };
