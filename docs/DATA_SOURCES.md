# Data sources and rate meaning

Fex uses [Frankfurter v2](https://frankfurter.dev/) for reference exchange rates and currency metadata. Credit: Frankfurter, by Line of Flight, with underlying data from its listed central banks and other official providers. Fex is an independent application. It does not imply endorsement by Frankfurter or a provider.

## Requests and catalog

| Purpose | Endpoint |
| --- | --- |
| Current currency catalog | [Currency metadata](https://api.frankfurter.dev/v2/currencies) |
| Latest USD reference table | [USD rates](https://api.frankfurter.dev/v2/rates?base=USD) |

These are direct browser GET requests. Entered amounts are not request parameters. Typing and changing the source do not request a conversion from the service.

Run `node scripts/smoke-live.mjs` for a read-only live schema and coverage check. It uses the production validators and prints catalog and rate counts, the supported initial list, the rate-date span, and CORS response headers. `FEX_SMOKE_ORIGIN` changes the request's Origin header. This Node check does not establish that a final deployed browser can connect. It remains separate from the deterministic unit, behavior, and performance suites.

The fallback catalog in `src/catalog.js` contains 166 current codes, recorded from the official currency endpoint on 26 September 2026. It contains names and symbols, not exchange rates. The app uses saved or fetched metadata when available and checks for new metadata after 24 hours during normal use. The current provider catalog can grow or change. It includes some metals and other units as well as currencies. Fex groups these as Other units. A catalog entry with no current usable rate remains visible but cannot produce a conversion.

## Calculation and dates

Each stored rate is the amount of a quote currency for one USD. USD has an identity rate of 1. For source currency `S`, target currency `T`, and source amount `A`:

```text
target amount = A × USD-to-T rate ÷ USD-to-S rate
```

Fex uses decimal arithmetic and keeps the internal source value separate from the rounded display. Selecting a result as the new source preserves its unrounded value. A real edit makes the entered value authoritative. A rate refresh holds the source amount fixed.

Each currency rate retains its own provider date. Cross rates can therefore use two different dates. The rate details show the relevant dates; for a USD conversion, the other currency's date is the meaningful date. The synthetic USD identity date is not evidence of a separate market update. A displayed date range is not a claim that every currency has a quote from the same instant.

The last check time records when Fex obtained a valid snapshot. It is separate from the rate dates. An unchanged response can advance the check time without changing the rate dates. Weekends, holidays, source schedules, and delayed publications can leave dates unchanged. Missing values are unavailable, not zero. Old rates retain their dates and can trigger a notice; fetching them again does not make them new.

## Refresh and offline behavior

The app checks rates when they are at least one hour old and the page is online and visible. Lifecycle events and a 30-second heartbeat can ask for a check; the controller prevents duplicate requests and enforces the one-hour interval. A manual retry can bypass the normal interval and ordinary retry delay, but cannot bypass an HTTP 429 cooldown.

Requests time out after 10 seconds. Ordinary failures use delays of 1, 5, 15, and then 60 minutes. A 429 response uses its valid `Retry-After` value or a 15-minute fallback. Malformed responses and older rate dates cannot replace good data. If a response loses the active source rate, the app retains a prior usable table. On a cold start, a partial table can still make its available currencies usable.

New valid rates are saved while an amount is being edited, but the displayed snapshot waits until editing ends. The displayed check time stays with the displayed snapshot. Saved rates support offline conversion; a first offline visit without saved rates does not. The static service worker does not cache API responses as app assets.

## Terms and release review

Read [Frankfurter's license and provider terms](https://frankfurter.dev/license/). Frankfurter's software license does not grant rights to every underlying data set. The providers' applicable terms remain relevant. Reference rates can be late, missing, revised, or blended; a blended value is not necessarily an official rate published by one institution.

The app's About rates view links to Frankfurter and its terms. Before public release, review the provider terms that apply to the data used, record any required credits, and add them where required. That review is pending; this repository does not claim that all third-party data terms are cleared.

Results are reference estimates. Bank, card, transfer, and cash-exchange prices can differ because of timing, spread, and fees. The app does not provide a transaction quote or guarantee an executable exchange price.
