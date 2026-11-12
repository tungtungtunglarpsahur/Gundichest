# GundiChest

A 3D chest opening game: open the chest, collect the cards, sell them for play coins, and use the coins in the mini games.

The site runs on Vercel. The page itself is static (`public/`); accounts, saved progress and trading go through one serverless function (`api/rpc.js`) backed by a Postgres database.

- `src/` – game source (HTML, CSS, JavaScript)
- `public/` – the built page and its assets (what Vercel serves)
- `api/`, `server/` – the server side
- `tools/build.mjs` – builds `public/index.html` from `src/`

Coins are play money only. Nothing in this game costs or pays real money.
