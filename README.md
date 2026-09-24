# WarEra Mythic Market Helper

Tracks item-market sales of WarEra weapons and equipment (all six slots, all
six rarities from common to mythic) and tells you the best price paid for an
item with the stats you want.

## Run

```bash
cp .env.example .env   # put your key in WARERA_API_KEY
npm start
# http://localhost:3777
```

Requires Node 20+. No npm dependencies.

## How it works

- The server reads `transaction.getPaginatedTransactions` (type `itemMarket`)
  with the `x-api-key` header for each of the 36 item codes, every 60 s. The first
  start backfills up to 14 days or 1000 sales per item; the cache lives in
  `data/transactions.json`.
- The UI: pick a slot and a rarity, enter the stats you want (minimum, or ±5%),
  choose a period, and see the lowest price, median, last sale, best price per
  stat point, a price-vs-stat chart (lowest and median price lines over the
  sales) and a table of matching sales.
- "When do sales happen?" is a weekday × hour heatmap (local time) over all
  cached sales of the selected item, switchable between sales count and median
  price relative to the overall median, with a summary of the busiest and
  cheapest slots.
- "Price / point" divides the sale price by the primary stat only: attack for
  weapons (critical chance is used as a filter, not in the ratio), and the
  single stat for equipment.

## Limitations

- **Live offers** (`itemOffer.getItemOffers`) are not accessible with an API
  token (the API answers 403 "API tokens cannot access this endpoint"). The app
  works with completed sales, not with the offers currently listed.
- API rate limit: 500 requests/minute; the app uses about 36/minute.
