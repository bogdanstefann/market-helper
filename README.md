# WarEra Market Helper

Tracks item-market sales of WarEra weapons and equipment (all six slots, all
six rarities from common to mythic) and tells you the best price paid for an
item with the stats you want.

It is a static page: the browser calls the WarEra API directly with your own
API key and caches the answers in IndexedDB. There is no backend, so it can be
hosted anywhere (Netlify, GitHub Pages, a folder).

## Run locally

```bash
npm start          # tiny static server on http://localhost:3777
```

Any static server works (`npx serve public`, `python3 -m http.server -d public`).
Deploying to Netlify needs no build: `netlify.toml` publishes `public/`.

On first visit the page asks for your WarEra API key (game: Settings → API).
It is saved in the browser's localStorage only.

## Project layout

```
public/
  index.html                 page skeleton (all sections and ids)
  styles/base.css            design tokens, layout, panel/field primitives
  src/
    main.js                  entry: data flow, sync every 60 s, render()
    config/items.js          slots × rarities, item codes, stat ranges
    services/
      api.js                 WarEra tRPC calls, key validation
      cache.js               IndexedDB key/value store
      market.js              item-market sales: sync + cache per item
      battles.js             battles (with per-round damage) and countries
    store/state.js           shared state, persisted settings, item helpers
    lib/
      analysis.js            pure logic: filters, points, aggregation, battles
      format.js              formatting helpers, stat labels
      colors.js              colour ramps
    components/<Name>/       one folder per UI piece: <Name>.js + <Name>.css
      ApiKey, StatusBar, ItemSelector, Filters, SummaryTiles,
      PriceChart, Heatmap, Battles, SalesTable
```

Components export `init(handlers)` (bind DOM events once) and `render(view)`.
They never call each other; they call back into `main.js`, which recomputes
the view (`lib/analysis.js → currentView()`) and re-renders everything.

## Features

- Pick a slot and a rarity, enter the stats you want (minimum, or ±5%),
  choose a period, and see the lowest price, median, last sale, best price per
  point, a price-vs-stat chart (lowest and median price lines over the sales)
  and a sortable table of matching sales.
- "Price / point": for equipment, price divided by the single stat. For
  weapons, a weighted score with a slider (default attack 40% / critical
  chance 60%), each stat normalised to its maximum possible value.
- Quick sales: a sale bought within N seconds of being listed (default 1 min)
  is treated as a pre-arranged deal and excluded by default; ⚡ marks them
  when included.
- "When do sales happen?": weekday × hour heatmap (local time) over all cached
  sales of the item, switchable between sales count and median price relative
  to the overall median, with a P50/P90/P99 colour-scale cap.
- Battle analysis (opt-in, "Load battle data"): each sale is tagged with the
  battles active at that moment; a battle is "big" when its biggest round
  reached the configurable damage threshold (default 20 M). The table gets a
  `!` symbol from grey (calm) to red (busiest), hovering it lists the battles,
  and a section compares calm / normal / busy sales with two hourly timelines.

## Data and limits

- Sales come from `transaction.getPaginatedTransactions` (type `itemMarket`).
  The first load of an item fetches the newest 1000 sales so the page shows up
  fast, then every minute it fetches what is new (no cap, so a closed tab does
  not leave gaps) and 5 more pages of older sales, until the full 14-day
  window is cached (every 3 s while catching up, then once a minute). A single
  status strip above the tiles shows the progress; nothing else moves. Battles come from
  `battle.getBattles`, countries from `country.getAllCountries`.
- Live offers (`itemOffer.getItemOffers`) are not accessible with an API token
  (403), so the app works with completed sales, not current listings.
- WarEra rate limit: 500 requests/minute per key. A first load of an item
  costs up to 10 requests, of battles up to 15.
