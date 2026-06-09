---
name: web-ui-review
description: Visually verify and interact with web UIs in Claude Code on the web (cloud sandbox sessions). Use whenever building or modifying frontend code in a cloud session — after any UI change, before claiming it works, and when debugging layout, styling, interactivity, or console errors. Covers starting the dev server, navigating with the webview browser tools, the screenshot/snapshot verify loop, and the sandbox's networking constraints.
---

# Web UI review in the cloud sandbox

You have a headless browser (Playwright MCP, server name `webview`) inside this
sandbox. Use it to *look at* the UI you are building instead of guessing from code.

## Hard constraints — read first

1. **localhost only.** The sandbox's security proxy does not support HTTPS
   CONNECT tunneling, so the browser CANNOT load external sites
   (https://example.com will hang or fail). Anything served from
   `http://localhost:<port>` or `http://127.0.0.1:<port>` works, because
   loopback traffic never touches the proxy. Do not waste turns retrying
   external URLs; fetch external resources with curl/WebFetch instead.
2. **Headless.** There is no display. Use `browser_snapshot` (accessibility
   tree) for structure/interaction targets and `browser_take_screenshot` for
   visual verification. Read screenshots with the Read tool if returned as files.
3. **CDN-dependent pages may render incompletely.** If the page pulls fonts,
   scripts, or images from external CDNs, those subresource requests fail in
   the browser. Prefer locally-bundled assets when judging visual fidelity, and
   don't chase "missing font" ghosts that are just the proxy.

## The verify loop

1. **Start the dev server in the background** and wait for the port:
   ```bash
   (npm run dev > /tmp/dev.log 2>&1 &) && \
   for i in $(seq 1 60); do curl -fsS http://localhost:3000 >/dev/null 2>&1 && break; sleep 1; done
   ```
   Check `/tmp/dev.log` if the port never opens. For production-build checks,
   build and serve statically (e.g. `npx serve dist`) — same loop.
2. **Navigate**: `browser_navigate` → `http://localhost:3000/...`
3. **Verify structure**: `browser_snapshot` — confirm expected elements exist
   and are labeled/reachable.
4. **Verify visuals**: `browser_take_screenshot` — actually look at it. Check
   layout, spacing, overflow, contrast, responsive behavior
   (`browser_resize` to 375x812 for mobile, 1280x800 for desktop).
5. **Interact**: `browser_click`, `browser_type`, `browser_fill_form` etc. to
   exercise the flows you changed. Re-screenshot after each state change.
6. **Check the console**: `browser_console_messages` after every navigation and
   interaction. Treat new errors/warnings as failures even if the screenshot
   looks fine.
7. Fix → reload (`browser_navigate` again; HMR usually picks up edits) → repeat
   until the screenshot and console both confirm the change.

Never report a UI task as done without at least one screenshot of the final
state taken AFTER your last code edit.

## Troubleshooting

- **MCP tools missing / browser won't start**: check that
  `/opt/claude-webview/chrome` exists and is executable. If not, the
  environment's setup script didn't run or failed — install in-session as a
  fallback: `npx --yes @puppeteer/browsers install chrome@stable --path /opt/claude-webview`,
  then symlink the found binary to `/opt/claude-webview/chrome`.
- **Chrome crashes on launch**: missing shared libs — rerun the install script
  (it apt-installs deps) or `npx playwright install-deps chromium`.
- **Page loads but is blank**: check `/tmp/dev.log` for server errors and
  `browser_console_messages` for runtime errors before assuming a browser issue.
- **Need a different port**: nothing is special about 3000; any localhost port works.
