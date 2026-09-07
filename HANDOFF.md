# Astro's Beatbox handover

Updated 2026-09-07 (Australia/Hobart). **P5 — Product Finish implementation is complete**
on `feat/p5-product-finish`. P5 implementation commit:
`871203226a4337e2231151483b8b9fd2616410c5` (`feat: finish P5 product experience`).
The Windows handoff documentation commit follows it; `git rev-parse HEAD` identifies
the checkout's full commit. P5 is stacked on exact P4 commit
`0947f818d73d490d4e252182b0df47d716f4134a` and targeting
`feat/p4-jam-exploration` in [draft PR #9](https://github.com/astrobyte-dev/astros-beatbox/pull/9).

The current stack, from newest to oldest, is:

| Draft PR | Branch | Target |
| --- | --- | --- |
| #9 | `feat/p5-product-finish` | `feat/p4-jam-exploration` |
| #8 | `feat/p4-jam-exploration` | `feat/p3.5b-capture-sampling` |
| #7 | `feat/p3.5b-capture-sampling` | `feat/p3.5a-sound-lab-core` |
| #6 | `feat/p3.5a-sound-lab-core` | `feat/p3-composition-performance` |
| #5 | `feat/p3-composition-performance` | `feat/p2.6-ubuntu-portability` |
| #4 | `feat/p2.6-ubuntu-portability` | `main` |

None of these PRs has been merged. Older historical PRs #1–#3 were already merged;
that history is separate from this open stack. This handoff starts no new phase
and authorizes no merges or changes to acceptance gates.

Start with the [P5 report](docs/p5-product-finish.md),
[pre-implementation audit](docs/p5-product-audit.md),
[validation evidence](docs/p5-validation.json) and [TASK-5](tasks/TASK-5.md).
The [user guide](docs/user-guide.md) explains the product without phase history.

P5 makes the existing music workflows coherent: rhythm-first editing, persistent
transport/save status, guarded unsaved reopen, remembered optional tips/Help,
focus links, Capture→My Sounds, visible completed recordings, accessible contrast,
reduced-motion clock behavior and connected error recovery. Classic remains under
System compatibility for explicit unmatched source/device/routing capabilities.
It is not deleted or claimed to have full Studio parity.

Final portable suite: **377 passed, 3 Windows skips, 380 discovered**. Build, both
typechecks, all eight inherited browser journeys, new horizontal P5 journey and
Linux runtime/lifecycle pass. P5 adds automated accessibility and realistic
12-track/16-scene fixture measurements. Read the JSON/report for exact per-state
results, sizes and limits; synthetic audio is not native proof.

ProjectService and the serialized application queue remain authoritative. The
only server addition publishes the existing save observation plus the last
successful filename to Studio. No new authored schema, player, native code,
parameter range, ownership rule or major feature family was introduced.

**All native gates remain open:** P2.6 Windows desktop/audio; P3 native audio/timing
and Windows; P3.5A native audio/timing/CPU and Windows; P3.5B native microphone/audio
and Windows; P4 native audio/timing/CPU/musical quality and Windows. P5 also needs
real Windows and native whole-product acceptance. Ubuntu remains **Level B —
Runtime Safe**, native audio unvalidated. No system/kernel/audio packages or
pending installation state were modified. Historical P2.5 Windows acceptance does
not close these later revalidation gates.

The historical checkpoint and native setup contracts below remain relevant.

## Historical P2.5 checkpoint

Repository: https://github.com/astrobyte-dev/astros-beatbox.git, branch `main`.
The P2.5 milestone follows the completed P0a (`c03c545`), P0b (`e50942c`),
P1 (`718027d`) and P2 (`4cd75f1`) commits. Use `git log -5 --oneline` to locate
the milestone; this document does not depend on an unpublished local commit ID.

- [Completed P2.5 task](tasks/TASK-2.5.md)
- [Runtime Control Center implementation](docs/p25-runtime-control-center.md)
- [Silent-take investigation](docs/p25-silent-take-investigation.md)
- [Repeated audio validation](docs/p25-investigation-validation.json)
- [Portable Windows lifecycle evidence](docs/p25-windows-validation.json)
- [Real browser-launch evidence](docs/p25-browser-launch-measurements.json)
- [Final handover validation](docs/p25-handover-validation.json)

The final real Windows launcher validation opened Studio in **Opera GX**, observed
the expected Studio browser request and **zero console-show events**, and kept
the existing Beatbox runtime and active session running without restart or
disruption. The user explicitly confirmed completion of this remaining human /
Windows acceptance check on 2026-09-07. This was real Windows Script Host,
ShellExecute and the default browser, not merely a mocked or unit test.

## Preserve these boundaries

- P2's detached persistent Node runtime owns Application, HTTP, telemetry and
  audio. MCP/frontend reconnects do not stop music or recording.
- P0a's process handles and creation identities govern cleanup. Read-only System
  inventory or a matching port never grants permission to kill a process.
- sclang uses hidden, non-detached creation on Windows; the Node owner remains
  detached. The browser opens visibly through `open-studio.vbs` / ShellExecute;
  its cscript helper stays hidden. Do not replace this with hidden Explorer.
- ProjectService is the authored-document authority. Both UIs use the same
  command queue, revision checks and retry contract.
- Preview stays outside the managed project recorder. Finalized WAV structure
  and measured audio content are distinct. Intentional silence remains valid.

## Remaining uncertainty

One original P2 live take was structurally valid but silent. Its cause was not
established and it was not reproduced in the investigation. This is a documented
residual risk, not a claimed audio fix. Three final P2/Preview runs and 39 timing
takes passed; added diagnostics retain input peak, DSP time, event counts,
generation/revision/mixer context and per-take identities. Preserve that coverage.
If it recurs, keep the WAV and adjacent `.recording.json` and copy System logs.

## Continue on the Windows desktop through P5

1. Install the external prerequisites in [README](README.md#prerequisites):
   Node 24.14.0 / npm 11.9.0, SuperCollider (validated with 3.14.1), SuperDirt,
   Dirt-Samples, Vowel/sc3-plugins, GHCup/GHC/cabal and TidalCycles 1.10.
   Windows Script Host must be available for the double-click launcher.
2. In PowerShell, clone the P5 branch (not the default `main`) and verify it:

   ```powershell
   git clone --branch feat/p5-product-finish https://github.com/astrobyte-dev/astros-beatbox.git
   Set-Location astros-beatbox
   git fetch origin
   git branch --show-current
   git rev-parse HEAD
   git rev-list --left-right --count HEAD...origin/feat/p5-product-finish
   git status --short
   ```

   Expect `feat/p5-product-finish`, the final handoff SHA from the delivery reply,
   `0 0` divergence and no status output. For an existing clean clone, run these
   from its repository root instead of cloning:

   ```powershell
   git status --short
   git fetch origin
   git switch feat/p5-product-finish
   git pull --ff-only origin feat/p5-product-finish
   git rev-parse HEAD
   git rev-list --left-right --count HEAD...origin/feat/p5-product-finish
   git status --short
   ```

   If there is local work or divergence, preserve it and inspect before proceeding;
   do not reset, clean or force-push to make the checkout match. Git switch will
   track the fetched branch automatically if no local P5 branch exists.

   With the documented Node/npm versions installed, restore and validate:

   ```powershell
   Set-Location mcp
   npm ci
   npm test
   npm run typecheck
   npx playwright install chromium
   npm run selftest:p5
   ```

   `npm test` includes the production build. The P5 browser journey uses fixture
   audio and regenerates screenshot/validation evidence; inspect resulting file
   changes before committing any Windows evidence. These checks do not close
   native acceptance gates. Follow the P5 report and linked phase reports for the
   remaining Windows/native validation; do not begin another feature phase.
3. Double-click `Launch Beatbox.vbs` in the repository root. Use Start Playing
   in Studio. Use System to inspect audio and to Quit.
4. Choose a WASAPI output belonging to the Windows desktop in the classic dashboard
   if the system default does not work. Do not copy the old `audio_device.txt`.
   Nonstandard dependency locations use the environment overrides in README;
   no old user's absolute paths are required by the launcher.
5. Optional MCP setup: copy `.mcp.json.example` to ignored `.mcp.json`, adjusting
   the server path to this new clone. MCP is not needed for standalone Studio.
6. For historical P2.5 acceptance replay, follow [TASK-2.5](tasks/TASK-2.5.md#validation).
   Stop the normal audio rig first and run audio tests sequentially. That replay
   alone does not validate the later P2.6–P5 gates listed above.

All application source, dependency lockfiles, setup instructions, regression
harnesses and reviewed acceptance summaries belong to GitHub. `npm ci` and build
regenerate dependencies and output; SuperCollider/Haskell dependencies are
installed locally using the documented prerequisites.

The historical P2.5 handover exported the staged repository into a fresh temporary folder:
`npm ci`, the production build, all 157 tests and both typechecks passed there
without copying this workspace's dependencies, output or runtime state.

Personal `projects/`, `recordings/`, `.abx-recovery/`, device selections, local MCP
configuration, environment files, logs, raw process inventories and temporary
test captures are intentionally not part of the checkpoint. A fresh clone starts
without personal jams or takes. Copy those separately only if you want your music;
development and its regression fixtures do not depend on them.

## Ubuntu / Linux — P2.6

Last development platform: **Ubuntu 24.04.4 LTS, x86_64**.
See [TASK-2.6](tasks/TASK-2.6.md) and [Ubuntu setup](docs/p26-ubuntu-portability.md).

- Shared build, typechecks and tests: **PASS**.
- Classic/Studio/P2/System browser journeys: **PASS** with fake audio.
- Linux process/socket, owned Node descendants, Stop/Restart/Quit, signal shutdown,
  cold/second launch and actual default-browser request: **PASS**.
- Ubuntu status: **Level B — Runtime Safe**; native audio **NOT VALIDATED**.
- Native setup blocker: pre-existing half-configured Ubuntu kernel package.
  No system/audio packages or global configuration were changed by this phase.
- **WINDOWS REVALIDATION IS PENDING**: real launcher/default browser, zero console
  shows, second-launch runtime/session stability, recording continuity/finalization,
  Restart Audio, Stop, Quit, descendant cleanup and unrelated-process protection.
  Do not merge P2.6 as fully cross-platform-safe before these checks pass.

Use `nvm install && nvm use`, then the normal `mcp` npm commands. Linux requires
Python 3.9+ with pidfds for managed audio ownership. The backend does not load
`.env`; supply documented variables externally. Linux state lives in workspace-
specific XDG locations, not the checkout. Do not commit local state or replace
Windows acceptance screenshots with regenerated Linux captures.

The missing TASK-2.4 reference belonged to the pasted migration handoff; no
repository reference/history establishes that file. It was not reconstructed.
Historical milestone reports retain their original scope statements. The current
completed P5 implementation scope and status are linked above; no native or Windows
acceptance has been inferred from portable tests.
