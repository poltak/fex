# Rules for the currency history chart

The chart is the second screen of Fex. It draws the daily [Frankfurter](https://frankfurter.dev/) rate of one base currency in one quote currency as an SVG line, with no chart library.

## Navigation

- A control below the header switches between Convert and Chart.
- Each card other than the source has a View history button. It opens the chart for the source and that card's currency, and keeps the last period.
- The first time, the Chart control shows the converter's source against the first other currency in the list, for 1M. After that it shows the last pair and period.
- The chart has its own base control, quote control, and Swap. Each control opens a search dialog with the full catalog. Choosing the opposite currency swaps the pair.
- A chart selection does not change the converter's list, source, or amount.
- The chart address is `#chart?base=USD&quote=VND&period=1M`. The address with no fragment is Convert. Changing the screen adds a browser history entry. Changing the pair or period replaces the entry.
- A valid link overrides the saved settings. An invalid link shows the saved pair for 1M.
- Focus moves to the heading of the new screen. When the user returns from a card's View history button, focus goes back to that button.

## Content

The screen shows, in order:

1. The base and quote controls, with Swap.
2. The latest rate in the series, in the form `1 USD = 26,000 VND`, with its date.
3. The percentage change from the first observation to the last, with a sign and the word up, down, or unchanged.
4. The period controls 1W, 1M, 3M, 1Y, and 5Y.
5. The line chart, with a date axis and a value axis.
6. The date span of the observations, the time of the last check, and a link to About the rates.

The chart always shows one unit of the base currency. The amount in the converter has no effect. The latest rate and the change come from the history series, because its dates can differ from the dates in the current rate table.

The date axis covers the requested range even when the series is shorter. The value axis has padding and does not start at zero, so it needs its labels. The line has straight segments between observations. The app does not smooth the line or add points. A flat series gets a range around its value.

A pointer or a touch selects the nearest observation and shows its date and rate. On the keyboard, Left and Right select the previous and next observation, and Home and End select the first and last. A screen reader announces keyboard selection only. Loading the series again keeps the selected date. The page still scrolls vertically on a touch screen.

## Dates and requests

| Period | Start date, counted back from today in UTC |
| --- | --- |
| 1W | Seven days |
| 1M | One calendar month |
| 3M | Three calendar months |
| 1Y | Twelve calendar months |
| 5Y | Sixty calendar months |

Both dates are inclusive. If the target month is shorter, the start date is its last day. All date calculations use UTC.

One request gets one pair for one range:

`https://api.frankfurter.dev/v2/rates?base=USD&quotes=VND&from=2026-08-27&to=2026-09-27`

The app keeps daily detail for all periods. On 27 September 2026, five years of USD/VND came to 1,827 rows and about 113 KB of JSON.

The app validates a response before it saves or draws it. The response must be an array. Each row must have the requested pair, a date in the requested range, and a finite, positive rate. Two rows with the same date and different rates make the response invalid. The app sorts the rows by date. It uses decimal values for the displayed change and plain numbers only for drawing.

A series can be shorter than the requested range, so the screen always shows the dates of the first and last observation. A response with no rows shows a message. A response with one row shows the point and its rate, with no change.

## Loading and cache

1. The app requests history only when the chart opens or its selection changes. It makes no history request at startup or while the user edits an amount.
2. The key of a saved series holds the base, the quote, and the requested dates. The series records when the app checked it and when the app last used it.
3. The app uses a saved series for a longer range when that range includes the requested one.
4. A saved series less than one hour old needs no request. The app shows an older one first, then fetches a new one in the background.
5. After the UTC day changes, the app can show the previous day's series while the new range loads.
6. When the visible series is less than one hour old, loading the same range again does nothing. This happens when the window gets focus or the connection returns. The selected point stays.
7. The app does not start a request that is already running. A new selection cancels the previous request, and the app ignores a late response.
8. The timeout and the retry delays match those for current rates. An HTTP 404 means the pair has no history, and the app saves that as an empty series.

The app saves at most 12 series and 2 MiB, and deletes the series it used longest ago. It reads the saved series from IndexedDB once per page load and then works from its copy in memory. The app shows a response larger than the limit but does not save it. The service worker does not save API responses.

| Condition | Screen |
| --- | --- |
| First load | The chart area keeps a fixed size while it loads. The controls stay active. |
| Saved series less than one hour old | The chart appears with no request. |
| Older saved series | The chart appears with a note that the app is checking for updates. |
| Offline with a saved series | The chart appears with its dates and the time of the last check. |
| Offline with no saved series | A message says this period needs a connection. |
| Request error or rate limit | The saved series stays if there is one, and Retry appears. |
| No history for the pair | A message names the pair and period. |

The line of one pair never appears under the label of another pair. The screen never describes a shorter saved range as the full period.
