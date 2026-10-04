# Data sources and rate meaning

Fex gets reference exchange rates and currency names from [Frankfurter v2](https://frankfurter.dev/). Frankfurter is by Line of Flight and uses data from the central banks and other official providers that it lists. Fex is independent of Frankfurter and of those providers.

## Requests

| Purpose | Request |
| --- | --- |
| Currency catalog | `GET https://api.frankfurter.dev/v2/currencies` |
| Latest table, USD base | `GET https://api.frankfurter.dev/v2/rates?base=USD` |
| History of one pair | `GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=VND&from=YYYY-MM-DD&to=YYYY-MM-DD` |

The browser sends these requests itself, with no proxy. They contain no amount and no part of the user's list. The history request has the chart's pair and inclusive UTC dates. Its response holds the daily observations the provider has. It has no values for missing days and no prices within a day. The app requests history only for the chart, never at startup or during an edit.

`src/catalog.js` holds the catalog as it was on 26 September 2026. It has 166 codes with names and symbols, and no rates. The app prefers a saved or fetched catalog and requests a new one after 24 hours. The provider's catalog can change. It includes some metals and other units, which Fex lists as Other supported units. A code with no usable rate stays visible but gives no conversion.

`pnpm run test:live` checks the live API with the app's validators. It prints the catalog and rate counts, the rate dates, one week of USD/VND history, and the CORS headers. `FEX_SMOKE_ORIGIN` sets the `Origin` header. The check runs in Node, so it does not prove that a deployed browser can connect.

## Calculation

Each rate is the amount of a currency for one USD, and USD has the rate 1. For a source currency S, a target currency T, and a source amount A:

```text
target amount = A × USD-to-T rate ÷ USD-to-S rate
```

Fex uses decimal arithmetic and keeps the source value apart from the rounded text on the screen. When a result becomes the source, its unrounded value is the new amount. An edit makes the typed value the amount. A rate check does not change the source amount.

## Dates

Each rate carries the provider's date. A conversion between two currencies other than USD uses two rates, so it can use two dates. About the rates shows both. For a conversion with USD, the other currency's date applies, because the USD rate of 1 has no publication date. A date range on the screen does not mean every currency has a quote from the same moment.

The time of the last check is when Fex last got a valid table. It does not depend on the rate dates. A response with unchanged dates still counts as a successful check. Weekends, holidays, and late publication can leave a date unchanged, and a new request does not make an old rate new. A rate more than seven days old gets a notice.

The chart's latest value and percentage change come from the history response, not from the current table, because their dates can differ.

## Rate checks and offline behavior

The app checks rates when the last check is at least one hour old and the page is online and visible. Window focus, a return to the tab, a reconnect, and a 30-second timer can each start a check. Only one request runs at a time.

A request times out after 10 seconds. After a failure the delays are 1, 5, 15, and then 60 minutes. A 429 response uses its `Retry-After` value, or 15 minutes. Retry starts a request before the hour or the delay ends, except during a 429 delay.

A malformed response, or one with older rate dates, does not replace good data. If a response has no rate for the source, the app keeps the table it has. On a first visit, a table with some rates missing still lets the other currencies convert.

The app saves rates that arrive during an edit. The screen changes when the edit ends. Until then it shows the check time of the table on screen.

Saved rates work offline. A first visit with no connection cannot convert. A saved history series works offline, but a period the chart never showed needs a connection. The service worker does not save API responses.

## Terms

Read [Frankfurter's license and provider terms](https://frankfurter.dev/license/). Frankfurter's software license gives no rights to each provider's data, so the providers' terms apply. A reference rate can be late, missing, revised, or blended from several sources. A blended value may not be the official rate of any one institution.

About the rates links to Frankfurter and its terms. Nobody has yet reviewed the terms of the providers whose data the app shows, or added the credits they require.

Results are reference estimates. Bank, card, transfer, and cash prices can differ because of timing, spread, and fees. Fex gives no transaction quote.
