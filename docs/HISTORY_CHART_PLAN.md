# Historical currency chart implementation plan

Status: implemented and locally verified. See [Local verification](VERIFICATION.md) for test and measurement results. Physical-device and deployed-site verification remain open.

## Recommendation

Use Frankfurter for a second screen with a line chart and **1W, 1M, 3M, 1Y, and 5Y** controls. Fetch a period only when the user opens it. Save successful results so a repeat visit is fast and a saved chart works offline. Do not fetch all five periods at startup or in the background.

Keep the current plain HTML, CSS, and JavaScript structure. Use a native SVG chart and the existing decimal.js-light dependency. No new production dependency, API key, or backend is needed.

## How it fits into Fex

1. Add a small **Convert / Chart** navigation control below the existing header. Keep the current dark colors, rounded cards, system font, and green accent. Use the same content width on both screens.
2. Add a **View history** action to each non-source currency card, near its unit-rate text. For example, with USD as the source, the action on the VND card opens USD → VND. Keep this a separate button; amount fields retain their current behavior.
3. On the first visit through the Chart control, use the converter source and the first different currency in the saved list. Start with **1M**. On later visits, restore the last chart pair and period. A card action overrides the pair and keeps the last period.
4. Give the chart its own two currency controls and a swap button. Allow selection from the full current catalog, using a searchable, single-selection dialog. Do not change the converter list, source, amount, or saved draft when a chart selection changes. If the user selects the opposite currency, swap the pair so the two currencies stay different.
5. Keep the converter DOM mounted while hidden. Save its scroll position and restore it when the user returns. Preserve incomplete amount input through the current draft-save path.

Use fragment navigation, for example `#chart?base=USD&quote=VND&period=1M`, so reloads and browser Back work on GitHub Pages without server routes. Keep the root URL as Convert. Push history when moving between screens; replace the current chart entry when the pair or period changes. Validate URL values and fall back to a valid saved pair and 1M. A valid chart URL takes priority over saved chart settings.

Move focus to the new screen heading on navigation. When the user returns from a card action, restore focus to that action if it still exists. Hide the inactive screen from both keyboard and screen-reader navigation. A later converter update from another tab must not change the visible chart pair.

## Chart content and interaction

Show these items in order:

- Heading: **Currency history**.
- Base and quote controls, with their codes and names, plus Swap.
- Latest available rate in the selected series, labelled `1 USD = … VND`, with its actual observation date.
- Percentage change between the first and last available observations. Include the signed number and “up”, “down”, or “unchanged”; do not communicate direction by color alone.
- Period controls: **1W · 1M · 3M · 1Y · 5Y**.
- Responsive line chart, with a date axis and a quote-currency value axis.
- A short source/status line with the actual date range, last check, and a link to the existing rate explanation.

The chart always shows the value of **one unit of the base currency**. The converter amount does not scale it. Calculate the headline and percentage from the historical series, not the latest-rate snapshot, which can have different source dates.

Use a time-based horizontal scale and a padded vertical scale. Label the vertical values clearly because the scale will not normally start at zero. Use straight segments between supplied observations; do not create a smoothed curve or invented daily points. Handle a flat series with a non-zero axis range.

Pointer hover or touch selects the nearest supplied observation and shows its date and rate. Make the chart focusable; Left/Right selects the previous/next observation, and Home/End selects the first/last. Provide a text summary and a labelled selected-point readout. Announce keyboard selection without announcing every pointer move. Keep vertical page scrolling available on touch devices. Honor reduced-motion settings and keep a fixed chart area during loading.

## Date ranges and data requests

Use the existing [Frankfurter v2 time-series API](https://frankfurter.dev/):

`https://api.frankfurter.dev/v2/rates?base=USD&quotes=VND&from=2026-08-27&to=2026-09-27`

| Control | Start date, relative to today in UTC | Data |
| --- | --- | --- |
| 1W | Seven calendar days earlier | Daily observations |
| 1M | One calendar month earlier | Daily observations |
| 3M | Three calendar months earlier | Daily observations |
| 1Y | One calendar year earlier | Daily observations |
| 5Y | Five calendar years earlier | Daily observations |

Both bounds are inclusive. Clamp month/year subtraction to the last valid day of the target month. Use UTC date-only calculations so time zones, daylight saving time, month ends, and leap years do not move the requested day. Format dates for the user's locale without shifting their calendar date.

Fetch one pair per request. Keep daily detail for all five periods initially; do not use API grouping or downsampling. A live check on 27 September 2026 returned 1,827 rows for five years of USD/VND, about 113 KB of uncompressed JSON. One SVG path can render this amount of data without a chart library. Measure other pairs during implementation; this sample is not a guarantee of every response size.

Validate the response before saving or drawing it: array shape, expected pair, valid dates within the request, unique observation dates, and finite positive rates. Sort valid rows by date. Reject conflicting duplicate dates and malformed rows instead of drawing a plausible but incorrect line. Preserve decimal rate values for displayed calculations; use numeric values only for chart geometry. Use decimal.js-light for percentage change.

Coverage varies by pair. Keep the requested axis range and show the actual supplied date span. Do not fill missing days, extend the final point to today, or assume weekends must be missing. If coverage is shorter, show “Available from [date]”. An empty response gets a no-history message; one observation gets a point and rate, with no percentage change or invented line.

## On-demand loading and cache policy

Keep historical data separate from the converter's current-rate snapshot and refresh controller.

1. On chart entry, pair change, or period change, calculate the requested bounds.
2. Check memory, then IndexedDB. Use a schema-versioned key containing base, quote, and requested bounds. Store points, `checkedAt`, and `lastUsedAt` with the record.
3. Reuse a cached larger request that fully covers the requested interval. Slice its observations locally. Determine coverage from the **requested bounds**, not the first and last returned observations. An empty part of a completed response is still a completed query.
4. Show saved matching data immediately. Recheck it only when more than one hour old, consistent with the existing latest-rate policy. Never change `checkedAt` merely because saved data was read.
5. With no matching saved data, show a loading state and fetch only the selected interval. Do not automatically fetch the other periods. After a UTC day change, an older saved series can remain visible as stale while the new interval loads.
6. Deduplicate identical in-flight requests. Cancel an obsolete request when the selection changes or the chart closes. Also check a request ID before applying results: a late response must never replace a newer selection.
7. Reuse the current ten-second timeout and Retry-After handling. Show Retry for failures and honor server cooldowns. On reconnect or return to a visible chart, refresh only its selected stale interval. Do not add a history polling timer.

Bound saved history to **12 request records and 2 MiB of serialized data**, evicting the least recently used records first. Treat these as initial limits to verify with tests. An oversized response can still be displayed without saving it. Store history records in the existing IndexedDB `cache` store under separate namespaced keys; retain the current database version and converter records. Keep memory bounded too, and preserve the existing fallback when storage is blocked, full, or stalled.

Store the last chart pair and period under a separate versioned localStorage key. Do not add fields to the converter preferences record that its current validator discards. Cache pruning must only remove history keys.

Keep remote API data out of the service-worker cache. The existing worker saves app assets; IndexedDB controls historical data age and offline behavior.

| Condition | Screen behavior |
| --- | --- |
| First load | Keep controls active; show a stable loading area |
| Fresh saved interval | Draw immediately; make no request |
| Stale saved interval | Draw with a saved-data/checking label; refresh in place |
| Offline with matching data | Draw and show its observation date and last check |
| Offline without matching data | Explain that this period needs a connection; keep controls available |
| Request error or rate limit | Keep matching saved data if available; show a clear retry state |
| Unsupported or empty history | Show no-history text for that pair and period |

Never leave the previous pair's line under a newly selected pair label. Clear unmatched content while the new selection loads. Do not describe a shorter saved interval as the full requested period.

## Code changes

| File | Responsibility |
| --- | --- |
| `index.html`, `src/style.css` | Screen containers, navigation, card actions, chart layout, accessible states, and mobile styles |
| `src/app.js` | Screen navigation, card entry points, lazy chart import, converter preservation, and lifecycle connection |
| `src/history.js` (new) | Pure date-range calculations, series validation, slicing, percentage calculations, and formatting rules |
| `src/history-data.js` (new) | Frankfurter history adapter, cache lookup, request cancellation, deduplication, and refresh state |
| `src/chart.js` (new) | Chart screen controller, SVG rendering, scales, ticks, and point selection |
| `src/data.js` | Expose the existing request helper for reuse while retaining current-rate behavior |
| `src/storage.js` | Namespaced history access, bounded pruning, and separate chart settings |
| `src/picker.js` | Add an explicit single-selection mode while preserving the existing multi-add mode |
| `tests/history.test.js`, `tests/history-data.test.js` (new) | Date, series, calculation, request, and cache tests |
| Existing storage and browser tests; new chart browser tests | Navigation, picker compatibility, offline use, accessibility, races, and performance |
| `scripts/check-size.mjs` | Include lazy chart assets in the total offline installation budget |
| `APP_PLAN.md`, `docs/DATA_SOURCES.md`, `docs/VERIFICATION.md`, `README.md` | Document the second screen, request policy, and completed checks |

Use object arguments for functions with multiple inputs. Keep pure data functions separate from DOM code and avoid import cycles between data, storage, and chart modules.

Load chart JavaScript when the chart first opens. The service worker may still download this chunk during installation so it is available offline; deferred execution does not mean zero installation cost. The current size script follows static imports only. Update it to count all precached production assets once in the installation total, while measuring initial JavaScript separately. Keep the existing **25 KiB initial JavaScript** and **75 KiB complete installation** gzip limits.

## Build order and completion checks

1. **Data and cache:** implement pure date/series functions, the history adapter, and storage. Test month ends, leap years, UTC rollover, flat/tiny rates, unordered rows, malformed data, empty and one-point responses, covered intervals, stale data, eviction, and storage failures.
2. **Screen and navigation:** add Convert/Chart, card actions, pair selection, fragment navigation, and saved chart settings. Verify browser Back/Forward, reload under `/fex/`, invalid URLs, focus, and converter draft/scroll preservation.
3. **Chart:** add SVG rendering, labels, percentage change, hover/touch/keyboard selection, and loading/error states. Check 320 px mobile layouts, desktop, long currency names, large values, and flat series.
4. **Offline and performance:** connect lifecycle refresh, precache the chart code, and fix asset accounting. Test a saved chart offline after reload, an unvisited period offline, service-worker updates, and blocked IndexedDB. Test rapid pair/period changes and out-of-order replies.
5. **Final validation:** run `pnpm run check` and a read-only live history smoke check. Use deterministic API fixtures for automated tests. Keep the converter's existing timing checks and add measures for cached chart opening and five-year rendering, with a target below 100 ms after the chart module and data are ready. Measure network loading separately.

Network assertions must prove that converter startup and amount edits make **no historical requests**, first opening an uncached chart makes one selected-period request, a fresh repeat or fully covered shorter period makes none, and only the current selection receives a response. Extend browser fixtures so history requests cannot accidentally receive latest-rate fixtures.

The feature is complete when all five periods work, saved charts work offline, keyboard and touch use are clear, late responses cannot change the wrong chart, and converter behavior and existing performance budgets remain intact.

## Evidence checked for this plan

- Current source: `src/data.js` already calls Frankfurter v2. `src/storage.js` uses localStorage for converter preferences and IndexedDB for rate/catalog records. `src/pwa/sw.js` caches same-origin app assets only.
- [Frankfurter documentation](https://frankfurter.dev/) describes `base`, `quotes`, `from`, and `to` for time series. Daily history is suitable for this feature; history is not an intraday trading feed.
- Live API checks on 27 September 2026 returned HTTP 200 for 1W and 5Y USD/VND requests. A request with an Origin header returned `Access-Control-Allow-Origin: *`. Browser and pair-coverage checks remain part of implementation validation.
- No application code, dependencies, or deployment settings were changed for this plan.
