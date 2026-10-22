# Custom Desktop: shared installed runtime

This customization is pinned to upstream
`d923a5eb487a17c0a68801bba9ef0f56c81040a8` (0.22.2). It is a compatibility
branch, not an upgrade of the user's installed backend.

## Contract

- Ordinary Enter and primary submit queue input while a turn is running.
  Steering is an explicit action, not the default submission path.
- Selected transcript passages can carry separate feedback notes. Adding them to
  the composer only creates a draft; the user still chooses when to send.
  Feedback is scoped by connection, owner profile, target profile and session.
- The source/full Desktop shell uses the existing installation's native LOCAL
  discovery and `serve` startup path. It does not ship an `agent-payload`, copy
  the user's configuration, or persist another GUI's temporary Remote endpoint.
- Standard and custom GUIs may be used alternately with the same installation
  and default data. Concurrent GUIs and one permanently running backend process
  are not acceptance requirements.
- Commit-specific product identity separates Electron userData without changing
  the normal Hermes data-home default. An explicit test userData override also
  needs an explicit isolated `HERMES_HOME`; see `electron/data-paths.mjs`.

## Building a separate local shell

Use the existing prepared packager/native-dependency workflow in `BUILDING.md`.
Keep the variant unset (source/full), rather than `bundled` or remote-only `light`.
Set `HERMES_BUILD_COMMIT` to the source revision to obtain a distinct application
identity. Bake this non-secret default through `HERMES_BUNDLE_ENV_JSON`:

```json
{"HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION":"1"}
```

This disables the runtime protocol-registration side effect. A personal package
must also omit `CFBundleURLTypes` from its final `Info.plist` **before signing**,
so Launch Services does not discover a competing protocol declaration. The
standard build's ordinary registration behavior remains unchanged without the
skip setting. Do not sign or replace the running standard application.

Use the lockfile and admitted Node/npm versions from the root manifest. Resolve
PM's admitted dependency interpreter for the chosen installation on each test
run; do not commit a machine-local environment-generation path. Do not bake a
test Python override or a real connection token into the product.

## Verification snapshot

The original local signed macOS arm64 artifact was built from the pinned base
plus the audited, uncommitted source edits. Publishing these edits does not
rebuild that installed artifact or change its historical dirty build stamp.
The results in the table describe that original artifact/source snapshot, before
the source-only review repairs below.

| Check | Observed result | Scope |
| --- | --- | --- |
| Frontend regression | 785 passed, 0 failed, 0 pending, across 105 files | Composer, queue, quotation, profile/session lifecycle, persistence and keybindings |
| Translation-key tests | 2 passed | Key inventory and translation admission |
| Native startup contracts | 42 passed | Source resolution, shared home, product identity, protocol default and release admission |
| Renderer typecheck | Passed | Renderer project; not a claim about every TypeScript project |
| Native lint and diff whitespace | Passed | Changed Electron main/helper and source diff |
| Exact signed packaged runtime | 4 passed, 0 failed/skipped/flaky | Queue, explicit Steer, quote feedback and close/reopen with persisted mock conversation |
| App/DMG/ZIP and installed copy | Passed | Signature and signed-member consistency; no backend payload or protocol declaration |

The packaged tests used isolated HOME, `HERMES_HOME` and Electron userData, a
loopback provider mock, and the existing backend source plus its explicitly
selected admitted interpreter. They did not send test prompts to real sessions.
The real installation's launcher also passed a read-only `--version` probe.
Frontend logs contain React `act(...)` warnings and expected stub stderr; passing
results are not a claim of warning-free execution or a green full-repository suite.

**Still deferred:** close the standard GUI, start the custom app against the real
default home with no runtime overrides, reopen it, then switch back to the
standard GUI. The user authorized installation only and kept the standard GUI
running. Isolated packaged tests do not establish that final live-switch gate.

The local package is ad-hoc signed, not Apple-notarized. Raw receipts, personal
paths, screenshots, caches and application archives remain local under ignored
build/release output; only this compact verification summary is versioned.

## Source-only publication repairs

Pre-publication review found three quotation lifecycle gaps. The source now:

- Captures a tile's complete owner route, keeping the desktop profile alias
  distinct from the backend target when foreground routing changes.
- Migrates tip-keyed feedback to its same-owner lineage root when metadata
  arrives, preserving notes and avoiding migration during ordinary navigation.
- Preserves ambient profile deletion's owner-or-target matching on the current
  connection, while retaining exact matching for explicit owner routes.

Mounted-surface and persisted-store regression tests cover these cases. Input
policy, locale labels, conversation-scope lifecycle and local-owner rename logic
are extracted into topical helpers to meet the repository's complexity caps
without changing the queue/Steer contract or suppressing health findings.

These repairs have **not** been rebuilt into the already installed application.
The earlier four packaged tests do not certify these newer source bytes; final
source checks and scoped review are separate publication evidence.

## Focused reproduction

From `apps/desktop`, with the root workspace dependencies already prepared:

```sh
node ../../node_modules/vitest/vitest.mjs run --project ui --maxWorkers=4 \
  src/app/chat/composer src/app/chat/quote-feedback \
  src/store/composer-queue.test.ts src/store/parked-card-answers.test.ts \
  src/store/quote-feedback src/store/session-states-profile-rename.test.ts \
  src/store/session-states-scopes.test.ts src/store/session-states-foreground-scopes.test.ts \
  src/lib/keybinds src/lib/persisted.test.ts src/i18n/quote-feedback.test.tsx \
  src/i18n/registry.test.ts src/app/session/hooks/use-background-queue-preservation.test.tsx \
  src/app/session/hooks/use-background-queue-drain.test.tsx \
  src/app/contrib/wiring-background-queue-drain.test.tsx \
  src/app/chat/hooks/use-composer-session-scope.test.tsx \
  src/store/session-owner-rename.test.ts

node scripts/i18n-keys.mjs --check
node ../../node_modules/vitest/vitest.mjs run --project electron scripts/i18n-keys.test.mjs
```

For the native selection below, set both `HERMES_PYTHON` and
`HERMES_TEST_PYTHON` to the resolved admitted interpreter on that invocation:

```sh
node ../../node_modules/vitest/vitest.mjs run --project electron \
  scripts/shared-runtime-bundle.test.mjs scripts/bundle-env.test.mjs \
  electron/backend-resolution.test.ts electron/data-paths.test.ts \
  electron/product-identity.test.ts electron/backend-command.test.ts \
  electron/backend-serve-support.test.ts electron/host-backend-attach.test.ts \
  electron/source-backend.test.ts electron/source-python.test.ts
```

Use an owned scratch directory for `TMPDIR`. Exact packaged-runtime verification
must launch the actual signed executable and assert `app.isPackaged`, executable
and ASAR paths, ready UI and persisted behavior; a source-mode run is not a
substitute. Never close or relaunch the user's active GUI merely to publish code.
