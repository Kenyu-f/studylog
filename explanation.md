# StudyLog (TypeScript edition) — explanation.md

This is a TypeScript/Node.js port of the original Go implementation of
StudyLog, done to deploy on Deplexo (a Docker-based Node/TS-friendly
platform). It is a **feature-complete rewrite**, not a thin wrapper: same
data model, same Grass math, same auth/recovery-code design, same
"academic x cute-core" UI — reimplemented in TypeScript because that's
what this deployment target expects. If you have the original Go
codebase's `explanation.md` open side by side, most sections below map
1:1 onto it; this document calls out where and why the port differs.

---

## 1. Project Overview

Same product as the Go version: a two-person study log where a
GitHub-contribution-style "Grass" heatmap shows daily progress toward
goals arranged in an arbitrary-depth tree (long-term -> medium-term ->
short-term -> Study Session). See the Go `explanation.md`'s sections 1-2
for the full product rationale — none of that changed in the port.

## 2. Architecture

```
Browser
  |  (HTML pages, cookie-based session)
  v
Express app (Node.js)
  +- Page routes   -> EJS templates -> full HTML response
  +- JSON API      -> used by the same vanilla-JS "islands" as before
  |                   (Grass grid, dialogs) -- these files were copied
  |                   over UNCHANGED, see section 4
  +- Store (src/db.ts) -> SQLite (node:sqlite, built into Node)
```

Same shape as the Go version: server-rendered pages for navigation and
initial state, a small JSON API for the interactive parts (Grass grid,
day/session dialogs, goal editor), no client-side framework, no build
step for the frontend (only the *backend* TypeScript needs compiling).

## 3. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, compiled with `tsc` | Deployment target expects a TypeScript/Node project. |
| HTTP framework | Express | The de facto standard for Node HTTP servers -- unlike the Go version (which had Go 1.22's pattern-matching router built into its stdlib), plain Node's `http` module has no path-parameter routing at all, so hand-rolling one would be *less* readable than using the one framework every Node developer already knows. This is the one framework-level dependency in the whole stack. |
| Templates | EJS | Plays the same role `html/template` played in the Go version: server-side HTML generation with `<%= %>` interpolation (auto-escaped by default, same safety property as Go's contextual autoescaping -- see section 12). |
| Database | Real SQLite, via Node's built-in `node:sqlite` | See Decision D1' below -- this is the one thing the Go version explicitly could *not* do (Decision D1 in the Go `explanation.md`), and this port fixes it, with zero extra dependencies. |
| Frontend | Vanilla HTML/CSS/JS, copied over unchanged from the Go version | See section 4 -- no reason to touch working, already-debugged files. |
| Auth | Same design as the Go version: salted+stretched SHA-256 (via Node's built-in `crypto`), recovery-code password reset | See section 10. |

## 4. What Was Ported Unchanged

The entire frontend -- `public/css/style.css`, `public/js/app.js`,
`public/js/goals.js` -- is a **byte-for-byte copy** of the Go version's
`static/` directory, not a rewrite. Two things follow from that:

- Every fix already made to the Go version's frontend carries over
  automatically, including the two you asked about directly:
  - The **month-label duplication bug** ("JanJanFebMarAprApr...") was
    already fixed in `app.js` before this port started -- the fix labels
    a week-column only when it contains the literal 1st of a month
    (`d.getDate() === 1`) instead of "any day <= 7", which is what
    caused the duplication (see the Go `explanation.md`'s Decisions Log
    for the full root-cause writeup). Verified again here, independently
    of the Go version, for 2024-2028 with no duplicates found.
  - The **`hidden` attribute / CSS cascade bug** (where `.form-row`'s
    `display: grid` silently beat the browser's own
    `[hidden] { display: none }` rule) was already fixed with a
    `[hidden] { display: none !important; }` reset rule near the top of
    `style.css`.
- Because the frontend is unchanged, `internal/grass`'s JSON shape
  (`Cell { date, actualMin, targetMin, ratio, intensity }`, `Progress {
  mode, actualMin, targetMin, percent, hasPercent }`) had to be
  reproduced *exactly* on the TypeScript side (`src/grass.ts`) -- the
  frontend has no idea whether it's talking to Go or Node.

## 5. Directory Structure

```
studylog-ts/
├── package.json / tsconfig.json   Node project + compiler config
├── src/
│   ├── models.ts        Plain types (User, Group, Goal, StudySession)
│   ├── auth.ts           Password hashing + recovery codes
│   ├── grass.ts           Grass cell math, goal-progress math, tree flatten
│   ├── db.ts               SQLite persistence layer
│   ├── app.ts                Express routes, auth middleware, handlers
│   └── server.ts               Entry point
├── views/                EJS templates (one per page, ported from the
│                          Go version's templates/*.html)
├── public/                Static assets -- copied unchanged, see section 4
│   ├── css/style.css
│   └── js/{app.js, goals.js}
├── data/                  SQLite database file lives here
├── Dockerfile
├── deplexo.yaml           Deplexo platform config
└── explanation.md          this document
```

Directly comparable to the Go version's layout (`internal/models` ->
`src/models.ts`, `internal/store` -> `src/db.ts`, `internal/grass` ->
`src/grass.ts`, `internal/handlers` -> `src/app.ts`, `main.go` ->
`src/server.ts`, `templates/` -> `views/`, `static/` -> `public/`).

## 6. Data Model

Identical fields to the Go version's `models.go` (see its section 5 for
the full field-by-field rationale, including Decision D2 about
minutes-only targets, which still applies unchanged). The only
difference is representation: TypeScript's `Goal.deadline` is
`string | null` instead of Go's `*time.Time`, and timestamps are ISO
8601 strings throughout rather than a native `time.Time` -- both are just
how each language's SQLite binding naturally represents these types; no
behavioral difference.

## 7. Porting Notes: Go to TypeScript

Points worth knowing if you're comparing the two codebases line by line:

- **Concurrency**: the Go version needed a `sync.RWMutex` around every
  store operation because `net/http` runs each request on its own
  goroutine, so concurrent access was a real possibility. Node.js is
  single-threaded for JavaScript execution (the event loop only runs one
  callback at a time), and `node:sqlite`'s `DatabaseSync` calls are
  synchronous, so there's no equivalent mutex here -- it's structurally
  impossible for two requests' database calls to interleave.
- **Nil vs. undefined/null footgun**: the Go version's first
  user-reported bug (see its Decisions Log / Known Issues) was `var out
  []T` serializing as JSON `null` instead of `[]`. TypeScript's
  `Array.prototype.map`/`.filter` always return `[]` for an empty input
  array -- there is no equivalent footgun in this port, and no
  defensive `|| []` guards were needed on the frontend side (though the
  ones already in `app.js`/`goals.js` from the Go-version fix were left
  in place as harmless extra safety).
- **Error handling**: Go's `(value, error)` return convention became
  TypeScript exceptions (`NotFoundError`) + `try/catch`, which is more
  idiomatic in JS/TS. The *shape* of each handler -- "look up the
  resource, 404 if missing, check it belongs to the caller's group, then
  act" -- is unchanged from `handlers.go`.
- **Routing**: Go 1.22's stdlib `"METHOD /path/{id}"` pattern syntax
  became Express's `app.get("/path/:id", ...)` -- same idea (method +
  path-parameter matching), different framework.
- **Recursion**: `grass.ts`'s `computeProgress`/`sortGoalsForTree` are
  near-verbatim translations of the Go version's closures-over-`var walk
  func(...)` pattern -- TypeScript's arrow functions can reference
  themselves once declared with `const walk = (id: string): void => {
  ... }`, slightly more direct than Go's two-step "declare then assign"
  requirement for a recursive closure.

## 8. SQLite (Decision D1', supersedes the Go version's Decision D1)

The Go version's `explanation.md` documents (Decision D1) that it used a
hand-rolled JSON-file store instead of SQLite, specifically because that
build environment had no path to the Go module proxy to fetch a driver.
**That constraint does not apply here.** npm's registry was reachable the
whole time, and -- better still -- Node 22.5+ ships SQLite **built into
the runtime itself** as `node:sqlite`. This port therefore uses real
SQLite, with a real schema (`src/db.ts`'s `migrate()`), proper indexes on
the hot query paths (`goalId`/`groupId`/`date`), and zero extra npm
packages for the database layer -- not even a driver.

**The honest caveat**: `node:sqlite` is still labeled "experimental" by
Node itself (it prints an `ExperimentalWarning` on startup -- harmless,
not an error). It has been stable enough in practice to build on here,
and this project pins `node:22-alpine` in the `Dockerfile` specifically
so the deployed environment matches what was tested. If `node:sqlite`
ever changes incompatibly in a future Node release, or if you'd rather
depend on a non-experimental library, the fix is contained entirely to
`src/db.ts` -- swap `DatabaseSync` for `better-sqlite3` (same
synchronous, near-identical API; an npm package rather than a built-in)
and nothing else in the codebase needs to change, since every other file
only ever calls the `Store` class's own methods.

## 9. Grass Calculation, Color Normalization, Goal Progress

Unchanged math from the Go version (its sections 9-11 apply verbatim):
`ratio = actual / target`, `intensity = clamp(ratio, 0, 1)`, cumulative
goals sum recursively down the subtree, `none`-mode goals never get a
fabricated percentage. `src/grass.ts` is a direct line-for-line port of
`internal/grass/grass.go`. The color mapping itself
(`pinkForIntensity` in `app.js`) didn't move at all -- it's the same
unchanged frontend file (section 4).

## 10. Authentication and Password Recovery

Same design as the Go version's sections 18 and its "Password Recovery
(no email)" addendum: salted + 100,000-iteration-stretched SHA-256
(`src/auth.ts`, using Node's built-in `crypto` module -- no
bcrypt/argon2 package, same stated tradeoff as the Go version), a random
session token in an `HttpOnly`/`SameSite=Lax` cookie, and a one-time
recovery code (shown once, rotated on every successful reset) as the
"forgot password" mechanism instead of email. `crypto.timingSafeEqual`
plays the role `crypto/subtle.ConstantTimeCompare` played in Go, for the
same reason (avoid a timing side-channel on hash comparison).

## 11. Cookies Without a Dependency

Express doesn't parse cookies out of the box (that's traditionally the
`cookie-parser` package's job). Rather than add a dependency for
something this small, `src/app.ts` hand-rolls `parseCookies`/
`setSessionCookie`/`clearSessionCookie` -- about 15 lines total. Same
philosophy as the Go version's "minimal dependencies" priority, just
applied on the Node side of the fence.

## 12. Templating and XSS Safety

EJS's `<%= %>` tag HTML-escapes by default (equivalent to `<%- %>` being
the "raw, unescaped" opt-out, which this codebase never uses for
user-authored text). This is the same safety property Go's
`html/template` provided automatically -- Goal titles/descriptions and
Session subjects/descriptions all flow through `<%= %>`, so a
description like `<script>` typed by a user renders as literal text, not
executed. See the Go version's section 17 for why this matters
specifically for the freeform Description field.

## 13. How to Run Locally

Requirements: **Node.js 22.5 or newer** (for `node:sqlite`; this project
was built and tested against 22.22).

```bash
cd studylog-ts
npm install
npm run build   # compiles src/*.ts -> dist/*.js
npm start        # or: npm run dev, which does both in one step
# -> StudyLog listening on :8080
```

Open `http://localhost:8080` -- first visit redirects to `/setup`, same
as the Go version. Data is written to `data/studylog.db` (a real SQLite
file -- you can inspect it directly with the `sqlite3` CLI or any SQLite
GUI, which is one more practical advantage over the Go version's
hand-rolled JSON format). Configurable via `PORT`/`DATA_PATH` environment
variables.

## 14. Deploying to Deplexo

Deplexo deploys from a `Dockerfile` (its `deplexo.yaml` declares
`framework: dockerfile`), reads the app's listening port from the `port:`
field (`8080` here, matching this app's default -- see `src/server.ts`,
which already reads `$PORT` the same way the Go version did for
Railway/Fly), and -- per Deplexo's own docs -- **apps run in containers
with a read-only root filesystem**, so any data that must survive a
redeploy needs to live on a persistent volume rather than the container's
own writable layer. Concretely:

1. Push this project (with `Dockerfile` and `deplexo.yaml` at the root)
   to a GitHub repo, then connect it in the Deplexo dashboard (or
   `deplexo apps create --name studylog --repo <your-repo-url>` via the
   CLI).
2. In the app's settings, attach a **persistent volume** mounted at
   `/data` (consult Deplexo's current Storage docs for the exact UI flow
   -- `docs.deplexo.com/operations/storage/` blocks automated fetches
   from this environment's tooling, so its exact steps couldn't be
   verified directly here; the mount-path convention below is inferred
   from every comparable Docker-based platform (Railway, Fly, Render)
   and from Deplexo's own front page confirming apps run in containers
   with a read-only filesystem plus a persistent-volume option -- worth
   double-checking against their live docs before relying on it).
3. The `Dockerfile` already sets `ENV DATA_PATH=/data/studylog.db` to
   match that mount path, and `EXPOSE 8080` to match `deplexo.yaml`'s
   `port: 8080` -- no extra environment variables should be needed
   beyond attaching the volume itself.
4. Deploy (`deplexo deploy --app <app-uuid>`, or push to the connected
   branch if automatic deploys are enabled). Open the assigned subdomain
   -- you should land on `/setup`, exactly like running it locally for
   the first time.

This also happens to work unmodified on Railway or Fly.io (see the Go
version's `explanation.md` for their step-by-step guides) -- swap
`DATA_PATH` to wherever that platform mounts its own persistent volume,
same as described there.

## 15. Known Issues Carried Over (Already Fixed at Port Time)

Both bugs reported against the Go version's frontend were fixed *before*
this port was written, and -- because the frontend files were copied
over unchanged (section 4) -- both fixes are present here from the
start, not something to re-verify:

- **Month labels duplicating** ("JanJanFebMarAprApr..."). Root cause and
  fix are described in section 4 above and in the Go version's Decisions
  Log; re-verified independently for this port across 2024-2028 with no
  duplicates found.
- **`hidden` attribute silently overridden by `.form-row`'s `display:
  grid`**, which let a Goal's Target-value field stay visibly editable
  even when "Progress type" was set to "No numeric progress," silently
  discarding whatever number was typed there. Fixed the same way here
  (the `[hidden] { display: none !important; }` reset rule near the top
  of `style.css`), since it's the same unchanged CSS file.

## 16. Future Extensions

Same list as the Go version's section 25 applies (multi-unit metrics,
weekly Grass visualization, real password hashing for public deployment,
session-editing UI), plus one Node-specific item: swapping `node:sqlite`
for `better-sqlite3` if the "experimental" label in section 8 ever
becomes a real concern rather than a startup-log warning.
