# Code review — 26 September 2026

The primary agent completed this review without subagents. The review covered all application modules, the HTML and CSS, storage and refresh behavior, service-worker lifecycle, tests, build scripts, and the Pages workflow. The focus was performance and maintenance.

## Findings and fixes

| Finding | Effect before the fix | Change |
| --- | --- | --- |
| Repeated picker construction | Every opening created all 166 controls again. A catalog update could remove the focused checkbox. | Moved picker code to `src/picker.js`. Reuse controls by currency code. Preserve focus, selection, and scroll during catalog changes. Cache the name comparator and use a Set for membership checks. |
| Repeated card writes | Each valid edit rewrote four unchanged attributes per card. | Update source, error, and accessibility state only when it changes. Amounts still update immediately. |
| Unbounded storage waits | A stalled IndexedDB open could prevent the first rate request. A stalled write could hold the refresh controller in flight. | Bound database opens and transactions to one second. Abort stalled transactions, close late connections, and retain the memory fallback. Use one transaction-completion helper. |
| Locale mismatch | Arabic, Persian, and Bengali amounts could contain local whole digits with Latin fractional digits. The parser rejected those displayed amounts. Indian grouping and Swiss separators also failed. | Cache locale digits and group sizes from Intl. Use the same digit system for display and parsing. Retain exact decimal strings and reject malformed groups. |
| Undo after a cross-tab change | Undo could restore the old amount after another tab had supplied a newer one. | Use one preference-application function and advance the revision for imported changes. Undo can restore a removed row without replacing newer values. |
| Future catalog timestamp | A saved timestamp after a clock change could prevent catalog refresh for days. | Use the same freshness check for hourly rates and daily catalogs, with a bounded clock tolerance. |

The five functional failure cases were reproduced before their fixes. New tests cover all listed behavior, including stalled reads and writes, late database connections, picker focus after a sort change, retained picker nodes, locale round trips, and cache clock tolerance. The browser locale fixture sets the requested numbering system explicitly: macOS WebKit exposes only `ar` through `navigator.language` even when Playwright requests `ar-EG-u-nu-arab`.

No production dependency was added. Decimal arithmetic, the rate API, the public URL, and the page layout remain the same.

## Validation

See [the verification record](VERIFICATION.md) for current test counts, performance samples, size limits, and remaining device checks. Tests use the production build. The Pages workflow runs the full check once before publication.

The review keeps the existing two WebKit offline-navigation skips visible. Those skips do not establish physical iPhone offline behavior. Handler timings are lab measurements; they are not field INP measurements.
