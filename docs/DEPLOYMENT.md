# Deployment and release

Fex builds to static files in `dist/`. It needs no server, database, API secret, or login.

## GitHub Pages

The site is at <https://poltak.github.io/fex/>. The Check and deploy workflow publishes it.

| Event | Result |
| --- | --- |
| A pull request | The workflow runs the full check. |
| A push to `main`, or a manual run on `main` | The workflow runs the full check, builds for the Pages path, and deploys. |
| A manual run on another branch | The workflow runs the full check. |

The full check runs once per workflow run, on the root path. The Pages build does not run the tests again. It checks the size limits and uses the base path from `configure-pages`, so a custom domain needs no workflow change.

The workflow does not enable Pages. If Pages is off, or its source is not GitHub Actions, the run builds for `/fex/`, explains the setting in its summary, and skips deployment. To enable Pages:

1. Open [the Pages settings](https://github.com/poltak/fex/settings/pages).
2. Set Source to GitHub Actions.
3. In the Actions tab, select Check and deploy, select Run workflow, and run it on `main`.

The workflow uses GitHub's job token and needs no personal access token.

GitHub Pages does not read `public/_headers`. The build puts the content security policy in a `meta` element, and the `/fex/` browser tests check that this policy blocks inline scripts. A `meta` element cannot set `frame-ancestors` or the other response headers. A host that reads `_headers` applies the full policy.

## Build for a path

For a site at the root of a domain, run:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

For a site at `https://example.com/fex/`, run:

```sh
FEX_BASE_PATH=/fex/ pnpm run build
pnpm run check:size
FEX_BASE_PATH=/fex/ pnpm run preview
```

The preview is at `http://127.0.0.1:4173/fex/`. `FEX_BASE_PATH` sets the asset addresses, the service worker scope, and the manifest's ID, start URL, and scope. It does not move the files, so the host must serve the contents of `dist/` at that path. Do not publish a build under a path other than its base path.

`FEX_BUILD_ID` names a build and defaults to the build time. The name of the service worker's cache contains it, so each deployment needs a new ID. That includes a rebuild of older source.

The usual browser tests use the root path. The PWA tests make their own builds for `/` and `/fex/`. After a manual `/fex/` build, make a root build before you run the browser tests.

## Other static hosts

Any host that serves static files over HTTPS can serve `dist/`. For [Cloudflare Pages](https://developers.cloudflare.com/pages/), use the build command `pnpm run build`, the output directory `dist`, and a Node version that `package.json` allows. Keep `public/_headers` in the output, because it sets the content security policy and the cache rules for `/assets/` and `/fex/assets/`. The host must revalidate `index.html` and `sw.js`. Files in `assets/` have a hash in their name and can have a long cache time.

Do not put a login in front of the site. A different hostname is a different browser origin, so saved lists and installed apps do not follow a domain change.

## Release checks

Record the commit, the build ID, the base path, and the address. Then:

1. Confirm that the workflow run for the commit passed.
2. Run `pnpm run test:live`.
3. Open the site in a new browser profile. Convert, add a currency, change the order, reload, and confirm that the list is the same.
4. Load the site, go offline, and open it again. Check the saved conversions. Reconnect and check that the app fetches new rates.
5. Check the manifest, the icon addresses, the response headers, and the worker scope. Confirm that the worker does not control other paths.
6. Install the app on a physical Android phone in Chrome and on an iPhone in Safari. Check the keyboard, a small screen, offline start, and an update with unfinished amount text.
7. Measure startup and typing on the phone. The size limits say nothing about timing.
8. Review the provider terms that [data sources](DATA_SOURCES.md) describes.

Nobody has done items 6 to 8 yet. [Verification](VERIFICATION.md) records the results of the others.

## Updates and rollback

A new version waits until the user accepts it. Before the app tells the worker to activate, it saves the preferences and the raw amount text, even when that text is incomplete or invalid. The page reloads when the new worker takes control. Test this with `123.` and with invalid text.

Rates, the catalog, and history are in IndexedDB, and an app update does not delete them.

To roll back, deploy the previous build again through the host, or build the previous source with a new build ID and the same base path. Do not clear browser storage as part of a rollback. If a release changed a storage format, confirm that the older build can read the data.

A rollback on the server does not change an app that already has the newer worker. Check a new browser profile. Then check a profile that has the newer worker. It must find the restored worker, show the update notice, and keep the preferences, amount text, and rates. Open tabs can still need old files, so the worker keeps old caches while a tab of the app is open.
