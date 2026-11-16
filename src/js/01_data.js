// Loot table: chance is the share of chests per rarity in percent (the five add up to 100), sell the coin value.
// server/items.js holds the same ids and values for trading; tests/items.test.js keeps the two in step.
var RARITY = {
  common: { key: 'common', name: 'Common', color: '#a3acb8', deep: '#5b6470', chance: 63.77, sell: 10, tier: 0 },
  uncommon: { key: 'uncommon', name: 'Uncommon', color: '#45d86b', deep: '#1f8a3b', chance: 22, sell: 25, tier: 1 },
  rare: { key: 'rare', name: 'Rare', color: '#3d9dff', deep: '#1a57c4', chance: 14, sell: 100, tier: 2 },
  epic: { key: 'epic', name: 'Epic', color: '#b65cff', deep: '#6a1fc0', chance: 0.2, sell: 1500, tier: 3 },
  legendary: { key: 'legendary', name: 'Legendary', color: '#ffc531', deep: '#c47a00', chance: 0.03, sell: 10000, tier: 4 }
};
var RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
// Every card has a fixed id. Saved games and trades refer to cards by it, so an id never moves to another card,
// whatever happens to a name or a rarity (Herr Lang, i21, started out as a common). A new card takes the next
// free number (Frau Hübner is i25). The order here is the order cards are listed in: by rarity.
var ITEMS = [
  ['i0', 'Frau Vogtmann', 'legendary'], ['i1', 'Herr Lein', 'legendary'], ['i2', 'Frau Zapf', 'legendary'],
  ['i3', 'Frau Ullmann', 'epic'], ['i4', 'Herr Schreivogel', 'epic'], ['i5', 'Frau Duppel', 'epic'], ['i6', 'Herr Gallert', 'epic'], ['i25', 'Frau Hübner', 'epic'],
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

// Mutations: a card from a chest can come out as a special version of itself, worth a multiple of it.
// chance is in percent per chest, whatever the card; together one chest in ten. Saved games and trades call the
// gold Frau Kaese "i17_gold". server/items.js has the same keys and multiples (tests/items.test.js checks).
var MUTATIONS = [
  { key: 'gold', name: 'Gold', icon: '✨', chance: 3, mult: 2 },
  { key: 'frozen', name: 'Frozen', icon: '❄️', chance: 1.5, mult: 3 },
  { key: 'lava', name: 'Lava', icon: '🌋', chance: 1.5, mult: 3 },
  { key: 'toxic', name: 'Toxic', icon: '☣️', chance: 1, mult: 4 },
  { key: 'candy', name: 'Candy', icon: '🍬', chance: 1, mult: 4 },
  { key: 'halloween', name: 'Halloween', icon: '🎃', chance: 0.8, mult: 5 },
  { key: 'neon', name: 'Neon', icon: '⚡', chance: 0.5, mult: 6 },
  { key: 'diamond', name: 'Diamond', icon: '💎', chance: 0.35, mult: 8 },
  { key: 'galaxy', name: 'Galaxy', icon: '🌌', chance: 0.2, mult: 12 },
  { key: 'void', name: 'Void', icon: '🕳️', chance: 0.1, mult: 18 },
  { key: 'rainbow', name: 'Rainbow', icon: '🌈', chance: 0.05, mult: 30 }
];
var MUT_BY_KEY = {}, MUT_CHANCE = 0;
MUTATIONS.forEach(function (m) { MUT_BY_KEY[m.key] = m; MUT_CHANCE += m.chance; });
// Every card there is: the 26, each followed by its mutated versions. ITEMS stays the list of the 26.
var ALL_CARDS = [];
ITEMS.forEach(function (it) {
  ALL_CARDS.push(it);
  MUTATIONS.forEach(function (m) {
    var v = { id: it.id + '_' + m.key, base: it.id, name: it.name, rarity: it.rarity, mut: m, sell: it.sell * m.mult, chance: it.chance * m.chance / 100 };
    ITEM_BY_ID[v.id] = v; ALL_CARDS.push(v);
  });
});
// The mutation roll of one chest: null nine times out of ten. A roll near 0 is the rarest one.
function rollMutation() {
  var r = rand() * 100, acc = 0;
  for (var i = MUTATIONS.length - 1; i >= 0; i--) { acc += MUTATIONS[i].chance; if (r < acc) return MUTATIONS[i]; }
  return null;
}
function mutate(item, m) { return m && !item.mut ? ITEM_BY_ID[item.id + '_' + m.key] : item; }
// "Gold F. Kaese" (long: "Gold Frau Kaese")
function cardName(it, long) { return (it.mut ? it.mut.name + ' ' : '') + (long ? it.name : shortName(it.name)); }
function mutTag(it) { return it.mut ? '<span class="mtag m-' + it.mut.key + '">' + it.mut.icon + ' ' + it.mut.name + '</span>' : ''; }
function mutCls(it) { return it.mut ? ' mut m-' + it.mut.key : ''; }
