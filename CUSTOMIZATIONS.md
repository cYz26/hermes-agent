# Personal Desktop customizations

This fork keeps upstream history separate from the Desktop used for personal customizations.

## Remotes and branches

- `origin`: `git@github.com:cYz26/hermes-agent.git`.
- `upstream`: `https://github.com/NousResearch/hermes-agent.git`.
- `main`: an upstream-only mirror. Do not merge personal features here or force-reset a diverged branch.
- `feat/quote-feedback`: migration of selected chat passages into editable, session-scoped feedback.
- `feat/queue-first`: migration of Queue-first submission with explicit steering.
- `custom/main`: integration branch and source for the customized Desktop build.

The initial customization migration targets upstream commit
`f14699a1379838862d3020b97785796aa555d36d`. The fork's existing `main` is not changed
by that migration. `custom/main` can therefore contain upstream commits newer than
the fork's `main`; inspect fetched refs rather than assuming the mirror is current.

## Custom behavior

### Quote feedback

Select an assistant passage, add it to the chat's feedback list, edit a note, and
explicitly add the collected feedback to the draft. Adding a quote does not send
it. Preserve scope across connection, profile, target profile, session and chat
surface; a failed draft insertion must not discard the feedback.

### Queue-first

During a running turn, ordinary Enter, the primary send action and visible
widget submissions queue the follow-up. Steering is a separate explicit action;
Cmd/Ctrl+Shift+Enter is its shortcut. Cmd/Ctrl+Enter remains a queue alias.
Repeated empty Enter must not promote or interrupt a queued message. Keep slash
commands immediate, clarify answers owned by their pending card, attachments
queued, hidden setup notes on their dedicated path, and Stop/Esc explicit.

## Updating the custom branch

Updates are reviewed merges, not a scheduled task or an overwrite of local
features. From a clean worktree, fetch upstream and create an upgrade branch:

```sh
git fetch upstream main
git switch -c sync/upstream-YYYYMMDD custom/main
git merge --no-ff upstream/main
```

Resolve conflicts while preserving upstream admission, retry, identity and
session-lifecycle fixes as well as both custom behaviors. Never resolve a
conflict by copying an entire older source file over the upstream version.

Use the Node/npm versions admitted by the current root `package.json`. Do not
bypass engine checks. Install dependencies from the lockfile, then run the
Desktop checks, including the two custom features:

```sh
npm ci --ignore-scripts --no-audit --no-fund
cd apps/desktop
npm run typecheck
npm run test -- --project ui src/app/chat/composer src/app/chat/quote-feedback src/store/composer-queue.test.ts src/store/parked-card-answers.test.ts src/store/quote-feedback.test.ts src/store/quote-feedback-lifecycle.test.ts src/i18n/quote-feedback.test.tsx src/lib/keybinds --maxWorkers=4
npm run i18n:keys -- --check
npm run build
cd ../..
```

Also lint the changed TypeScript files and exercise the updated UI/runtime seams
with the existing isolated E2E fixtures when they change. The command above is a
scoped regression, not a claim that every repository test passed. Review commands
before running them: the root workspace check includes Desktop packaging, and
formatting commands can change source files.

Only after reviewing actual results, promote the tested upgrade:

```sh
git switch custom/main
git merge --ff-only sync/upstream-YYYYMMDD
git push origin custom/main
```

If the fast-forward fails, the integration branch moved; integrate and verify
again rather than force-pushing. Updating the upstream-only `main` mirror is a
separate, explicit fast-forward operation. Existing feature branches retain their
migration history; start later work from the current `custom/main` and integrate
it through a feature branch.

## Building and handing off

Build the customized application from a known `custom/main` commit, record that
commit and the included features, and verify the exact produced artifact. Updating
Git branches does not update an already packaged application. Do not commit local
credentials, user data, dependency trees, disposable reports or application bundles.

Keep development and installed runtimes separate. Never overwrite or restart a
running application to test this fork. Use isolated test homes and the existing
E2E protocol-registration suppression; HOME/user-data isolation alone does not
prove operating-system associations are untouched. Switching a normal installation
or sharing its data home requires a separate, deliberate handoff and backup.
