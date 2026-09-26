# Local verification

Updated after the code review on 26 September 2026, on macOS with Node 26.10.0 and Playwright 1.63.0. This record describes local checks. It does not establish a deployed site's behavior or physical phone performance. See [the review findings and fixes](CODE_REVIEW.md).

## Functional checks

`npm run check` passed type checks, lint, 92 unit tests, a production build, compressed size checks, browser tests, and performance checks. The functional browser suite has 64 passing cases and two explicit WebKit offline-navigation skips. Both performance cases pass.

The browser checks cover conversion from any row, retained precision, empty/zero/incomplete/invalid input, cursor preservation, the complete picker, list order and removal, Undo, saved choices, errors and retry, refresh timing, editing during refresh, cross-tab changes, and keyboard focus. No request is made when an amount changes.

The review added regressions for stalled browser storage, localized digits, Undo after a newer cross-tab amount, unchanged card metadata during typing, and picker focus and node reuse across catalog updates and reopening. These cases pass in Chromium, Firefox, and WebKit. Unit tests also cover storage deadlines, late connections, locale-specific grouping, and clock tolerance for rates and catalogs.

Real service worker checks use temporary builds with distinct JavaScript hashes and the production content security policy. They cover `/` and `/fex/`, updates, rollback, saved drafts, two-tab cache retention, cleanup after the old tab closes, and `Vary: Origin` cache matching. They also check that missing routes are not replaced with the app and that API responses are not put in the shell cache. The `/fex/` server sends no custom security headers; tests verify that the generated HTML CSP blocks inline scripts, as needed for GitHub Pages.

Chromium and Firefox pass offline reopening. WebKit passes the online lifecycle cases, but its offline navigation returns an internal error for reloads, new pages, and a persistent profile. Its two offline-specific cases are marked skipped. Safari/iOS offline launch needs a physical-device check; it is not claimed as verified.

A first-install regression test starts with another app's worker controlling the wider origin. Fex must not show an update prompt unless its own registration has an active worker and a waiting update. This test failed before the fix and passes on all three engines. Another test checks that an old tab clears its update notice when a different tab accepts the update, without forcing the old tab to reload.

## Performance sample

Profile: Chromium, 390 × 844 viewport, four-times CPU slowdown. Cold load uses 1.6 Mbps throughput and 150 ms latency. API responses use fixtures. Warm load uses the actual offline service worker and saved rates. These are lab measurements on the development machine, not phone guarantees.

| Check | Measured | Target |
| --- | ---: | ---: |
| Initial JavaScript, gzip | 19.68 KiB | 25 KiB |
| Page and offline installation, gzip | 49.49 KiB | 75 KiB |
| First contentful paint | 468 ms | 1,500 ms |
| Controls ready | 577 ms | 2,000 ms |
| Offline saved-rate restore, p95 of five loads | 77 ms | 500 ms |
| Input handler, eight currencies, p95 of 20 edits | 0.8 ms | 50 ms |
| Input handler, all 166 codes, p95 of 20 edits | 4.2 ms | 100 ms |
| Picker first opening | 28.8 ms | 100 ms |
| Picker reopening, p95 of ten opens | 18.9 ms | 100 ms |
| Search handler, p95 | 2.3 ms | 100 ms |
| Cold-load layout shift | 0.00027 | 0.05 |

No long tasks were observed during the full-list input sample. Handler measurements include calculations and DOM writes; they are not field INP measurements. The first-load shell reserves card space to avoid shifting the footer when JavaScript starts.

The same-machine sample before the review fixes measured 1.4 ms for the default input handler, 5.1 ms for all 166 codes, and 34.8 ms for first picker opening. The final sample is shown above. These short samples have normal run-to-run variance; they do not establish a fixed percentage improvement. The DOM regression test separately confirms that valid typing no longer writes unchanged card attributes.

Run `npm run test:performance` after a production build to repeat these checks. JSON measurements and phone/desktop screenshots are saved in `test-results/`. The phone list, full desktop list, and currency picker were also inspected visually.

## Live data check

`npm run test:live` passed at 2026-09-26 15:48:53 UTC. Both Frankfurter endpoints returned HTTP 200 with CORS `*`. The catalog contained 166 codes; the normalized table contained 166 rates including the USD identity. All eight default currencies were covered. Rate dates ranged from 24 to 26 September 2026.

The check sends only catalog and general USD-table requests, with no amount. It validates response headers from Node; final-domain browser access is a separate release check. Live data checks are deliberately outside the deterministic test suite.

## GitHub Pages verification

The initial **Check** and **Deploy GitHub Pages** runs passed for `0b93e65`. Pages was already enabled with GitHub Actions as its source; no API enablement was performed. The public site is [poltak.github.io/fex](https://poltak.github.io/fex/). Later pushes publish through the same checked workflow.

Commit `a54c27d` combined those workflows. GitHub started exactly one **Check and deploy** run, and its check, Pages build, and deployment jobs passed. Pull requests now run checks only. Main publication waits for the single check job, and full main workflow runs are serialized.

The public HTML, manifest, and worker returned HTTP 200 with the expected content types. The manifest uses `/fex/` for its ID, start URL, and scope. The HTML includes the static CSP. GitHub serves these files with a 600-second cache lifetime; registration uses `updateViaCache: 'none'`.

In the live browser, USD 100 produced VND 2,594,300 and EUR 87.73 with the displayed reference rates. The picker showed 166 entries and found JPY by code. The source was restored to USD 10 after this check. These are functional observations of that published data snapshot, not guaranteed transaction prices.

## Release checks still required

- Install and launch on physical Android Chrome and iPhone Safari, including offline launch and mobile decimal keyboards.
- Check installation and offline launch on the public site, and repeat domain checks if a custom domain is added.
- Review applicable provider terms and credits before public deployment.

The repository includes one **Check and deploy** workflow. Deployment requires successful checks and Pages enabled with GitHub Actions as its source. Disabled Pages produces a successful build with deployment skipped; no workflow enables it through the API. Workflow results must be read from GitHub after a push; a local pass is not a CI pass. The custom domain remains undecided.
