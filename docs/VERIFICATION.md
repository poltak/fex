# Verification

`pnpm run check` passed every step on 4 October 2026, on one development computer.

| Step | Result |
| --- | --- |
| Type check and lint | No errors |
| Unit tests | 129 passed |
| Browser tests in Chromium, Firefox, and WebKit | 135 passed, 3 skipped |
| Performance checks in Chromium | 3 passed |
| Initial JavaScript, gzip | 23.02 KiB of the 25 KiB limit |
| Offline installation, gzip | 59.62 KiB of the 75 KiB limit, for 19 files and the worker |

A build with `FEX_BASE_PATH=/fex/` has the same sizes to within 0.01 KiB.

Playwright skips the three WebKit offline tests, because its WebKit build returns an internal error when it loads a page offline. Chromium and Firefox pass the same tests.

## What the tests cover

The converter tests cover conversion from each card, precision, empty, zero, incomplete, and invalid input, cursor position, the picker, list order and removal, Undo, saved choices, errors and Retry, the timing of rate checks, an edit during a rate check, changes from a second tab, keyboard focus, and localized digits. They confirm that an amount change makes no request and that Retry stays available after the window gets focus.

The chart tests cover one request per period on demand, reuse of a saved longer range, pair selection, links and browser history, the converter's amount text and scroll position, requests that finish out of order, keyboard and pointer selection, the empty, one-point, flat, error, and offline states, a reload after a reconnect, and layout at 320 px and on a desktop. They confirm that a window focus keeps the selected point and makes no request, and that the chart draws once per series.

The storage tests cover a database that does not respond, a late connection, blocked storage, corrupt records, clock changes, the 12-series limit, and deletion of corrupt or surplus history when the cache loads.

The service worker tests make builds with different file hashes and serve them at `/` and `/fex/`. They cover updates, rollback, saved amount text, cache retention while an old tab is open, cleanup after it closes, and cache matching with `Vary: Origin`. A path that does not exist does not get the app page, and the app's cache holds no API responses. The `/fex/` server sends no security headers, and the tests confirm that the policy in the HTML blocks inline scripts. When another worker controls the whole origin, the first Fex install shows no update notice.

## Performance

The tests use Chromium with a 390 × 844 viewport. The startup and input rows slow the CPU four times. The cold start also limits the network to 1.6 Mbps with 150 ms latency. The chart rows have no throttling. These are lab results, not results from a phone.

| Check | Measured | Limit |
| --- | ---: | ---: |
| First contentful paint on a cold start | 480 ms | 1,500 ms |
| Controls ready on a cold start | 588 ms | 2,000 ms |
| Saved rates on screen after an offline reload, 95th percentile of 5 | 96 ms | 500 ms |
| Input handler with 8 currencies, 95th percentile of 20 | 1.0 ms | 50 ms |
| Input handler with 166 currencies, 95th percentile of 20 | 4.5 ms | 100 ms |
| First opening of the picker | 31 ms | 100 ms |
| Later openings of the picker, 95th percentile of 10 | 19 ms | 100 ms |
| Search handler, 95th percentile of 10 | 5.3 ms | 100 ms |
| Chart opening with saved data | 2.5 ms | 100 ms |
| Chart draw of five years, 1,827 points | 1.5 ms | 100 ms |
| Layout shift on a cold start | 0.00005 | 0.05 |

The full-catalog input run had no long tasks. Handler times include the calculation and the page writes. They are not field INP values. Two runs of the same build can differ by a few milliseconds.

The review of 4 October cut the chart opening from 9 ms to 2.3 ms, measured twice for each build on the same computer. The other rows stayed within their usual variation. [The code reviews](CODE_REVIEW.md) list the changes.

`pnpm run test:performance` repeats these checks after a build and writes the measurements and screenshots to `test-results/`.

## Live API

`pnpm run test:live` passed on 4 October 2026. The catalog, the latest table, and one week of USD/VND history each returned HTTP 200 with `Access-Control-Allow-Origin: *`. The catalog had 165 codes, and the table had 165 rates including USD. The history had six observations. The check runs in Node and sends no amount.

## Published site

The site is at <https://poltak.github.io/fex/>, and Pages uses GitHub Actions as its source.

- The first Check and Deploy GitHub Pages runs passed for commit `0b93e65`.
- Commit `a54c27d` merged the two workflows into Check and deploy. Its check, Pages build, and deployment jobs passed.
- The HTML, manifest, and worker returned HTTP 200 with the correct content types. The manifest uses `/fex/` for its ID, start URL, and scope. The HTML contains the content security policy.
- GitHub serves the files with a cache time of 600 seconds. The worker registration uses `updateViaCache: 'none'`.
- In a browser on the published site, conversion worked and the picker showed the full catalog.

Only local runs have verified the changes of 4 October. A workflow run must pass before they reach the published site.

## Not yet verified

- Installation, offline start, and the decimal keyboard on a physical Android phone and iPhone.
- Offline start in Safari.
- Startup and input timing on a phone.
- The data providers' terms and credits.
