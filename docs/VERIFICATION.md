# Local verification

Recorded on 26 September 2026, on macOS with Node 22.22.3 and Playwright 1.63.0. This record describes local checks. It does not establish a deployed site's behavior or physical phone performance.

## Functional checks

`npm run check` runs type checks, lint, 81 unit tests, a production build, compressed size checks, browser tests, and performance checks. The functional browser suite has 46 passing cases and two explicit WebKit offline-navigation skips. Both performance cases pass.

The browser checks cover conversion from any row, retained precision, empty/zero/incomplete/invalid input, cursor preservation, the complete picker, list order and removal, Undo, saved choices, errors and retry, refresh timing, editing during refresh, cross-tab changes, and keyboard focus. No request is made when an amount changes.

Real service worker checks use temporary builds with distinct JavaScript hashes and the production content security policy. They cover `/` and `/fex/`, updates, rollback, saved drafts, two-tab cache retention, cleanup after the old tab closes, and `Vary: Origin` cache matching. They also check that missing routes are not replaced with the app and that API responses are not put in the shell cache. The `/fex/` server sends no custom security headers; tests verify that the generated HTML CSP blocks inline scripts, as needed for GitHub Pages.

Chromium and Firefox pass offline reopening. WebKit passes the online lifecycle cases, but its offline navigation returns an internal error for reloads, new pages, and a persistent profile. Its two offline-specific cases are marked skipped. Safari/iOS offline launch needs a physical-device check; it is not claimed as verified.

## Performance sample

Profile: Chromium, 390 × 844 viewport, four-times CPU slowdown. Cold load uses 1.6 Mbps throughput and 150 ms latency. API responses use fixtures. Warm load uses the actual offline service worker and saved rates. These are lab measurements on the development machine, not phone guarantees.

| Check | Measured | Target |
| --- | ---: | ---: |
| Initial JavaScript, gzip | 18.94 KiB | 25 KiB |
| Page and offline installation, gzip | 48.75 KiB | 75 KiB |
| First contentful paint | 412 ms | 1,500 ms |
| Controls ready | 495 ms | 2,000 ms |
| Offline saved-rate restore, p95 of five loads | 85 ms | 500 ms |
| Input handler, eight currencies, p95 of 20 edits | 1 ms | 50 ms |
| Input handler, all 166 codes, p95 of 20 edits | 5.3 ms | 100 ms |
| Picker opening | 30.5 ms | 100 ms |
| Search handler, p95 | 1.2 ms | 100 ms |
| Cold-load layout shift | 0.00027 | 0.05 |

No long tasks were observed during the full-list input sample. Handler measurements include calculations and DOM writes; they are not field INP measurements. The first-load shell reserves card space to avoid shifting the footer when JavaScript starts.

Run `npm run test:performance` after a production build to repeat these checks. JSON measurements and phone/desktop screenshots are saved in `test-results/`. The phone list, full desktop list, and currency picker were also inspected visually.

## Live data check

`npm run test:live` passed at 2026-09-26 15:48:53 UTC. Both Frankfurter endpoints returned HTTP 200 with CORS `*`. The catalog contained 166 codes; the normalized table contained 166 rates including the USD identity. All eight default currencies were covered. Rate dates ranged from 24 to 26 September 2026.

The check sends only catalog and general USD-table requests, with no amount. It validates response headers from Node; final-domain browser access is a separate release check. Live data checks are deliberately outside the deterministic test suite.

## Release checks still required

- Install and launch on physical Android Chrome and iPhone Safari, including offline launch and mobile decimal keyboards.
- Check HTTPS, headers, rate access, installation, updates, and rollback on the chosen public domain.
- Review applicable provider terms and credits before public deployment.

The repository includes separate check and GitHub Pages workflows. Deployment requires successful checks and Pages enabled with GitHub Actions as its source. Disabled Pages produces a successful build with deployment skipped; no workflow enables it through the API. Workflow results must be read from GitHub after a push; a local pass is not a CI pass. The custom domain remains undecided.
