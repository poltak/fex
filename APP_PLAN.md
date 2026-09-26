**Fex will be a public currency converter that works as a website and an installed PWA.**

This is the accepted implementation plan, prepared on 26 September 2026. The user approved the name Fex and decimal.js-light, authorized implementation and local Git commits, and deferred the domain choice until deployment. The initial project folder was empty. The user later authorized GPT-6 Sol sub-agents for bounded work, with the primary agent responsible for review and final validation.

The main product decisions are set: use plain HTML, CSS, and JavaScript; make startup and interaction speed release requirements; use Frankfurter v2; require no account; show an editable list of currencies; support the full current currency catalog; save each visitor's choices on their device; and refresh rates automatically. The screenshot is the reference for the currency cards. Its top switches, profile control, charts, bottom navigation, and transfer controls are outside this design.

**The first version will have one main screen.**

| Area | Planned behavior |
| --- | --- |
| Header | Small app name, Add currency button, and a compact menu. |
| Currency list | One card per selected currency, in the order chosen by the user. |
| Card identity | Currency badge, ISO code such as VND, and currency name. The code remains visible even when space is limited. |
| Card amount | A large, right-aligned number field. Every card can become the source of the conversion. |
| Active card | A clear border and a small Source label. Color is not the only indicator. |
| Secondary information | A short unit-rate line on other cards. Detailed dates are available through the rate status. |
| Rate status | Source name, rate date or date range, and when the app last checked for updates. |
| Compact menu | Manage currencies, Install app when applicable, and About rates. |
| About rates | Explain reference rates, local storage, source dates, and the link to Frankfurter. Include required source credits. |

Use a dark background, rounded dark cards, large numbers, and generous spacing, as in the screenshot. Use one small accent color for focus and actions. Do not add a theme switch to the first version. Use a system font and tabular numerals so values align as they change.

On a phone, cards use the full available width with approximately 16 px side margins. On a desktop, keep the same single-column interaction in a centered container, with a maximum width of about 720 px. Use larger available space for clear labels, rather than a separate desktop dashboard. Support narrow screens from 320 px, landscape mode, and 200% text zoom.

Use local badge assets where a flag is appropriate. Use a currency or regional badge where a currency belongs to several countries. Currency codes and names must remain sufficient when an image is unavailable. Do not load flags from a third-party image service.

**The initial list will follow the screenshot, and users can change all of it.**

Start with VND, USD, EUR, SGD, AUD, THB, GBP, and IDR, in that order. Start with USD selected and an amount of 10. These are proposed defaults, not a restriction on the available currencies. Do not open the keyboard automatically on first load.

On later visits, restore the user's own list, order, source currency, and amount. Public access does not mean a shared list: each browser has its own saved state. There is no account or device-to-device sync.

**Entering an amount will update the other cards immediately.**

1. The user taps a card's number field. That currency becomes the source, and the card stays in its current position.
2. If the card was a result, use its existing unrounded converted value as the new source value. Selecting a card alone must not change the economic amount through display rounding.
3. The first focus can select the displayed text for quick replacement. Further taps allow normal cursor placement and editing.
4. On each valid input change, calculate the other amounts locally. There is no Convert button and no network request for typing.
5. Enter or the keyboard's Done action finishes editing. Tapping another amount changes the source. Tapping outside removes keyboard focus but keeps the source selection.
6. When fresh rates are applied, keep the source amount fixed and update the other amounts.

Keep the raw text being edited separate from its parsed decimal value. Do not insert thousands separators, move the cursor, or rewrite the text while the user types. Do not derive the next conversion from a rounded number shown in another card.

| Input condition | Required result |
| --- | --- |
| Valid positive amount | Update all available conversions immediately. |
| Zero | Show actual zero results with the normal currency precision. |
| Empty field | Keep it empty; show a dash in dependent cards. Empty is not zero. |
| Incomplete decimal while typing | Allow the draft; show dependent cards as unavailable until the value can be parsed. |
| Invalid paste | Explain the problem beside the field. Do not silently change the number or continue to show old results as if they match it. |
| Negative value | Show “Enter zero or a positive amount.” Negative amounts are outside the first version. |
| Very large input | Support up to 15 whole-number digits and 12 fractional digits for user-entered amounts. Reject longer input with a clear message. |
| Conversion smaller than the normal display unit | Show a less-than value, such as “<0.01”, or a useful expanded decimal. Do not show a nonzero result as zero. |

Use a text field with a decimal keyboard hint. Format inactive values with the browser's locale and the currency's usual minor units: for example, JPY and VND normally have no decimal places, while USD has two. Allow decimal input even for currencies whose usual display has no decimal places. Preserve the entered precision in the active field.

Parse the locale's decimal and grouping characters explicitly. Support common pasted spaces, including nonbreaking spaces, when they are valid grouping characters. Accept an alternative decimal point only when the value is unambiguous. Reject ambiguous mixed formats rather than guessing. Validate this with English, Vietnamese, German, and French number formats.

Keep full internal precision when a calculated card becomes the source. Its editable text can use a shorter presentation, but focus alone must not replace the internal amount with that presentation. A real edit makes the new text authoritative. Extremely small calculated source amounts must retain a meaningful nonzero representation.

Use adaptive precision for unit-rate lines. For example, a VND-to-USD rate must not become “1 VND = 0.0000 USD”, as it does in the reference image. Increase significant digits or use a larger source unit such as 1,000 VND. Use an approximation sign for displayed rates.

**The currency picker will use the complete current Frankfurter catalog.**

Fetch the catalog from [Frankfurter's currency endpoint](https://api.frankfurter.dev/v2/currencies). The live check for this plan returned 166 current currency and unit codes. This count is an observation, not a fixed product limit. Frankfurter also has archived codes, available through a separate scope. A current converter will use the default current catalog. [Catalog documentation](https://frankfurter.dev/currencies/)

“All currencies” in this app means all current codes available from Frankfurter. It does not mean every historical currency, cryptocurrency, or every currency that could exist outside the provider's coverage. Do not hard-code a short supported-currency list. Frankfurter's catalog includes some metals and other units; keep those available in a clearly named Other units group with their units shown.

On phones, Add currency opens a sheet or dialog that fits above the keyboard. On larger screens, use a centered dialog. Both use the same interaction:

- Put search at the top. Search by ISO code, currency name, and useful local aliases. Match without regard to case or accents; “dong” must find Vietnamese Đồng.
- Put exact code matches first. Sort remaining results by name.
- Show code, name, badge, and availability. Already-added currencies are marked and cannot be added twice.
- Allow selection of several currencies before pressing Add. Append them in selection order. Cancel leaves the list unchanged.
- Do not impose an arbitrary limit such as five or ten currencies. The maximum is the current catalog.
- Show a clear empty-search result and a button to clear the search.
- Keep catalog entries visible when a current rate is missing. Mark their rate as unavailable rather than pretending the currency is unsupported.
- When offline, use the saved catalog. A currency with a saved rate can be added and converted. A currency with no saved rate can be added, but its amount stays unavailable until a rate arrives.

Ship a small catalog fallback, obtained from the official endpoint during development, so a new visitor can still understand the interface when the metadata request fails. Record the fallback's source date. Prefer a validated, more recent saved or fetched catalog. Refresh metadata at most once per 24 hours during normal use. Do not infer that a code is obsolete simply because its latest data date is old.

**Users will be able to manage their main list without changing its values by accident.**

Manage currencies opens an edit mode with remove and move controls. Support drag reordering as a convenience, plus Move up and Move down buttons for keyboard and assistive-technology users. Save the order after a move. Do not require a long press or a swipe to discover these actions.

Removing a result leaves the source amount unchanged. If the source is removed, promote the next remaining currency with an available rate and preserve its exact converted value. If no remaining currency has a usable rate, preserve the list but clear the conversion and explain that rates are unavailable. Keep at least one card. Offer Undo after removal and restore the prior source and amount when Undo is used. Save changes immediately and do not move cards merely because another card becomes the source.

**The conversion engine will use one consistent table of rates.**

Fetch the latest full USD-based table from [Frankfurter's rates endpoint](https://api.frankfurter.dev/v2/rates?base=USD). The live check returned a positive rate for every current catalog code and permitted browser requests through CORS. This confirms the direct-browser approach is possible today; it is not a service-availability guarantee.

Use these two API requests for the normal app:

| Data | Request | Purpose |
| --- | --- | --- |
| Current catalog | GET /v2/currencies | Names, codes, symbols, and the selectable list. |
| Latest rates | GET /v2/rates?base=USD | A full table for all conversions, including currencies added later. |

USD is only the internal common base. The user can choose any available currency as the source without making another request. Each conversion uses:

**Target amount = source amount × USD-to-target rate ÷ USD-to-source rate.**

Treat USD-to-USD as 1. Use decimal arithmetic with 40 significant digits internally and round only for presentation. This gives enough precision for this reference-rate converter and avoids common binary floating-point display errors. It does not make the provider's underlying rates more accurate.

Frankfurter blends reference data from official sources. A cross-rate calculated from one USD table can differ slightly from a separately requested direct pair because of source selection, dates, and rounding. Use the consistent USD table throughout one calculation; do not combine separate direct-pair responses opportunistically. [API behavior and source details](https://frankfurter.dev/)

Normalize and validate all incoming data before it reaches the UI. Require the expected base, a valid code, a valid calendar date, and a finite positive rate. Reject duplicate quote entries with conflicting values. Ignore unknown metadata fields so additions to the API do not break the app. Keep the last valid table if a response is empty or structurally invalid.

If a valid response is missing a target rate, show that card as unavailable. Never use zero or a one-to-one rate as a substitute. If the new response lacks the current source rate, keep the prior usable table for the active conversion and report the refresh problem. If there is no usable prior table, allow the user to select an available source. Do not silently fill a new table with arbitrary values from older tables.

The rate-data adapter will be separate from the conversion functions. This lets the endpoint or response handling change later without rewriting the interface. The first version will use Frankfurter only; an automatic switch to another rate provider would change the meaning and dates of the results and is not part of this plan.

**Rate refresh will be automatic and will follow the agreed one-hour rule.**

| Event | Action |
| --- | --- |
| First visit with no saved rates | Fetch immediately and show a clear loading state. |
| Open with saved rates | Show saved values immediately. Fetch in the background if the last successful check is at least one hour old. |
| Return from another app or browser tab | Apply the same one-hour check. Coalesce overlapping focus and visibility events. |
| App remains visible for more than one hour | Check once when due, so a screen left open can receive new data. |
| Type, select another source, add a card, or reorder | Use the loaded table. Do not fetch rates for these actions. |
| Connection returns | Retry a due or previously failed request, subject to the retry delay. |
| App is hidden or closed | Do not poll. Do not promise background updates from the operating system. |

Use one request in progress at a time. Set a request timeout of about 10 seconds. Prevent an older response from replacing a newer table. A successful response with unchanged rate dates still counts as a successful check; otherwise the app would keep requesting data that has not changed.

Use a failure retry delay of 1 minute, then 5 minutes, then 15 minutes, then up to one hour, while the app is visible and online. For HTTP 429, honor Retry-After when provided; use a conservative 15-minute delay when it is absent. Reset the failure sequence after a successful response. Network events are hints; the actual request result determines whether the refresh worked.

There will be no normal refresh button or pull-to-refresh feature. A failed first load can show Retry. A persistent refresh error can also offer Retry, while still respecting a provider-imposed retry delay.

If rates arrive during an amount-editing session, validate and save them, then queue their application until the user finishes that edit. This prevents values from changing under the user's cursor. Apply the newest pending table after the edit ends, preserve the latest source amount, and show a brief status message if the results change. Keep the displayed table's dates separate from the saved pending table's dates until application is complete.

**The app will distinguish a successful check from the age of the actual data.**

Frankfurter returns a date per rate. In the live check for this plan, the full table contained dates from 24 to 26 September, and VND had a different date from several other currencies. Do not assign one invented date to the whole table.

- Keep the provider date for every rate and a separate timestamp for the last successful check.
- For a conversion between two non-USD currencies, retain the dates of both rates used in the cross-rate. The older date is the conservative age of that result.
- Summarize the dates used by the visible list, for example “Rate dates: 25–26 Sep”. For one date, show that date.
- In the rate details, show both source and target dates when they differ. For USD, use the date of the other leg; the identity rate of 1 has no independent publication date.
- Show “Checked 5 minutes ago” separately. A failed attempt does not advance the last successful-check timestamp.
- A weekend or holiday is not automatically an error. Always show the dates. As a product rule, give a stronger old-data notice when a rate used in a visible conversion is more than seven calendar days old.
- Compute data age from UTC calendar dates, not by converting a date-only value to local midnight and accidentally moving it to the previous day.

About rates will state that these are reference estimates and can differ from bank, card, or cash-exchange prices. Link to the data source and its terms. Review the applicable provider attribution requirements before public release. Frankfurter permits commercial use of its API, but the underlying providers' data terms still apply. [Frankfurter terms](https://frankfurter.dev/license/)

**Offline use will keep the converter useful after an online visit.**

The PWA will save the app shell and the last usable rate table. With those saved, opening it offline will show the user's list and allow local conversion, adding currencies with known rates, removing cards, and reordering. Show “Offline — using saved rates” and the actual data dates. Do not present saved values as a live feed.

Offline support requires a prior successful load of the app assets and rates. If the shell is available but no rates are saved, show the interface with “Connect once to load rates”. If the app has never been loaded, a normal website cannot be expected to open offline. Browser data removal or storage eviction can also remove saved content. [Offline PWA behavior](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

**Local storage will hold a small, versioned app state.**

Use localStorage only for the small preferences record. Keep the catalog and rate snapshots in native IndexedDB, which has an asynchronous API. Use the service worker's Cache Storage for static app files. Read the saved catalog and rates asynchronously after drawing the HTML shell. This keeps larger serialization and storage work off the input path. localStorage is synchronous, so even its small writes must be scheduled away from active typing. [Browser storage behavior](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)

This design needs no server database or client database package. Use a small native IndexedDB adapter with explicit error handling. If restoring saved data and receiving network data overlap, a late storage read must not overwrite a newer validated network response.

| Record | Contents |
| --- | --- |
| Preferences | Schema version, ordered currency codes, selected source, and saved amount or empty draft. |
| Rate snapshot | Base currency, decimal rate values, each rate's date, response receipt time, and last successful-check time. |
| Catalog | Codes, names, symbols, catalog receipt time, and whether it came from the bundled fallback. |
| Temporary UI state | Search text, open dialog, cursor position, and validation messages remain in memory. |

Use fex:v1:preferences for the small localStorage record and a versioned fex IndexedDB database with separate rate and catalog records. Validate records on read. Keep all active calculation data in memory. Schedule preference saves after the visible change; debounce amount saves by roughly 250 ms and flush the small record on blur or pagehide. Do not write storage or serialize the full rate table in an input handler. Persist decimal values as strings. Do not save only formatted display text.

If storage is blocked, full, or corrupted, keep the app usable in memory and show a small notice that changes may not be saved. Recover from invalid records without deleting unrelated site storage. Version the format and add explicit migrations when it changes.

The app will not send amounts or personal currency lists to the server. API calls request the generic USD table and catalog. The hosting provider and API still receive normal network request metadata. Do not add analytics, advertising scripts, or third-party fonts in the first version.

Preferences are local to the site origin and browser. They do not automatically move from a preview domain to the production domain, to another device, or to an installation made in another browser. Do not promise such a transfer. For two tabs on the same origin, use storage events for preference changes and BroadcastChannel, when supported, to announce a newer saved rate snapshot. A receiving tab can read that snapshot asynchronously. Without BroadcastChannel, recheck saved data when the tab becomes visible. Apply cross-tab changes when idle; do not overwrite an active amount edit. Close old IndexedDB connections on a version change so an update does not block indefinitely.

**Installation will be optional, and the website will remain fully usable.**

Provide a web app manifest with a stable app ID, name, short name, start URL, scope, description, standalone display mode, and colors. Include regular and maskable icons at 192 and 512 pixels, an Apple touch icon, and a favicon. Verify the maskable safe area. Serve the production site over HTTPS. [Install requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) and [icon guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons)

Show Install app in the menu when the browser provides an install event. Only trigger the browser prompt after the user selects it. On iOS, provide concise Add to Home Screen instructions. Hide installation guidance in standalone mode and do not show repeated promotional banners. Installation controls vary by browser, so use feature detection. The converter must also work in browsers that cannot install it.

Use a generated, versioned service worker through vite-plugin-pwa. Precache the HTML shell, compiled scripts, styles, icons, and local badges. Use the application's own rate-storage policy for the API; do not place a second opaque API cache in the service worker that could make old responses look newly fetched.

An app-code update and a rate update are separate events. When a new app version is ready, show “Update available” with Update and Later. Save the draft before an accepted reload. Do not force a reload while the user types. Remove obsolete app caches after the new version activates, while keeping user preferences and rate data. Use backward-compatible storage migrations so an older open tab does not corrupt state. [PWA update behavior](https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors)

**The app will use plain HTML, CSS, and JavaScript with no UI framework.**

This screen has a small and well-defined state model. Native elements and focused DOM updates are a suitable fit. Use semantic HTML, ordinary inputs and buttons, native dialog elements, HTML templates for repeated cards, and JavaScript ES modules. Keep the source as JavaScript; use JSDoc types and development-time checking to catch errors without requiring TypeScript application files.

| Layer | Proposed choice | Reason |
| --- | --- | --- |
| UI | Semantic HTML, CSS, and plain JavaScript modules | Small startup code and direct control of DOM updates. |
| Build | Vite with its vanilla JavaScript setup | Bundles and minifies production files; adds no UI framework runtime. |
| Styles | Plain CSS with design variables | Enough for the reference screen without a component framework. |
| Arithmetic | decimal.js-light | Decimal calculations with controlled precision and display rounding. |
| HTTP | Browser fetch and AbortController | No HTTP client package or secret API key needed. |
| Storage | Small localStorage preferences, native IndexedDB, and Cache Storage | Keep rate storage asynchronous and static app assets available offline. |
| PWA build | vite-plugin-pwa / Workbox | Asset precaching and a controlled update lifecycle. |
| Unit and UI tests | Vitest, a DOM test environment, and DOM Testing Library if useful | Verify domain functions and native-element interaction. |
| Browser tests | Playwright | Exercise mobile layouts, storage, errors, and service-worker behavior. |
| Hosting | Cloudflare Pages | Public HTTPS, custom domains, preview deployments, and static hosting. |

The only proposed production dependency is decimal.js-light for decimal arithmetic. It is not installed by this plan. Obtain confirmation before installing it, as required by the workspace rules. There will be no React, react-dom, virtual DOM, hydration step, UI component package, client router, or global state package. Build, PWA generation, type-check tooling, and tests are development dependencies. Account for generated service-worker code in the asset budget even though its generator is a development tool. Use npm and commit the lockfile when implementation work is authorized. Select compatible current stable versions at that point.

Vite is only the development and build tool. The published result is static HTML, CSS, JavaScript, and PWA assets. It can be served from a compatible static host. [Vite production builds](https://vite.dev/guide/build)

Keep currency parsing, calculations, formatting, response validation, refresh policy, and storage independent of DOM code. Use a single object argument for functions that need several inputs. There is no need for a backend framework, API proxy, scheduled server job, authentication provider, or server database in this first version.

Keep one explicit state object and small action functions for edits, source changes, list changes, and rate updates. Each action updates the affected native elements. Keep a map from currency code to its existing card and input nodes. Create or remove a card only when the list changes; move the existing node when its order changes. Use textContent for API-provided labels. Do not build HTML strings from remote names.

For an amount edit, parse the source once, prepare the common-base value once, and update only the dependent amount fields that have changed. Leave the active input node and its text alone. Unit-rate labels do not need recalculation on every keystroke because the rates and source currency have not changed. Cache decimal rate objects, number formatters, and normalized search text. Batch DOM writes without interleaving layout reads. Coalesce additional visual work in the next animation frame when needed; do not debounce the user's visible input response.

| Planned area | Responsibility |
| --- | --- |
| index.html | Visible app shell, semantic controls, loading state, card template, and dialog structure. |
| src/app | Plain JavaScript state, actions, source selection, and lifecycle coordination. |
| src/ui | Small DOM modules for cards, picker, list management, rate status, install help, and update notice. |
| src/domain | Amount parser, decimal conversion, formatting, and data models. |
| src/data | Frankfurter adapter, validation, catalog fallback, and refresh coordinator. |
| src/storage | Versioned records, migrations, and cross-tab handling. |
| src/pwa | Registration, install detection, and app-update handling. |
| public | Icons, badges, static metadata, and hosting headers. |
| tests | Unit, component, browser, and offline/update fixtures. |
| Project documents | Setup, deployment, source terms, and maintenance instructions. |

Expose clear npm scripts for development, build, JSDoc/JavaScript type checks, lint, unit tests, browser tests, and performance checks. Provide one combined check command for the complete release gate. Run browser and performance tests against the production build; a development server alone is not sufficient.

**Accessibility and mobile behavior are release requirements.**

- Give every input a label that includes the currency name and code. Expose which currency is the source.
- Keep focus visible. Use at least 44 by 44 CSS-pixel touch targets and input text large enough to avoid unwanted mobile zoom.
- Use a real dialog pattern for the picker: focus stays inside while open, Escape closes it, and focus returns to the trigger. A screen reader must be able to search and add currencies.
- Provide keyboard alternatives for list reordering and removal. Keep DOM order and visual order consistent.
- Announce errors and completed refreshes politely. Do not announce every changed result on each keystroke.
- Maintain readable contrast and respect reduced-motion preferences. Do not rely on animation to explain a change.
- Account for display cutouts, bottom safe areas, browser bars, and the virtual keyboard. The current amount and dialog actions must stay reachable.
- Keep long currency names and large values inside their cards. Permit horizontal scrolling within a focused long number field rather than shrinking it to unreadable text.

**The site can use a custom domain without changing the existing website.**

The recommended first deployment is a dedicated subdomain such as a user-chosen currency-app subdomain. The existing main website can link to it. A standalone custom domain also works. The final hostname remains a launch choice; do not assume ownership of any example domain.

Cloudflare Pages currently serves static asset requests for free without a request-count charge. The free plan has other platform limits, such as build limits. This app does not require Pages Functions or a paid exchange-rate plan. Domain registration or renewal remains a separate cost if a new domain is needed. [Static hosting pricing](https://developers.cloudflare.com/pages/functions/pricing/) and [platform limits](https://developers.cloudflare.com/pages/platform/limits/)

For the selected domain, create the Pages project, deploy the tested build, add the domain through Pages, and then configure DNS. A subdomain can use a CNAME at an external DNS provider. An apex domain on Pages requires the corresponding Cloudflare zone and nameserver setup. Do not change nameservers as an incidental step or disturb existing site and mail records. [Custom-domain setup](https://developers.cloudflare.com/pages/configuration/custom-domains/)

If the preferred address is instead a path on the existing site, such as /fex/, inspect that site's hosting first. The asset base, manifest ID, start URL, navigation fallback, and service-worker scope must all use that path. The service worker must not control or clear caches for the rest of the site. This is an alternative deployment layout, not an automatic change to the current website.

Configure a canonical production URL, page title, description, social-preview metadata, and appropriate preview noindex behavior. Keep HTTPS and certificates valid. Use restrictive security headers compatible with the app, including a content security policy that permits requests to Frankfurter and locally served assets. Avoid caching the service-worker script as an immutable asset; use hashed filenames for immutable compiled assets. Test the actual deployed headers.

Create a Git repository when implementation is approved. Keep work in reviewable commits. Configure CI to run checks, create a preview build, and deploy production only after the release gate passes. Keep the prior production deployment available for rollback. Verify any rollback against an already-installed PWA as well as a new browser session, because the service worker can otherwise keep the previous app version active.

**Tests will cover the behavior that can make a converter wrong or difficult to use.**

| Test group | Required evidence |
| --- | --- |
| Conversion | Identity conversion, known cross-rates, every supported rate in a fixture, source switching, repeated switching without display-rounding drift, and preservation of the entered source amount on refresh. |
| Precision | Zero, large values, tiny nonzero values, different currency minor units, display thresholds, and decimal rounding. |
| Input | Empty and incomplete drafts, invalid paste, locale separators, allowed limits, cursor preservation, and keyboard actions. |
| Currency list | Search by code and name, accent-insensitive matches, multi-add order, duplicates, add-all performance, removal of the source, Undo, and keyboard reorder. |
| API handling | Valid data, malformed data, conflicting duplicates, missing rates, empty responses, timeouts, network failures, HTTP 429, and out-of-order responses. |
| Refresh | Fake-clock tests before and after one hour, one request for overlapping lifecycle events, hidden-tab behavior, retry delays, unchanged rate dates, and pending updates during editing. |
| Dates | Mixed per-currency dates, a USD identity leg, local timezone boundaries, weekend data, and the seven-day notice. |
| Persistence | Reload restoration, corrupt records, blocked localStorage/IndexedDB, asynchronous restore races, schema migration, a second tab, and no overwrite of an active edit. |
| Offline | Online load followed by a real offline reopen, offline conversions, adding a cached currency, unavailable rates, and reconnection. |
| PWA | Manifest and icon validity, correct scope, standalone layout, service-worker activation, code update during a draft, and rollback behavior. |
| Accessibility | Keyboard use, dialog focus, readable labels, contrast, zoom, reduced motion, and meaningful status announcements. |
| Layout | 320 px and common phone widths, wide desktop, landscape, long names, large numbers, and an open virtual keyboard. |

Use deterministic recorded fixtures for normal tests. Do not make the whole test suite depend on current market values or an external API being online. Run a separate live smoke check before release that verifies current schema, positive rates, CORS, and coverage for the initial list.

Use Playwright for Chromium, Firefox, and WebKit browser behavior. Confirm installation, keyboard layout, offline launch, and app updates on an actual Android Chrome device and an actual iPhone when available. Emulated mobile browsers and Playwright WebKit are useful checks, but do not constitute proof of an installed iOS or Android PWA. State which device checks remain unverified if devices are unavailable.

**Startup and interaction speed will have explicit budgets and measurements.**

These are implementation targets, not measurements of an app that already exists. Check them on the production build and record the device, browser, CPU setting, network profile, selected-currency count, and cold or warm cache state. Use a repeatable mobile lab profile for CI trends and a representative physical phone for actual interaction results. Keep external API latency separate from app rendering time.

| Measure | Initial release target |
| --- | --- |
| Initial page JavaScript | At most 25 KiB gzip, including decimal arithmetic and install/update registration code. |
| Initial app-owned resources | At most 75 KiB compressed for the first screen, excluding rate/catalog API responses and later installation icons. Count fallback catalog data in this budget. |
| Cold first visible shell | Within 1.5 seconds on the agreed mobile test profile. The shell must not wait for the rate API. |
| Cold controls ready | Within 2 seconds on that profile. A first-time rate request may still be pending and must say so. |
| Repeat open with saved assets and rates | Useful converter within 500 ms on the representative phone, without waiting for network refresh. |
| Typing and dependent-value update | 95th percentile under 50 ms with the default eight cards. Aim for the next display frame in ordinary use. |
| Open picker, search, and change source | Visible response within 100 ms at the 95th percentile. No first-use network requirement for the picker. |
| Full-catalog list | Input response under 100 ms at the 95th percentile, with no repeated main-thread task over 50 ms. |
| Layout stability | No unexpected shift when rates, badges, or status messages arrive; target CLS at or below 0.05 in the test flow. |

Draw the app shell from HTML immediately. Read the tiny preferences record once, restore saved rates asynchronously, and start any due network work independently. The currency list must not wait for catalog refresh, installation checks, or remote fonts. Reserve badge and status space so loading does not shift controls.

Keep the main picker controls and search code in the small initial bundle so the first tap is fast. Load saved metadata asynchronously and use the bundled fallback when needed. Defer nonessential icon downloads and service-worker registration until after the first screen can render. Use system fonts, small local SVG badges, and short opacity or transform transitions. Avoid large blur effects and unnecessary background animation.

Use cache-first delivery for a versioned, already-installed app shell, with a separate check for code updates. The rate refresh remains independent. Reopening the PWA must not wait for a service-worker network timeout before showing cached HTML.

For the full-catalog case, first measure the simple implementation. Reuse row nodes and skip writes when text is unchanged. If the long list exceeds the budget, calculate from one immutable source value and schedule off-screen row formatting in bounded batches; mark rows dirty and bring them current before they become visible. Preserve accessibility, keyboard navigation, and calculation consistency. Add virtualization only if measured results require it, and do not add a production package without confirmation.

Add build-size checks to CI. Use browser performance marks around restoration, amount edits, picker opening, and filtering. Capture repeated runs and inspect long tasks, layout work, and memory after repeated dialog use. Browser tests must also prove that typing does not fetch, write a full snapshot to storage, replace the focused input, or rebuild the whole list. A Lighthouse score is useful supporting evidence, not a substitute for measured typing, picker, and warm-open behavior.

**Implementation will proceed in six reviewable stages.**

| Stage | Work | Completion check |
| --- | --- | --- |
| 1. Project and domain logic | Create the vanilla JavaScript project, confirm the decimal-arithmetic dependency, set up JSDoc checks/build/tests, and implement parsing, conversion, and formatting. | Deterministic calculation and input tests pass; the initial bundle budget is in CI. |
| 2. Main screen | Build the reference-style HTML cards, direct DOM updates, source selection, and responsive layout. | All initial rows work with fixtures; typing and focus stay stable; interaction timing is measured. |
| 3. Full catalog and local state | Add search, multi-add, management, saved preferences, and recovery from bad storage. | A user can build and restore any supported list; no duplicates or rounding drift. |
| 4. Live rates | Add the Frankfurter adapter, rate dates, automatic refresh, retries, missing-data states, and editing-safe refresh application. | Live smoke check and deterministic failure/lifecycle tests pass. |
| 5. PWA, accessibility, and performance | Add manifest, icons, offline assets, update handling, install help, and keyboard/screen-reader refinements; tune startup and interaction paths. | Production-build offline, update, size, and timing gates pass; device checks are recorded. |
| 6. Public release | Deploy a preview, complete browser/device review, connect the chosen domain, verify headers and source credits, then publish. | Public HTTPS works with no login; live, saved, and installed behavior is checked on the final hostname. |

The finished handoff will include the source code, lockfile, tests, build and release scripts, icons, PWA configuration, setup instructions, deployment instructions, source-credit notes, and a short record of what was verified locally, in CI, on devices, and on the live domain. No sub-agents are required for this work.

**The app is ready for release only when the complete user flow works.**

A new visitor must be able to open the public URL, see the initial list, edit any amount, search the full current catalog, add and arrange currencies, and return later to the same saved list. With saved data, the same conversions must work offline. A one-hour-due refresh must update results without changing the source amount or interrupting input. Every visible result must use a valid rate and an honest date. Installation must preserve the simple screen and use the correct domain and scope. The measured production build must meet the startup, interaction, and asset-size budgets, or the remaining gap must be resolved before release.

The proposed defaults allow development to proceed without another product interview. Before installation, confirm the proposed decimal-arithmetic dependency. Before public deployment, settle the final app name, icon, domain, and hosting account. The first version does not include accounts, transfers, charts, historical-date selection, rate alerts, fees or spread adjustment, cryptocurrency feeds, advertising, or cloud sync. Those features can be evaluated separately if they become useful.
