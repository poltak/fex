# Deployment and release

Fex builds to static files. It needs no server, database service, Pages Functions, API secret, or account login. The intended public site must remain accessible without authentication. The repository includes GitHub Pages deployment setup. Enabling Pages remains a manual repository setting; this guide does not change DNS or enable it through the API.

## GitHub Pages for poltak/fex

GitHub Pages can serve this public repository on GitHub Free; no paid host is needed. The default project URL is `https://poltak.github.io/fex/`. See the official [Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

After the workflow is on `main`:

1. Open [poltak/fex Pages settings](https://github.com/poltak/fex/settings/pages).
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions → Check and deploy → Run workflow**. Select `main` and run it once.
4. Open the deployment URL from the completed run. Later pushes to `main` run the workflow automatically.

The **Check and deploy** workflow runs on pull requests, pushes to `main`, and manual runs. A manual run on `main` can deploy. A manual run on another branch runs checks only. It does not read Pages settings, configure Pages, upload a Pages artifact, or deploy. Pull requests run checks only.

The full check runs once per workflow run. Its browser tests use the root path. A run on `main` then reads Pages settings with the repository token. If the API returns HTTP 404, or Pages uses a source other than GitHub Actions, the job summary explains the setup steps. The workflow builds for `/fex/`, then skips Pages configuration, artifact upload, and deployment. Other API errors fail the job. The workflow never enables Pages through the API.

Once Pages is enabled, `configure-pages` supplies the deployment base path. The workflow makes a separate build for that path, checks its size, uploads the static artifact, and deploys it with the `github-pages` environment. This build does not run the test suite again. The path can change if a custom domain is configured later. It is not fixed to `/fex/` for enabled deployments.

GitHub Pages does not apply Cloudflare's `_headers` file. The production build also puts the supported CSP directives in HTML, so they work on GitHub Pages. The `/fex/` browser tests verify that this policy blocks inline scripts without HTTP security headers. HTML cannot enforce `frame-ancestors` or add the other response headers; check the actual deployed headers if those controls are required. A host with custom header support can apply the complete supplied policy.

No personal access token or Cloudflare secret is required; the workflow uses GitHub's job token and deployment identity token. The site is not confirmed live merely because these files exist. Confirm the successful workflow result and check the actual public URL after enabling Pages.

## Build for the correct path

For a site at the domain root, such as `https://example.com/`:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

The default `FEX_BASE_PATH` is `/`. The build output is `dist/`.

For a site at `https://example.com/fex/`:

```sh
FEX_BASE_PATH=/fex/ pnpm run build
pnpm run check:size
FEX_BASE_PATH=/fex/ pnpm run preview
```

Open `http://127.0.0.1:4173/fex/` for that preview. The base setting controls asset URLs, manifest ID, start URL, manifest scope, and service worker registration scope. The host must serve the contents of `dist/` at `/fex/`; setting the environment variable does not move files into a `fex` directory. On a host that serves a publication directory at `/`, place the built files under its `fex/` directory. For Cloudflare Pages, keep `_headers` at the publication root so Pages reads it. The file contains asset cache rules for both `/assets/` and `/fex/assets/`.

The regular app behavior tests target the root path. The PWA suite runs separate root and `/fex/` cases for offline reopening and accepting a code update without losing a draft; these cases are included in `pnpm run test:browser`. Check the intended hosted subpath before release as well. Return to a root build after a manual subpath build before running the regular app tests. The full check also runs a dedicated Chromium performance suite after the behavior tests; repeat it with `pnpm run test:performance`. These browser checks do not establish physical installation behavior.

`FEX_BUILD_ID` can identify a release. If it is not set, the build uses its timestamp. Use a new ID for each new deployment, including a rebuild of older source. Do not publish a build made for one base path under another path.

## Cloudflare Pages option

Cloudflare Pages has a Free plan with limits suitable for a small static site. This app uses no Pages Functions. Review the current [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) and the account's plan before choosing it.

Choose the hosting account and project name before creating a project. A custom domain is optional during preview checks.

For a local repository without a Git remote, [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) can publish the built static files through the dashboard or Wrangler. Select the validated `dist/` directory for a root deployment. Do not upload the repository, `node_modules`, or source configuration as the publication directory. A Direct Upload project cannot later switch to Git integration; that requires a new project.

For Cloudflare Git integration, connect the intended remote. Use build command `pnpm run build`, output directory `dist`, and a Node version that satisfies `package.json`. Run the full check before promotion. The included Pages workflow deploys only to GitHub Pages; it contains no Cloudflare credentials or Cloudflare deployment step. Cloudflare is an optional alternative to the GitHub Pages setup above.

Do not put Cloudflare Access or another login in front of the final public app. Keep `public/_headers` in the build output. Verify the deployed content security policy, asset cache rules, HTTPS, service worker JavaScript MIME type, and manifest MIME type. `index.html`, `sw.js`, and other mutable files must revalidate; hashed files under `assets/` can have long cache lifetimes.

## Cloudflare custom-domain option

Follow the current [Pages custom-domain instructions](https://developers.cloudflare.com/pages/configuration/custom-domains/). Add the domain to the Pages project's Custom domains list before changing DNS. For a subdomain with external DNS, add the requested CNAME to the project's `pages.dev` hostname. An apex domain requires the Cloudflare zone and nameserver setup described in those instructions. Wait for domain and certificate activation, then check the final HTTPS URL.

DNS changes are a separate action. Confirm the final hostname and the existing DNS records before making them. Changing the hostname creates a different browser origin, so saved amounts, lists, and app installations do not move with the domain.

## Release checks

Keep a record of the commit, build ID, base path, checks, and deployment URL. Before public release:

1. Run the complete local check and review the corresponding CI result after a remote is configured.
2. Run `node scripts/smoke-live.mjs` to check the live API schema, positive rates, current catalog, CORS headers, and initial currency list. Set `FEX_SMOKE_ORIGIN` to the intended origin if needed. Keep this live check separate from deterministic tests and also check actual API access in the deployed browser.
3. Open the deployed site in a fresh browser context. Test conversion, the picker, list changes, reload, and saved choices without an account.
4. Load online, close the app, disable networking, and reopen it. Check saved conversions and missing-rate behavior. Then reconnect and check refresh.
5. Check the selected base path, manifest, icon URLs, headers, and worker scope. Confirm that unrelated paths are not taken over by the worker.
6. Install on physical Android Chrome and iPhone Safari. Check the keyboard, small screens, standalone mode, offline restart, and update acceptance with a draft.
7. Record startup and input timing on the target phone. Passing a compressed-size gate alone does not establish the timing targets in `APP_PLAN.md`.
8. Complete the provider terms and attribution review in [Data sources](DATA_SOURCES.md).

Physical device checks and checks on the final public domain are pending. Record actual results when those environments are available; do not infer them from browser emulation.

## Updates and rollback

The worker caches app-owned build assets. Rates and the currency catalog use IndexedDB independently. A code update waits until the user accepts it. The app saves its current preferences and raw incomplete or invalid draft before sending `FEX_ACCEPT_UPDATE`; the page reloads when the accepted worker takes control. Test this with `123.` and an invalid paste, not only a valid amount.

Retain the previous deployment and its source revision. To roll back, restore the previous deployment through the host, or rebuild the previous source with a new build ID and the same base path. Do not clear visitors' browser storage as a routine rollback step. If a release changes storage schemas, check compatibility before selecting an older build.

A server rollback does not prove that existing installations run the restored code. Check a fresh browser and an app with the newer worker already installed. Let it find the restored worker, accept the update, and confirm its build, saved preferences, raw draft, rates, and offline restart. Existing open tabs may still need old hashed assets; the worker retains old scoped caches while scoped windows are open. Do not remove older assets or caches until the update path has been checked.
