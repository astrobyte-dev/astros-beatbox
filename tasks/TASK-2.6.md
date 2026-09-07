# P2.6 — Ubuntu Portability Foundation

Status: **Level B — Ubuntu Runtime Safe (Node fixture/runtime acceptance)**.
Level C native audio is **not validated**. **WINDOWS REVALIDATION IS PENDING**.
Do not merge as fully cross-platform-safe until that Windows gate passes.
P3 has not started and still requires an agreed specification.

## Scope and boundaries

Preserve the P2.5 persistent Node owner, canonical project service, command queue,
recording-aware Quit, Windows creation-handle cleanup and visible default-browser
launch through hidden cscript/ShellExecute. Add narrowly scoped Linux configuration,
ownership/cleanup, inspection, browser opening and backend capability boundaries.
No new musical features, production Linux-audio promise or orphan adoption.

The pasted migration handoff referenced `tasks/TASK-2.4.md`; no tracked reference
or history at that path exists. Its intended contents cannot be established.
Do not create it. The external handoff reference needs correction. Architecture
and protocol responsibilities are documented in CONTRIBUTING and the existing
P0a/P0b/P1/P2/P2.5 reports, not nonexistent ARCHITECTURE.md/PROTOCOL.md files.

## Acceptance tiers

| Tier | Result | Evidence |
| --- | --- | --- |
| A: portable development | Passed locally | Build, both typechecks, full suite, classic/Studio/P2/System browser journeys |
| B: Linux lifecycle | Passed locally | pidfd identity/cleanup tests, real Node descendant sockets, Stop/Restart/Quit, cold/second launch, signals, external conflicts |
| C: native audio | Not run; blocked on machine setup | Existing half-configured kernel package prevents a narrowly scoped apt transaction |
| Windows regression | Pending | Existing Windows tests/launcher retained; Ubuntu is not Windows acceptance |

See [Ubuntu setup and implementation](../docs/p26-ubuntu-portability.md) and
[portable validation summary](../docs/p26-validation.json).

## Run validation

Use Node 24.14.0 / npm 11.9.0 in `mcp`:

```sh
npm ci
npm test
npm run typecheck
npx playwright install chromium
node browser-selftest.mjs
node studio-selftest.mjs
node p2-selftest.mjs
node system-selftest.mjs
node linux-runtime-selftest.mjs
node linux-runtime-selftest.mjs --open # Linux desktop; opens a test tab
```

The suite retains every original test, with three native Windows tests skipped
on Linux. Linux process tests use dedicated Node child sessions, real listeners,
creation identities, graceful/forced shutdown and unrelated processes. They do
not invoke SuperCollider. Browser harnesses regenerate tracked historical
screenshots; review/discard those generated differences instead of replacing
Windows evidence with Linux captures. The Linux runtime harness uses temporary
storage and ephemeral ports, and does not write acceptance files itself.

## Remaining gates

1. Resolve the laptop's pre-existing half-configured kernel package independently
   of Beatbox. Recheck the package transaction, then follow the documented pinned
   audio setup and run Tier C sequentially with audio ports free.
2. On Windows, run TASK-2.5's full regression set: root launcher/default browser,
   zero console-show events, existing-instance/runtime/session preservation,
   recording continuity/finalization, Restart Audio, Stop, Quit, owned descendant
   cleanup and unrelated-process protection. Record real evidence before merge.
3. P3 requires an agreed task specification; no P3 implementation is included.
