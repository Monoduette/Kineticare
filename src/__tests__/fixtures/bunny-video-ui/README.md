# Bunny Admin UI Fixture

Run with Node 24 from the repository root:

```sh
node src/__tests__/fixtures/bunny-video-ui/run.mjs /absolute/path/to/playwright/index.mjs
```

Requires the installed repo dependencies (including tus-js-client) and an existing
Playwright Chromium installation. No package installation is performed. The API
worker owns `src/lib/stream/bunny-upload-contract.ts`; it must be integrated first.

The harness bundles the actual React field, picker, uploader and library. Payload
form hooks and TUS transport are isolated fixtures; real Payload icons are used.
All fetch requests are mocked in-browser. Provider thumbnails and iframes are
fulfilled locally, and any unexpected external browser request fails the run.
The ephemeral loopback server closes after the checks.

Coverage: stable-row reorder/deletion, current-GUID conflicts, cancellation and
late detail, replacement confirmation, atomic single UPDATE_MANY, public-only
preview writes, search/pagination, 320/390/768/1440 light/dark reflow, 44px controls,
focus trap/return, same-instance pause/resume, no persisted fingerprints,
uncertain initialization, explicit expiry restart (before and during sign),
ready-only selection, bounded ten-minute polling, standalone close/reopen reset.

Screenshots are written to `/tmp/kineticare-video-ui-20260909-evidence/`.
This does not validate real Payload form persistence, provider CORS/TUS, auth,
CSP or database behavior. Those belong to the parent's integration gate.

The only PR242 overlap is `AdminChrome.tsx`: forwarding `initPageResult.req` into
the installed Payload DefaultTemplate, whose DefaultNav calls getNavPrefs(req).
The focused chrome test fails without that prop. No other PR242 changes included.

Learning: native Chromium dialog modality alone briefly allowed Tab to leave the
document. Explicit boundary cycling now complements native showModal, covered
in all eight viewport/theme combinations. The test awaits transport setup before
firing simulated TUS completion; early completion was a fixture timing failure.
