// Loot table: chance is the share of chests per rarity in percent (the five add up to 100), sell the coin value.
// server/items.js holds the same ids and values for trading; tests/items.test.js keeps the two in step.
var RARITY = {
  common: { key: 'common', name: 'Common', color: '#a3acb8', deep: '#5b6470', chance: 63.4, sell: 10, tier: 0 },
  uncommon: { key: 'uncommon', name: 'Uncommon', color: '#45d86b', deep: '#1f8a3b', chance: 22, sell: 25, tier: 1 },
  rare: { key: 'rare', name: 'Rare', color: '#3d9dff', deep: '#1a57c4', chance: 14, sell: 100, tier: 2 },
  epic: { key: 'epic', name: 'Epic', color: '#b65cff', deep: '#6a1fc0', chance: 0.5, sell: 1500, tier: 3 },
  legendary: { key: 'legendary', name: 'Legendary', color: '#ffc531', deep: '#c47a00', chance: 0.1, sell: 10000, tier: 4 }
};
var RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
// Every card has a fixed id. Saved games and trades refer to cards by it, so an id never moves to another card,
// whatever happens to a name or a rarity (Herr Lang, i21, started out as a common). The order here is the order
// cards are listed in: by rarity.
var ITEMS = [
  ['i0', 'Frau Vogtmann', 'legendary'], ['i1', 'Herr Lein', 'legendary'], ['i2', 'Frau Zapf', 'legendary'],
  ['i3', 'Frau Ullmann', 'epic'], ['i4', 'Herr Schreivogel', 'epic'], ['i5', 'Frau Duppel', 'epic'], ['i6', 'Herr Gallert', 'epic'],
  ['i7', 'Frau Masi', 'rare'], ['i8', 'Herr Weber-Hänel', 'rare'], ['i9', 'Frau Wunder', 'rare'], ['i10', 'Frau Butterhof', 'rare'], ['i11', 'Herr Gessner', 'rare'], ['i12', 'Herr Kühl', 'rare'], ['i13', 'Herr Sieder', 'rare'], ['i21', 'Herr Lang', 'rare'],
  ['i14', 'Herr Reuther', 'uncommon'], ['i15', 'Frau Köhler', 'uncommon'], ['i16', 'Frau Geuß', 'uncommon'],
  ['i17', 'Frau Kaese', 'common'], ['i18', 'Frau Benker', 'common'], ['i19', 'Frau Peinl', 'common'], ['i20', 'Herr Franke', 'common'], ['i22', 'Frau Ploß', 'common'], ['i23', 'Frau Beier', 'common'], ['i24', 'Herr Bäumler', 'common']
].map(function (d) { return { id: d[0], name: d[1], rarity: d[2] }; });
var ITEM_BY_ID = {};
// "Herr Lein" -> "H. Lein", "Frau Vogtmann" -> "F. Vogtmann": the form shown on the card
function shortName(name) {
  var m = /^(Herr|Frau)\s+(.+)$/.exec(name);
  return m ? m[1].charAt(0) + '. ' + m[2] : name;
}
(function () {
  var counts = {};
  ITEMS.forEach(function (it) { counts[it.rarity] = (counts[it.rarity] || 0) + 1; ITEM_BY_ID[it.id] = it; });
  ITEMS.forEach(function (it) {
    it.chance = RARITY[it.rarity].chance / counts[it.rarity];     // percent per chest
    it.sell = RARITY[it.rarity].sell;
  });
  RARITY_ORDER.forEach(function (k) { RARITY[k].count = counts[k]; });
})();

// One chest roll: pick the tier by its total chance, then one of its items evenly.
function rollItem(forceRarity) {
  var key = forceRarity;
  if (!key) {
    var r = rand() * 100, acc = 0;
    for (var i = 0; i < RARITY_ORDER.length; i++) {
      acc += RARITY[RARITY_ORDER[i]].chance;
      if (r < acc) { key = RARITY_ORDER[i]; break; }
    }
    if (!key) key = 'common';
  }
  var pool = ITEMS.filter(function (it) { return it.rarity === key; });
  return pool[randInt(pool.length)];
}
