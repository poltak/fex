# Fex

Fex is a currency converter that runs in the browser. It has a Convert screen and a history chart for one currency pair. The app is plain HTML, CSS, and JavaScript with one runtime dependency, `decimal.js-light`. It has no account, no server, and no API key. Vite builds the static site and its service worker.

Edit the amount on a card and that currency becomes the source. The other cards update on each keystroke. You can add currencies from the Frankfurter catalog, reorder them, and remove them. The browser keeps the list, the source, and the amount. The first list is VND, USD, EUR, SGD, AUD, THB, GBP, and IDR, with USD 10 as the source.

The live site is <https://poltak.github.io/fex/>.

## Run locally

Use Node.js 22.22.2 or later on the 22 line, or 24.15 or later. Use pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Open the address that Vite prints. The development server does not register the service worker.

## Check

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm run check
```

`check` runs these steps in order: type check, lint, unit tests, production build, size limits, browser tests in Chromium, Firefox, and WebKit, and a Chromium performance suite. The browser tests use fixed API responses and need no network.

| Command | Purpose |
| --- | --- |
| `pnpm run build` | Builds the site into `dist/`. |
| `pnpm run preview` | Serves `dist/` at `http://127.0.0.1:4173`. |
| `pnpm run check:size` | Fails if the initial JavaScript exceeds 25 KiB gzip or the offline installation exceeds 75 KiB gzip. |
| `pnpm run test:performance` | Runs the performance suite again after a build. |
| `pnpm run test:live` | Reads the live Frankfurter API and checks its schema, the first list, and its CORS headers. `FEX_SMOKE_ORIGIN` sets the origin to check. The script sends no amount. |
| `pnpm run icons` | Regenerates the install icons after a change to the mark in `scripts/icons.mjs`. A build does not run this script. |

## Deployment

The Check and deploy workflow runs the full check on each pull request and each push to `main`. After a push to `main` it builds for the GitHub Pages path and deploys. [Deployment](docs/DEPLOYMENT.md) covers the Pages setup, other hosts, and rollback.

GitHub Pages ignores `public/_headers`, so the build also puts the content security policy in the HTML.

## Data and privacy

The browser requests three things from [Frankfurter](https://frankfurter.dev/): the currency catalog, the latest USD rate table, and the daily history of a pair when the chart shows it. A request contains currency codes and dates. It never contains an amount or the user's list. The browser does all conversion. The app has no analytics. The host and the API see normal request data such as an IP address.

`src/catalog.js` holds a catalog of 166 codes from 26 September 2026, which the app uses until the first catalog response arrives. The app bundles no rates, so a first visit without a connection cannot convert. [Data sources](docs/DATA_SOURCES.md) explains the calculation, the rate dates, and the rules for rate checks.

| Storage | Name | Content |
| --- | --- | --- |
| localStorage | `fex:preferences:v1` | The currency order, the source, the amount, and the raw text of an amount that is not yet valid. |
| localStorage | `fex:chart-settings:v1` | The last chart pair and period. |
| IndexedDB | Database `fex-cache`, store `cache`, keys `rates`, `catalog`, and `history:v1:<base>:<quote>:<from>:<to>` | The current rates, the catalog, and at most 12 history series. |
| BroadcastChannel | `fex:cache:v1` | A notice that tells other tabs about newly saved rates. |
| Cache Storage | `fex-shell:<scope>:<build ID>` | The app's files for one build. |

Each saved record has a version, and the app ignores a record that fails validation. If the browser blocks storage, the app works from memory and shows a notice. Browsers keep saved data per origin, so a different domain starts with an empty list.

## Offline use, installation, and updates

Open the site once with a connection. After that, the app and the saved rates work offline. A chart period works offline only after the chart has shown it once.

Where the browser offers an install prompt, the menu shows Install Fex. On iPhone and iPad, the menu gives the steps for Safari's Share menu.

A new version of the app waits until the user accepts it. The app saves the current amount text before it reloads. Rate checks and app updates do not depend on each other.

## Not yet verified

- Offline start in Safari. The WebKit test runner cannot load a page offline, so Playwright skips three tests.
- Installation, offline start, and input timing on a physical Android phone and iPhone.
- The data providers' terms and credits, which [data sources](docs/DATA_SOURCES.md) describes.

[Verification](docs/VERIFICATION.md) has the current test and performance results.

## Files

| File | Responsibility |
| --- | --- |
| `index.html`, `src/style.css` | The page structure, the dialogs, the card template, and the styles. |
| `src/app.js` | Cards, amount editing, dialogs, screen navigation, and page lifecycle. |
| `src/domain.js` | Amount parsing, decimal conversion, and number formatting. |
| `src/data.js` | Frankfurter requests, response validation, and the controller for rate checks. |
| `src/storage.js` | Preferences, the IndexedDB cache, and notices between tabs. |
| `src/picker.js` | The currency list that the Add dialog and the chart share. |
| `src/chart.js` | The chart screen, with its pair controls, SVG drawing, and point selection. The app loads this file when the chart opens. |
| `src/history.js`, `src/history-data.js` | Chart date ranges, history validation, history requests, and the saved series. |
| `src/catalog.js` | The first list and the bundled catalog. |
| `src/pwa/` | The service worker, its registration, installation, and the update notice. |
| `tests/` | Vitest unit tests and Playwright browser tests. |
| `APP_PLAN.md` | Product rules and performance limits. |
