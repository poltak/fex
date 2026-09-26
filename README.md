# Fex

Fex is a public currency converter built with plain HTML, CSS, and JavaScript. It has no account system or app server. It uses one small runtime library, `decimal.js-light`, for decimal arithmetic. Vite builds the static site and its PWA assets.

Edit any currency card to make it the source. Other cards update on the device. Add currencies from the current Frankfurter catalog, change their order, and save the list in the browser. The initial list is VND, USD, EUR, SGD, AUD, THB, GBP, and IDR, with USD 10 as the source.

## Run locally

Use Node.js 24.15 or later on the Node 24 line, or Node 22.22.2 or later on the Node 22 line. Use the committed npm lockfile.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. No API key or environment file is required. The development server does not register the production service worker.

## Build and check

```sh
npm exec -- playwright install --with-deps chromium firefox webkit
npm run check
```

The check runs JavaScript type checks, lint, unit tests, the production build, the bundle size gate, Playwright behavior tests in Chromium, Firefox, and WebKit, and a separate Chromium performance suite. Run `npm run test:performance` to repeat the performance suite by itself after a build. Browser tests use controlled API responses. They do not require current market values. On Linux, the browser installation command also installs the required system packages.

To inspect a production build:

```sh
npm run build
npm run preview
```

Open `http://127.0.0.1:4173`. Build output is in `dist/`. Run `npm run check:size` after a build to check the limits of 25 KiB gzip for initial JavaScript and 75 KiB compressed for the page and offline installation together. The report lists the service worker separately. These size checks do not replace measured startup and input timing on a phone. See the [local verification record](docs/VERIFICATION.md).

The **Check** workflow runs validation and uploads failure reports. The separate **Deploy GitHub Pages** workflow can publish after you enable Pages and its checks pass. A local test pass does not show that CI has run: CI requires a workflow run.

Run the read-only live API check separately:

```sh
npm run test:live
```

Set `FEX_SMOKE_ORIGIN=https://your-domain.example` to inspect CORS response headers for a planned origin. The default is `https://example.com`. The check validates catalog and rate schemas, initial-list coverage, dates, and CORS headers. It sends no amount. It is not part of the deterministic check and does not replace a request from the deployed browser.

## GitHub Pages

The repository includes a deployment workflow for `poltak/fex`. Open [Settings → Pages](https://github.com/poltak/fex/settings/pages), set **Source** to **GitHub Actions**, then open **Actions → Deploy GitHub Pages → Run workflow** and run it once on `main`. Later pushes to `main` deploy automatically. The default public URL is `https://poltak.github.io/fex/`; it is not confirmed live until deployment succeeds.

If Pages is still disabled, the workflow builds for `/fex/` and explains the remaining setting in its summary. It skips deployment and does not enable Pages through the API. Once enabled, the workflow reads the Pages base path, including a later custom-domain configuration. GitHub Pages supports public repositories on GitHub Free, so a paid host is not required. GitHub Pages ignores `_headers`; the Cloudflare header policy is not applied there. See [deployment steps and limits](docs/DEPLOYMENT.md).

## Data and privacy

The browser requests the full current currency catalog and the latest USD rate table from Frankfurter. It does not send entered amounts or the selected currency list. Conversion, parsing, formatting, and source changes run locally. The host and API provider can still receive normal request metadata, such as an IP address. The app has no analytics integration.

The bundled catalog contains 166 codes from the official endpoint, recorded on 26 September 2026. That is a fallback snapshot, not a permanent limit on the live catalog. Rates are not bundled. A new offline visit cannot calculate conversions without saved rates. See [data sources and rate dates](docs/DATA_SOURCES.md).

| Browser storage | Name | Content |
| --- | --- | --- |
| localStorage | `fex:preferences:v1` | Ordered codes, source, canonical amount, and an optional raw invalid or incomplete draft. |
| IndexedDB | Database `fex-cache`, version 1; store `cache`; keys `rates` and `catalog` | Validated rate snapshot and currency metadata, each with its last check time. |
| BroadcastChannel | `fex:cache:v1` | Notices that another tab saved rates; no amount payload. |
| Cache Storage | `fex-shell:<scope pathname>:<build ID>` | Static assets for that app build and scope. |

Saved records have schema versions. Invalid records are ignored. If storage fails, the current session can use memory; persistence is not guaranteed. Preferences use storage events between tabs. Fresh rates wait until editing ends before they replace displayed rates. Browser data is local to its origin: moving to another domain does not move saved choices. Root and `/fex/` builds on the same origin share the preference and IndexedDB names above.

## Offline use, installation, and updates

Open a production build online first so it can save the app shell and rates. Saved conversions then work offline. The catalog can remain visible without a rate; that currency stays unavailable until a valid rate arrives. Clearing browser data removes offline data. A browser can also remove stored data when space is limited.

Installation uses the browser's PWA support. Where the browser supplies an install prompt, use the app's Install control. On iPhone, use Safari's Share menu and Add to Home Screen. Installation needs a secure origin, except for local development allowances. Availability depends on the browser.

A new app version waits for acceptance before it activates. The app saves the current draft before accepting an update. Rate refresh and app code updates are separate. See [deployment, update, and rollback steps](docs/DEPLOYMENT.md).

The PWA browser suite checks root and `/fex/` builds in separate cases. Chromium and Firefox pass offline reopening. All three engines pass code updates and rollback without losing a draft. Two WebKit offline-navigation cases are skipped because the runner returns an internal navigation error, including in a persistent profile. Safari/iOS offline launch remains unverified. Physical Android Chrome and iPhone installation checks also remain pending. A Playwright phone viewport or WebKit test is not proof of an installed mobile PWA. Final-domain HTTPS, headers, API access, installation, offline restart, updates, and rollback remain pending until deployment is completed.

## Main files

| File | Responsibility |
| --- | --- |
| `src/app.js` | Cards, picker, input events, and app lifecycle. |
| `src/domain.js` | Decimal conversion, parsing, formatting, and rate dates. |
| `src/data.js` | API validation, refresh timing, retries, and pending rate updates. |
| `src/storage.js` | Preferences, IndexedDB, and notices between tabs. |
| `src/catalog.js` | Default list and official fallback catalog. |
| `src/pwa/` | Service worker registration, installation, and static asset cache. |
| `tests/` | Unit and browser tests. |
| `APP_PLAN.md` | Product scope, targets, and release requirements. |

Enable GitHub Pages when you are ready to publish. A custom domain can wait; the initial project address is `https://poltak.github.io/fex/`.
