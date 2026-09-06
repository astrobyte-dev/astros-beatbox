# Astro's Beatbox handover

Updated 2026-09-07 (Australia/Hobart). **P2.5 is complete and accepted.**
Next phase: **P3, not started**. Do not begin it without an agreed task scope.
The repository has no approved `tasks/TASK-3.md`; earlier reports identify P3
only as the next phase. Do not infer a specification from roadmap hints.

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
