# Astro's Beatbox handover

Updated 2026-09-07 (Australia/Hobart). Current implementation: **P5 — Product Finish**,
on `feat/p5-product-finish`, stacked on exact P4 commit
`0947f818d73d490d4e252182b0df47d716f4134a` and targeting
`feat/p4-jam-exploration`. Lower draft PRs remain unmerged.

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

## Checkpoint

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

## Set up the next Windows laptop

1. Install the external prerequisites in [README](README.md#prerequisites):
   Node 24.14.0 / npm 11.9.0, SuperCollider (validated with 3.14.1), SuperDirt,
   Dirt-Samples, Vowel/sc3-plugins, GHCup/GHC/cabal and TidalCycles 1.10.
   Windows Script Host must be available for the double-click launcher.
2. In PowerShell, clone and build:

   ```powershell
   git clone https://github.com/astrobyte-dev/astros-beatbox.git
   Set-Location astros-beatbox/mcp
   npm ci
   npm test
   npm run typecheck
   npx playwright install chromium
   ```

3. Double-click `Launch Beatbox.vbs` in the repository root. Start Pocket groove
   and press Play in Studio. Use System to inspect audio and to Quit.
4. Choose a WASAPI output belonging to the new laptop in the classic dashboard
   if the system default does not work. Do not copy the old `audio_device.txt`.
   Nonstandard dependency locations use the environment overrides in README;
   no old user's absolute paths are required by the launcher.
5. Optional MCP setup: copy `.mcp.json.example` to ignored `.mcp.json`, adjusting
   the server path to this new clone. MCP is not needed for standalone Studio.
6. For full acceptance replay, follow [TASK-2.5](tasks/TASK-2.5.md#validation).
   Stop the normal audio rig first and run audio tests sequentially.

All application source, dependency lockfiles, setup instructions, regression
harnesses and reviewed acceptance summaries belong to GitHub. `npm ci` and build
regenerate dependencies and output; SuperCollider/Haskell dependencies are
installed locally using the documented prerequisites.

The handover also exported the staged repository into a fresh temporary folder:
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
approved P3 scope and implementation status are linked above; no native or Windows
acceptance has been inferred from portable tests.
