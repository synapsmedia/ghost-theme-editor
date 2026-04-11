# Ghost Codebase Analysis

Source reviewed: `Ghost` (Ghost 6.x / admin-x)

All file paths below are relative to that repo root unless otherwise noted.

---

## 1. `clientExtensions` config

### Config shape

```json
{
  "clientExtensions": {
    "script": {
      "src": "https://your-cdn.example.com/ghost-theme-editor.js",
      "container": "<div id=\"gte-root\"></div>"
    }
  }
}
```

- `src` — absolute or root-relative URL of the JS bundle.
- `container` — raw HTML string injected into the Admin DOM. Free-form; used as a mount point for the extension.

### Where it is defined (server)

- **`ghost/core/core/server/services/public-config/config.js:16`**
  ```js
  clientExtensions: config.get('clientExtensions') || {},
  ```
  The key is read straight from Ghost's config tree (`config.json` / `config.production.json` / env).

- **`ghost/core/core/server/api/endpoints/utils/serializers/output/config.js:15`**
  `'clientExtensions'` is in the allow-list of public config keys that get serialized out to the admin client.

### Where it is consumed (client)

- **`ghost/admin/app/controllers/application.js:58-66`**
  ```js
  get showScriptExtension() {
      const { session } = this;
      if (!session.isAuthenticated || !session.user) {
          return false;
      }
      return this.config.clientExtensions?.script;
  }
  ```
  Only rendered for **authenticated** users — the script will not load on the login screen.

- **`ghost/admin/app/templates/application.hbs:42-46`**
  ```hbs
  {{#if this.showScriptExtension}}
      {{{this.showScriptExtension.container}}}
      {{! template-lint-disable no-forbidden-elements }}
      <script src="{{this.showScriptExtension.src}}"></script>
  {{/if}}
  ```
  - `container` is emitted as raw HTML via triple-stache `{{{ }}}`.
  - `<script src="...">` is emitted immediately after. It is a plain, **deferred-by-position** external script — no `async`, no `defer`, no `type="module"`, no `nonce`, no `integrity`.

### Load order implications

- The script loads **after** the main Ember bundle has parsed and mounted the admin shell, but Ember routes and React admin-x islands load asynchronously after that. Any DOM-dependent work must use a `MutationObserver` — the theme list is rendered lazily inside admin-x.
- Since it's a plain `<script src>` (not a module) and the container is raw HTML, either an IIFE or a classic script works. **We ship an IIFE**.

---

## 2. Installed Themes UI

The "Installed themes" list is in **admin-x-settings**, not Ember:

- **`apps/admin-x-settings/src/components/settings/site/theme/advanced-theme-settings.tsx`**

Key structural details (lines ~169-207):

```tsx
<List pageTitle='Installed themes'>
  {themes.map((theme) => (
    <ListItem
      key={theme.name}
      action={<ThemeActions theme={theme} />}
      id={`theme-${theme.name}`}
      testId='theme-list-item'
      title={label}
      ...
    />
  ))}
</List>
```

- Each row has `id="theme-${theme.name}"` and `data-testid="theme-list-item"` — this is how we recover the theme name from the DOM.

Each row's action is a `<ThemeActions>` that renders (lines ~140-164):

```tsx
const menuItems = [
  { id: 'download', label: 'Download', onClick: handleDownload },
  // + 'delete' if isDeletableTheme(theme)
];

return (
  <div className='-mr-3 flex items-center gap-4'>
    {actions /* Activate button for non-active themes */}
    <Menu items={menuItems} position='end' triggerButtonProps={{...}} />
  </div>
);
```

### Menu → Popover → portalled content

- **`apps/admin-x-design-system/src/global/menu.tsx`** — renders each item as a plain `<button>` with the label as text content.
- **`apps/admin-x-design-system/src/global/popover.tsx`** — wraps Radix `PopoverPrimitive.Content`, which **portals to `document.body`** with `data-testid="popover-content"` and `z-[9999]`.

The Radix trigger is inside the row; the content is not. So when the user opens a theme's menu:

1. A new DOM node matching `[data-testid="popover-content"]` is appended under `body`.
2. That node contains `<button>` elements whose text is `"Download"`, optionally `"Delete"`.
3. Radix sets `aria-controls="<popover-content-id>"` on the trigger. So from the popover content's `id`, we can find the trigger via `document.querySelector([aria-controls="<id>"])`, then walk up to the enclosing `[id^="theme-"]` list item to recover the theme name.

### Injection strategy (chosen)

- `MutationObserver` on `document.body` (`childList`, `subtree: true`).
- For every added node, look for `[data-testid="popover-content"]` that contains a `<button>` whose text is exactly `Download` AND whose corresponding trigger (via `aria-controls`) sits under a `[id^="theme-"]`.
- If found, and if the popover does not already contain our injected button, insert an **"Edit in Browser"** `<button>` as a sibling immediately before the Download button. Copy the class list from the Download button so it matches Ghost Admin's menu item styling exactly.
- Capture the theme name at injection time (from the `theme-<name>` id) and attach it via `dataset.gteThemeName` on the injected button. Idempotent because we check for an existing `[data-gte-edit-button]` inside the popover before inserting.

---

## 3. Theme Download endpoint

- **`ghost/core/core/server/web/api/endpoints/admin/routes.js:206-209`**
  ```js
  router.get('/themes/:name/download',
      mw.authAdminApi,
      http(api.themes.download)
  );
  ```

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/ghost/api/admin/themes/:name/download` |
| Auth | `authAdminApi` — session cookie OR Admin API key (we use the session cookie) |
| Request body | none |
| Response | `application/zip` binary stream of the theme folder |

The full URL the injected script builds is:

```
`${subdir}/ghost/api/admin/themes/${encodeURIComponent(themeName)}/download`
```

where `subdir` is derived from `window.location.pathname` the same way `apps/admin-x-framework/src/utils/helpers.ts:9-17` (`getGhostPaths`) does.

Ghost Admin's own download UI uses a hidden `<iframe src=...>` to get a File Save dialog. We use `fetch(...).then(r => r.arrayBuffer())` instead because we want the bytes in memory, not on disk.

---

## 4. Theme Upload endpoint

- **`ghost/core/core/server/web/api/endpoints/admin/routes.js:216-221`**
  ```js
  router.post('/themes/upload',
      mw.authAdminApi,
      apiMw.upload.single('file'),
      apiMw.upload.validation({type: 'themes'}),
      http(api.themes.upload)
  );
  ```

| Property | Value |
|----------|-------|
| Method | `POST` |
| Path | `/ghost/api/admin/themes/upload` |
| Auth | `authAdminApi` — session cookie + Origin check |
| Body | `multipart/form-data` |
| Field name | **`file`** (multer `.single('file')`) |
| File type | `.zip` (`apiMw.upload.validation({type: 'themes'})`) |
| Response | `{ themes: [...] }` JSON on success |

### CRITICAL: the theme name comes from the uploaded **filename**

From **`ghost/core/core/server/services/themes/storage.js:48-95`** (`setFromZip`):

```js
setFromZip: async (zip) => {
    const themeName = getStorage().getSanitizedFileName(zip.name.split('.zip')[0]);
    const backupName = `${themeName}_${ObjectID()}`;
    ...
    if (themeExists) {
        renamedExisting = true;
        await getStorage().rename(themeName, backupName);
    }
    ...
    if (overrideTheme) { await activator.activateFromAPIOverride(...); }
    return { themeOverridden: overrideTheme, theme: toJSON(...) };
}
```

Two things follow from this:

1. **We MUST set the upload filename to `<themeName>.zip`** (the exact name of the theme we are replacing). Otherwise Ghost will treat the upload as a new theme under a different name.
2. **Replacement is non-destructive on the server side.** Ghost renames the existing theme folder to `<themeName>_<ObjectId>` as a backup before extracting the new one. If the theme was active, it is automatically re-activated after the replace. The UI should still confirm before uploading, but we can truthfully tell the user "Ghost keeps a backup of the previous theme."

### Auth headers on upload

Same session cookie as download — `credentials: 'same-origin'` on `fetch()` is enough, because our script runs on the same origin as Ghost Admin and the browser attaches the `ghost-admin-api-session` cookie automatically. **Do NOT set `Content-Type` manually** on the `FormData` request — the browser must set the multipart boundary.

---

## 5. Authentication

- **Session cookie:** `ghost-admin-api-session` (`ghost/core/core/server/services/auth/session/express-session.js:20`)
  - `httpOnly: true` → unreadable from JS (this is fine — we never need to read it)
  - `path: <subdir>/ghost` → the cookie is scoped to the admin panel; our script runs under `/ghost/...`, so it's attached automatically
  - `sameSite: 'none' | 'lax'` depending on SSL
- **Auth chain:** `authAdminApi = [apiKeyAuth.admin.authenticate, session.authenticate, ...]`
  (`ghost/core/core/server/services/auth/authenticate.js:6`)
- **CSRF protection:** **Origin-based, NOT a token.** See `ghost/core/core/server/services/auth/session/session-service.js:127-152` (`cookieCsrfProtection`). The server compares the request's `Origin` against the configured admin URL; mismatches are rejected with 400.

### Implications for the injected script

- Our script is served into the Ghost Admin page itself. Every `fetch()` call from it is same-origin, so the browser:
  - Sends the `ghost-admin-api-session` cookie automatically (`credentials: 'same-origin'` is enough; `'include'` also works).
  - Sets the `Origin` header to the admin URL, which passes `cookieCsrfProtection`.
- **No re-authentication, no token juggling, no CSRF token fetch.** This is the whole reason the extension must be injected via `clientExtensions.script` rather than run from an iframe or a separate origin.
- Ghost also gates rendering behind `session.isAuthenticated && session.user` (`application.js:61`), so an unauthenticated user never even loads the script.

---

## 6. CSP / script injection constraints

Reviewed the Ghost admin controller and middleware chain:

- **`ghost/core/core/server/web/admin/controller.js`** — the route handler that serves the admin `index.html`. It sets only `ETag` and optionally `X-Frame-Options: sameorigin` (when `adminFrameProtection` is enabled). It does **NOT** set a `Content-Security-Policy` header.
- A grep for `Content-Security-Policy` / `contentSecurityPolicy` across `ghost/core/core/server/web` turned up no server-set CSP. Ghost does not use `helmet` for the admin app.

### Implications

- **No CSP means no nonce / hash requirements.** `<script src="…">` loads unconditionally, from any origin Ghost can reach.
- `clientExtensions.script.src` can point at:
  - the local filesystem served by Ghost (e.g. `/content/extensions/ghost-theme-editor.js` if you wire up a static mount), or
  - any CDN / external HTTP(S) host.
- If a Ghost operator later adds a CSP via a reverse proxy, they would need to allow our origin in `script-src` and whatever we use for inline styles (we inject a `<style>` tag) in `style-src`. We document this caveat in the README.
- `X-Frame-Options: sameorigin` does not affect us — we do not use iframes for the editor modal.

---

## Summary of concrete contracts the extension depends on

| Thing | Value | Source |
|---|---|---|
| Admin subdir detection | `window.location.pathname.substr(0, path.search('/ghost/'))` | `helpers.ts:11` |
| API root | `${subdir}/ghost/api/admin` | `helpers.ts:14` |
| Download URL | `${apiRoot}/themes/${name}/download` | `advanced-theme-settings.tsx:89-90`, `routes.js:206` |
| Upload URL | `${apiRoot}/themes/upload` | `routes.js:216` |
| Upload field name | `file` | `routes.js:218` |
| Upload filename must equal | `<themeName>.zip` | `storage.js:49` |
| Auth | Session cookie (automatic), same origin | `express-session.js:20`, `session-service.js:127` |
| DOM anchor for injection | `[data-testid="popover-content"]` containing `<button>Download</button>` whose trigger is under `[id^="theme-"]` | `popover.tsx:43`, `menu.tsx:37-43`, `advanced-theme-settings.tsx:194-202` |
| CSP | none | `admin/controller.js` |
