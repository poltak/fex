# Fex product rules and limits

Fex is a public currency converter that works as a website and as an installed PWA. This document lists the rules the app follows and the limits a release must meet. It began as the implementation plan of 26 September 2026.

Fex has no accounts, sync between devices, transfers, fees or spread, rate alerts, date picker, cryptocurrency feeds, advertising, analytics, or theme switch.

## Screens

Convert is the first screen. It shows one card for each selected currency, in the user's order.

| Part | Rule |
| --- | --- |
| Card identity | Each card shows a badge, the ISO code, and the name. The code stays visible when space is tight. |
| Card amount | Each card has a large, right-aligned number field. Any card can become the source. |
| Source card | A border and a Source label mark the source, so color is not the only sign. |
| Unit rate | Each other card shows one short line such as `1 USD ≈ 26,000 VND`. |
| View history | Each other card has a button that opens the chart for the source and that card's currency. |
| Rate status | The status shows the rate date or date range, and the time of the last check. |
| Menu | The menu holds Manage currencies, About the rates, and Install Fex when the browser can install the app. |

Currency history is the second screen. It shows one base currency against one quote currency for 1W, 1M, 3M, 1Y, or 5Y. [The chart rules](docs/HISTORY_CHART_PLAN.md) describe it. The converter stays in the page while the chart shows, so the amount text and the scroll position stay as the user left them.

The design is dark, with rounded cards, large tabular numbers, a system font, and one accent color. The layout is one column, at most 672 px wide. It must work from a width of 320 px, in landscape, and at 200% text zoom.

Badges are local files, and the app loads no images from another site. The code and name must be enough when a badge fails to load.

## Amount input

1. A tap in a card's field makes that currency the source. The card does not move.
2. If the card showed a result, its unrounded value becomes the source amount. Selecting a card must not change the amount through display rounding.
3. The first focus selects the text. Later taps place the cursor.
4. Each valid change updates the other cards on that keystroke, with no network request and no Convert button.
5. Enter or Done ends the edit. A tap on another amount changes the source.
6. New rates keep the source amount and update the other amounts.

The app keeps the raw text apart from the parsed value. It does not add separators, move the cursor, or rewrite the text while the user types.

| Input | Result |
| --- | --- |
| A valid positive amount | All available conversions update. |
| Zero | The other cards show zero with each currency's usual precision. |
| Empty | The field stays empty and the other cards show a dash. Empty is not zero. |
| An incomplete decimal such as `10.` | The text stays. The other cards show a dash until the value is complete. |
| Invalid text | A message appears below the field. The app does not change the number or keep old results on screen. |
| A negative number | The message says "Enter zero or a positive amount." |
| More than 15 whole digits or 12 decimal digits | The message gives the limit. |
| A result smaller than the display unit | The card shows a less-than value such as `<0.01`. A nonzero result never shows as zero. |

Inactive amounts use the browser's locale and the currency's usual decimal places. VND and JPY have none, and USD has two. The source field keeps the precision the user typed.

The parser reads the locale's decimal and group characters. It accepts spaces as group characters. It accepts a point as the decimal only when the text has one possible meaning, and it rejects text with two. The tests cover English, Vietnamese, German, French, Arabic, Persian, Bengali, Hindi, and Swiss German formats.

## Currency list

The picker uses the full current catalog from [Frankfurter](https://api.frankfurter.dev/v2/currencies). "All currencies" means every current code Frankfurter has. Metals and other units sit in a group named Other supported units.

- Search matches the code, name, or symbol. Case and accents do not matter, so "dong" finds Vietnamese Đồng.
- An exact code match comes first. The other results are in name order.
- The picker marks a currency that is already in the list and does not add it twice.
- The user can select several currencies before Add. The app adds them in selection order.
- The number of currencies has no limit.
- A currency with no rate stays in the list, labeled "Rate unavailable".
- Offline, the picker uses the saved catalog.

The app bundles a catalog for a visitor whose first catalog request fails. A newer saved or fetched catalog replaces it. The app requests the catalog at most once in 24 hours.

Manage currencies has Move up, Move down, and Remove buttons, and the user can drag rows into a new order. Removing a result does not change the source amount. Removing the source makes the next currency with a rate the source, with its exact converted value. One card always remains. Undo restores the row. It also restores the source and amount if nothing changed after the removal.

## Conversion

The app gets one table of rates with USD as the base. Each conversion is:

```text
target amount = source amount × USD-to-target rate ÷ USD-to-source rate
```

USD to USD is 1. Arithmetic uses decimals with 40 significant digits and rounds only for display. One calculation uses one table. The app does not mix it with pairs requested on their own.

Before the app uses a response, it validates the base, each code, each date, and each rate. A rate must be finite and positive. The app rejects a response with conflicting duplicate rows and ignores fields it does not know. A bad or empty response does not replace a good table.

A currency with no rate shows as unavailable. The app never substitutes zero or 1. If a new table has no rate for the source, the app keeps the table it has and reports the problem.

## Rate checks

| Event | Action |
| --- | --- |
| First visit | The app fetches rates and shows a loading state. |
| Start with saved rates | The app shows the saved values first. It fetches if the last check is at least one hour old. |
| Return to the tab or window | The app applies the same one-hour rule. |
| The page stays open | The app checks when the hour ends. |
| Typing, a source change, an added currency, or a reorder | The app makes no request. |
| The connection returns | The app tries again once the retry delay has passed. |
| The page is hidden or closed | The app makes no requests. |

Only one request runs at a time, with a 10-second timeout. An older response cannot replace a newer table. A response with unchanged rate dates still counts as a successful check.

After a failure the app waits 1 minute, then 5, then 15, then 60. For HTTP 429 it uses `Retry-After`, or 15 minutes. Retry is available after a failure, but it cannot cut a 429 delay short.

The app saves rates that arrive during an edit, but the cards do not change until the edit ends.

## Rate dates

Frankfurter gives a date for each rate, and one table can hold several dates.

- The app keeps the date of each rate and, as a separate value, the time of the last successful check.
- A conversion between two currencies other than USD uses two rates. The older date is the age of the result.
- The status shows the date or date range of the visible list. About the rates shows the dates for each currency.
- A failed check does not change the time of the last check.
- A weekend or holiday date is not an error. A rate more than seven calendar days old gets a notice.
- Age uses UTC calendar dates.

About the rates says the values are reference estimates that can differ from bank, card, or cash prices. It links to Frankfurter and its terms.

## Offline use and storage

After one visit with a connection, the app and the last table work offline. The status then says the app is offline and uses saved rates, and it shows the rate dates. With no saved rates, it asks the user to connect once.

| Data | Location |
| --- | --- |
| The list, source, amount, and unfinished amount text | localStorage |
| The rate table and the catalog | IndexedDB |
| History series | IndexedDB, at most 12 series and 2 MiB |
| App files | Cache Storage, through the service worker |

Each record has a version, and the app validates it on every read. The app saves amounts as decimal strings. It saves 250 ms after a change, and without delay when an edit ends or the page hides. An input handler never writes to storage.

If the browser blocks storage, or storage is full or corrupt, the app works from memory and warns that it may not save changes. A late read from storage must not replace newer data from the network.

Two tabs share data. A preference change in one tab reaches the others but does not replace an amount the user is editing. A tab that saves rates tells the other tabs.

The app sends no amounts and no currency list to any server.

## Installation and updates

The manifest has a stable ID, name, start URL, scope, and 192 px and 512 px icons in normal and maskable forms. The site must use HTTPS.

The menu shows Install Fex only when the browser can install the app. On iOS it shows the Add to Home Screen steps. An installed app hides the item. The converter works in browsers that cannot install it.

The service worker is `src/pwa/sw.js`, and the build adds the list of files to it. The worker saves the page, scripts, styles, icons, and badges, and serves them from its cache before the network. It does not save API responses.

A new app version waits until the user selects Update. The app saves the current amount text before the reload. The worker deletes old caches once no open tab uses them. It keeps preferences and rates.

## Technology

| Layer | Choice |
| --- | --- |
| UI | HTML, CSS, and JavaScript modules, with native inputs, buttons, and `dialog` elements and no UI framework |
| Types | JSDoc comments that TypeScript checks |
| Build | Vite |
| Arithmetic | decimal.js-light, the only runtime dependency |
| Network | `fetch` and `AbortController` |
| PWA | vite-plugin-pwa, which adds the file list to the worker and writes the manifest |
| Tests | Vitest and Playwright |
| Hosting | GitHub Pages, as [deployment](docs/DEPLOYMENT.md) describes |

Parsing, calculation, formatting, validation, the rules for rate checks, and storage do not touch the DOM. A function with many inputs takes one object.

The app keeps a map from each currency code to its card. It creates or removes a card only when the list changes, and moves a card when the order changes. Text from the API enters the page as text, never as HTML.

On each keystroke the app writes only to the fields that changed. It leaves the focused field, the unit-rate lines, and storage alone.

## Accessibility and mobile

- Each amount field has a label with the currency code and name, and assistive technology can tell which card is the source.
- Focus is visible. Touch targets are at least 44 by 44 CSS pixels.
- Dialogs keep focus inside, close with Escape, and return focus to the control that opened them.
- Reordering and removal work with the keyboard.
- A screen reader announces errors and completed rate checks without interrupting. It does not announce results on each keystroke.
- The app drops animation when the system asks for reduced motion.
- The layout allows for display cutouts, safe areas, and the on-screen keyboard.
- Long names and large values stay inside their cards.

## Tests

- Conversion tests cover identity, cross rates, source changes without rounding drift, and a fixed source amount across a rate check.
- Precision tests cover zero, large and tiny values, minor units, and display rounding.
- Input tests cover empty and incomplete text, invalid text, locale separators, limits, cursor position, and keys.
- List tests cover search, adding several currencies, removing the source, Undo, and keyboard reordering.
- API tests cover malformed data, conflicting rows, missing rates, timeouts, HTTP 429, and responses that arrive out of order.
- Rate check tests cover the one-hour rule, one request for events that arrive together, retry delays, and rates that arrive during an edit.
- Storage tests cover reload, corrupt records, blocked storage, a second tab, and a database that does not respond.
- Offline and PWA tests cover offline reload, updates and rollback with unfinished text, and scope.
- Layout tests cover 320 px, desktop, long names, and large numbers.

Tests use fixed API responses. `pnpm run test:live` checks the live API on its own.

Installation, offline start, and the keyboard need a check on a physical Android phone and iPhone. Browser emulation does not prove them.

## Performance limits

Measure the production build, and record the browser, CPU setting, network profile, and number of cards.

| Measure | Limit |
| --- | --- |
| Initial JavaScript | 25 KiB gzip |
| Offline installation, which is every file the worker saves plus the worker | 75 KiB gzip |
| First visible page on a cold start | 1.5 s on the test profile. The page does not wait for rates. |
| Controls ready on a cold start | 2 s on the test profile |
| Repeat visit with saved files and rates | 500 ms to a usable converter |
| Typing with eight cards | 50 ms at the 95th percentile |
| Opening the picker, searching, or changing the source | 100 ms at the 95th percentile |
| Typing with the full catalog | 100 ms at the 95th percentile, with no repeated task longer than 50 ms |
| Chart with saved data | 100 ms to open and 100 ms to draw five years |
| Layout shift | 0.05 in the test flow |

`pnpm run check` fails if the build exceeds the first two limits, or if a Chromium lab run is slower than the others. [Verification](docs/VERIFICATION.md) has the results. A lab run is not a measurement on a phone.

## Release condition

A new visitor can open the site, see the first list, edit an amount, search the full catalog, add and arrange currencies, and find the same list on the next visit. With saved data, the same conversions work offline. A rate check updates results without changing the source amount or interrupting an edit. Every visible result uses a valid rate and shows its date. The build meets the limits above.
