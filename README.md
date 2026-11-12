# GundiChest

A chest opening game for the browser: a 3D treasure chest, 25 cards in five rarities, an inventory, six
play-coin games, and trading between players. Built for phones first.

Play coins only. Nothing in the game costs or pays real money.

- **Chest**: open by hand, or let auto opening run with rules for what to keep and what to sell.
- **Index**: every card with its drop chance.
- **Games**: Rugpull, Chicken Road, Mines, Blackjack, Coinflip and the Upgrader (trade cards up for a
  card worth more, at a chance you can see before you spin).
- **Trade**: find a player, send a request, put cards and coins on the table. Both accept, then both
  confirm; only then everything changes hands at once. Each side sees how fair the trade is for them.
- **Accounts**: username and password. Progress is saved to the account and follows it to other devices.

## Drop chances

| Rarity    | Per chest | Cards | Sells for |
|-----------|-----------|-------|-----------|
| Common    | 63.2%     | 8     | 10        |
| Uncommon  | 22%       | 3     | 25        |
| Rare      | 14%       | 7     | 100       |
| Epic      | 0.5%      | 4     | 1,500     |
| Legendary | 0.3%      | 3     | 10,000    |

A chest rolls the rarity first, then one card of that rarity. The table lives in `src/js/01_data.js`.

Upgrader: chance = 95% × (value you put in ÷ value of the target), never more than 90%.

Trade fairness: for each side, (value received − value given) ÷ value given, using the sell values above.
Giving 100 and getting 150 is +50% for you and −33% for the other player.

## Running it on Vercel

The repository is set up for Vercel as it is: `vercel.json` builds the page into `public/` and `api/rpc.js`
is the only serverless function.

1. Import the repository as a Vercel project (framework preset: Other).
2. In the project, open **Storage → Create Database → Neon (Postgres)** and connect it to the project.
   The free plan is enough. This sets `DATABASE_URL`, which is all the server needs.
3. Deploy. The tables are created on the first request (and already during the build).

Every build runs `tools/dbcheck.mjs`: it creates the tables if needed and plays one full trade between two
throwaway players against the real database, then removes them. A build without a working database fails
with a message that says what is missing, instead of going live with a login that cannot work.

If visitors see a Vercel login instead of the game, switch off **Settings → Deployment Protection →
Vercel Authentication** for the project.

No Redis, no other services. Costs stay inside the free plans for a game of this size: the page polls only
while it is open and in use, and stops when nobody touches it for a few minutes, so the database can sleep.

## Running it locally

Needs Node 20 or newer and a Postgres database.

```bash
npm install
npm run build                                   # src/ -> public/index.html
DATABASE_URL=postgres://postgres@127.0.0.1:5432/gundichest npm run dev
# http://127.0.0.1:3000/
```

`npm run build:single` writes `dist/gundichest.html`: the whole game in one file that runs from disk
without a server. That version has no accounts and no trading; progress stays in the browser.

## Tests

```bash
GC_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/gc_test npm test
```

The API tests run against a real Postgres. They wipe the database they are given, so it has to be local
and its name has to end in `_test`. Without the variable they are skipped; the card table tests still run.

`tests/e2e/` holds browser tests (Python, Playwright, Chrome) that drive the real page with two players:
registering, logging in on a second device, playing offline, a complete trade, the Upgrader. Start the dev
server, then run for example `GC_URL=http://127.0.0.1:3000/ python3 tests/e2e/t_trade.py`.

On GitHub, `.github/workflows/check.yml` runs the API tests on every push and then checks the deployed
site from the outside (`tools/livecheck.mjs`): page, files, database, and one trade between two throwaway
players, which are deleted again afterwards.

## How it is put together

```
src/index.html, src/style.css     page shell and styles
src/js/*.js                       the game, plain JavaScript, joined in file name order by the build
src/logo.svg                      the logo; favicon and the mark inside the page come from this file
public/assets/                    chest model, textures, three.js (served as files, cached for a year)
public/*.png, favicon.ico         app icons, made from the logo by tools/make-icons.py
api/rpc.js                        the serverless function; hands every request to server/handler.js
server/                           accounts, saved games, trading (Node, pg)
tools/build.mjs                   builds public/index.html or the single-file version
tools/dev-server.mjs              local stand-in for Vercel
tools/dbcheck.mjs, smoke.mjs      the build-time database check
tools/livecheck.mjs               the check of the deployed site
```

### Saving

The game always writes to the browser first, so it keeps working without a connection. With an account,
the progress (coins, cards, index, stats) is sent to the server a few seconds after it changes. The server
counts a revision per player. If the server's copy moved on because of a finished trade, the next save is
accepted and the trade is booked on top of it. If it moved on because another device saved, the page takes
the server's copy and says so. Settings such as effects quality and sound stay on the device.

### Trading

A trade row holds both offers and a step per player: 0 open, 1 accepted, 2 confirmed. Changing an offer
resets both steps, and an accept only counts for the version of the offer the player has seen. The second
confirm runs one database transaction that locks both players, checks that each still owns what they
offered, moves everything and marks the trade done. Cards and coins in an open offer are held back in the
rest of the game: they cannot be sold, bet or upgraded until the trade ends.

### What the server does not do

The chest, the games and the Upgrader run in the browser, and the server stores what the browser reports.
Someone who knows their way around browser tools can give themselves coins or cards. Passwords are stored
as salted scrypt hashes, sessions as hashes of random tokens; there is no email and no password reset.

## Credits

- Chest model, name and card list by the owner of this repository.
- [three.js](https://threejs.org) r160, MIT license.
- Fonts: [Luckiest Guy](https://fonts.google.com/specimen/Luckiest+Guy) (Apache 2.0) and
  [Outfit](https://fonts.google.com/specimen/Outfit) (SIL Open Font License), both built into the page.
