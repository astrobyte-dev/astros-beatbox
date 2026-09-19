# P2.6 Ubuntu portability foundation

Last development platform: Ubuntu 24.04.4 LTS, x86_64.
**Level A and B validated; Level C native audio unvalidated.**
**WINDOWS REVALIDATION IS PENDING.** This branch must not be merged as fully
cross-platform-safe until the Windows regression gate in TASK-2.6 is satisfied.

## Development setup

Keep Node **24.14.0** and npm **11.9.0**, as pinned by `.nvmrc` and `mcp/package.json`.
With an existing nvm installation:

```sh
cd /path/to/astros-beatbox
nvm install
nvm use
cd mcp
npm ci
npm test
npm run typecheck
npx playwright install chromium
npm run launch
```

Python **3.9+**, Linux **5.3+** with working `pidfd_open`/`pidfd_send_signal`, and
readable `/proc` are required for managed Linux audio-process cleanup. Ubuntu
24.04's Python 3.12 supplies the required APIs; no Python packages are needed.
`python3 mcp/linux-stop.py --check` (from the repo root) checks the actual facility.
`xdg-open` opens the desktop's configured default browser. Missing/failed browser
opening prints the local URL and leaves a successfully started Linux runtime
running. Use `node dist/launcher.js` in `mcp` for a headless launch without opening
a browser. Production Studio and System are served by that same owner.

Audio starts only on musical preparation/Play. Studio, project editing, saves,
recovery, System and idle runtime reuse work without the external audio toolchain.
`npm run dev:studio` supplies Vite hot reload against the running backend.
`npm run runtime:stop` performs recording-aware shutdown. Stop the runtime before
rebuilding backend code; reconnecting intentionally retains its loaded code.

## Platform boundaries

| File | Responsibility |
| --- | --- |
| `src/platform.ts`, `src/config.ts` | Platform defaults, executable discovery, XDG locations, explicit SC backend capabilities |
| `src/owned-process.ts` | Dispatch to unchanged Windows identity/handle implementation or Linux helper |
| `src/linux-process.ts` | Pure `/proc` parsers and read-only process/socket inventory |
| `linux-stop.py` | Linux pidfd acquisition, identity checks, descendant/session shutdown and socket-release confirmation |
| `src/browser.ts` | Windows cscript/ShellExecute or Linux xdg-open |
| Existing runtime/health/engine modules | Shared lifecycle and truthful capability reporting |

No process is adopted from its name or a matching port. The structural runtime
handshake retains workspace/configuration/session compatibility checks; it is
not authentication against malicious same-user processes. No persistent PID file
grants ownership, and no new supervisor or service installer was introduced.

## Linux ownership and shutdown

Each managed interpreter is a newly spawned dedicated session/group leader.
The driver captures `/proc/<pid>/stat` start ticks and verifies that session/group
identity. This is separate from a UI wall-clock observation. Before spawn, the
pidfd helper capability is checked; missing support refuses managed audio.

At Stop, the helper opens pidfds, then rechecks creation identity and ancestry.
The verified live root establishes ownership; descendants and session members
are captured while a live verified identity anchors them. Observed children that
created another session can be captured through verified ancestry. Signals use
pidfds, never a numeric `kill(pid)`/`kill(-pgid)` fallback, preventing a signal
from reaching a replacement process after PID reuse.

Shutdown sends SIGTERM to descendants and then the root, rescans while verified
members remain alive, escalates to SIGKILL after two seconds, and fails after six
seconds. It checks pidfd exit and disappearance of captured socket inodes from
the network namespace. An unrelated process rebinding a port is not terminated.
Actual socket binds still arbitrate availability when restarting.

The helper is synchronous, matching the existing Windows cleanup contract:
the lifecycle queue cannot launch a replacement before cleanup returns. HTTP
may pause for the bounded cleanup interval; it does not claim success in advance.
Two interpreter cleanups can take up to two such intervals. Existing recording
finalization occurs before cleanup. Failure keeps System available for inspection
and deliberate retry. SIGINT, SIGTERM and Linux SIGHUP use graceful Quit; repeated
signals share the in-flight attempt. Fixed-port MCP disconnect closes only its
adapter; ephemeral MCP shutdown also awaits recording-aware Quit.

Limitations are explicit: forceful owner death bypasses cleanup. If the root
identity is missing/reused and session descendants remain, they are left alone
and cleanup fails. Arbitrary raw code that daemonizes and escapes both the session
and ancestry before observation is outside managed ownership. No durable orphan
adoption or hostile-process containment is claimed. Exited zombies are not live
audio processes; pidfds indicate exit and their descriptors/ports are released.

Primary references: [Linux process stat](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html),
[pidfd_open](https://man7.org/linux/man-pages/man2/pidfd_open.2.html), and
[Python pidfd signalling](https://docs.python.org/3/library/signal.html#signal.pidfd_send_signal).

## Inspection and System

Linux reads `/proc` directly, including TCP listeners, UDP endpoints and socket
inode ownership through process descriptors. IPv4/IPv6 addresses are decoded.
Processes whose descriptor/executable metadata is inaccessible remain unknown;
a bound socket with no accessible owning PID is never reported free. Read failure
makes the inspection unavailable. Inventory is observational and cannot grant
termination authority. Creation ticks are retained; no guessed wall-clock start
date is presented for OS inventory.

System identifies Linux/Windows, displays backend/device capabilities, and
distinguishes an unavailable inspection from an engine failure. Unknown inventory
does not display “No listener.” Missing/stale proof never produces a fully healthy
audio claim. Windows' conservative health behavior is retained. Linux and Windows
home-directory prefixes receive equivalent log redaction; arbitrary interpreter
output still requires review before sharing.

## Configuration and local state

Environment variables must be supplied by the shell, process launcher or MCP
configuration. **The backend does not automatically load `.env` files.** Use
absolute paths for overrides; relative overrides follow the process working
directory. Keep machine configuration out of Git.

Linux uses an SHA-256-derived workspace identifier based on the clone's absolute
path. Different checkouts do not silently share writable state. Moving a clone
changes that identifier; explicitly migrate state or configure stable overrides.

| Variable | Linux default / meaning |
| --- | --- |
| `TIDAL_HOME` | Repository root derived from module location |
| `TIDAL_SCLANG` | `sclang` discovered on PATH |
| `TIDAL_SCSYNTH` | `scsynth` discovered on PATH; sets SC's server program |
| `TIDAL_GHCI` | GHCup's executable if present, then PATH `ghci` |
| `TIDAL_GHCUP` | `~/.ghcup`; no MSYS2 paths on Linux |
| `CABAL_DIR` | Inherited only if explicitly set; otherwise cabal's native defaults |
| `TIDAL_DIRT_SAMPLES` | `$XDG_DATA_HOME/SuperCollider/downloaded-quarks/Dirt-Samples` |
| `TIDAL_SC_BACKEND` | `jack` on Linux, `portaudio` on Windows; explicit capability declaration, not autodetection |
| `TIDAL_AUDIO_DEVICE` | PortAudio startup fallback when the device file is absent/empty |
| `TIDAL_AUDIO_DEVICE_FILE` | `$XDG_CONFIG_HOME/astros-beatbox/<workspace>/audio_device.txt` |
| `TIDAL_PROJECTS_DIR` | `$XDG_DATA_HOME/astros-beatbox/<workspace>/projects` |
| `TIDAL_RECORDINGS_DIR` | `$XDG_DATA_HOME/astros-beatbox/<workspace>/recordings` |
| `TIDAL_SETS_DIR` | `$XDG_DATA_HOME/astros-beatbox/<workspace>/sets` for personal classic exports |
| `TIDAL_RECOVERY_DIR` | `$XDG_STATE_HOME/astros-beatbox/<workspace>`; checkpoints and runtime.log |
| `TIDAL_DASH_PORT` | 3737; zero explicitly selects ephemeral MCP mode |
| `TIDAL_METER_PORT` | 57199; zero is useful for isolated non-audio tests |
| `TIDAL_SCOPE`, `TIDAL_SCOPE_HZ`, `TIDAL_SCOPE_N`, `TIDAL_SCOPE_MS` | Existing optional scope controls; defaults unchanged |

Unset/relative XDG variables fall back to `~/.local/share`, `~/.local/state`,
`~/.config`. Windows retains its existing repository storage and external-tool
defaults. Node discovers/interprets executables, but does not install Tidal,
SuperDirt, cabal libraries or samples automatically. Missing programs report
their executable name; configure the corresponding override or install the
documented toolchain. Sample availability is reported by the existing catalogue.

Project storage rejects a case-only spelling collision (`Jam` versus `jam`) and
asks for the existing spelling; it never silently overwrites that other jam.
Use portable filenames when moving personal sessions. Samples remain identified
by relative names and fingerprints. Recovery/catalogues are single-writer storage.
The included `sets/` examples remain tracked source; Linux personal exports use
XDG storage unless explicitly overridden.

## Native audio setup plan — not yet validated

The machine has active PipeWire / pipewire-pulse / WirePlumber and an ALSA
`sof-hda-dsp` device. This does not prove SC routing or audible output. The intended
initial setup uses distro SuperCollider's JACK backend through PipeWire's JACK
compatibility library, without replacing the desktop audio service or forcing
global rate/period settings. Device enumeration/selection is unavailable in this
mode and the application does not call `ServerOptions.devices`.

Linux leaves sample rate and hardware buffer size to the audio backend. Windows
retains validated 48 kHz / 480-frame configuration and WASAPI preference. An
explicit `TIDAL_SC_BACKEND=portaudio` is only appropriate for an actual PortAudio
build; the variable cannot change the backend compiled into SuperCollider.
See [SuperCollider backend/device API limitations](https://doc.sccode.org/Classes/ServerOptions.html)
and [Tidal's Linux prerequisites](https://tidalcycles.org/docs/getting-started/linux_install/).

Proposed Ubuntu 24.04 package versions, inspected from this machine's apt metadata:

| Component | Version |
| --- | --- |
| supercollider-language/server | `1:3.13.0+repack-1ubuntu3` |
| sc3-plugins-language/server | `3.9.1~repack-4build1` |
| GHC | `9.4.7-3` |
| cabal-install | `3.8.1.0-1` |
| pipewire-jack | `1.0.5-1ubuntu3.3` |
| Tidal | Repository's `1.10` baseline; resolve and record exact package version/plan before installation |
| SuperDirt | Proposed `v1.7.4`, tag `c7f32998572984705d340e7c1b9ed9ad998a39b6` |
| Dirt-Samples | Proposed commit `c74fc80f8db8038f6a33648ffef5ac00a07ad402` |
| Vowel | Proposed commit `ab59caa870201ecf2604b3efdd2196e21a8b5446` |

SC 3.13 meets README's declared minimum but differs from the Windows-validated
3.14.1. These Linux versions are **a setup candidate, not accepted compatibility
evidence**. No exact Windows GHC/cabal/quark revisions were recorded in P2.5.
Review Tidal's resolved cabal dependencies and capture its installation plan;
do not use an unconstrained “latest” install or represent this candidate as a lock.

Before installation, `sudo dpkg --audit` reported the pre-existing half-configured
`linux-image-7.0.0-28-generic`. The apt dry run would also configure unrelated
pending kernel packages. No apt installation, kernel repair, audio-service change,
group/permission change or global Node replacement was performed for P2.6.
Resolve that machine-maintenance issue separately, then recheck an apt simulation.

After the package database is healthy, install only the selected dependencies,
pin user quark/sample checkouts, establish Tidal's library environment and verify
reported versions. Use a local launcher environment for PipeWire/JACK if required;
inspect the actual server routing and build before choosing it. Do not start a
second JACK server over the existing desktop stack by assumption.

Tier C then requires real sclang/scsynth/GHCi/Tidal boot, samples, audible playback,
Preview, simultaneous Preview exclusion and non-silent project WAV, frontend/MCP
reconnect, Restart Audio and clean Quit with owned-process/port-release evidence.
Run live tests sequentially, retain diagnostics, and keep Windows evidence separate.

## Validation and remaining work

See `tasks/TASK-2.6.md` and `docs/p26-validation.json`. Installed locally: the
user-level nvm Node/npm baseline, locked npm dependencies and Playwright Chromium.
`npm ci` reported six existing dependency advisories; no unrelated dependency
upgrade or automatic audit fix was performed. No system packages were installed.

CI now runs the shared suite and browser journeys on Ubuntu and Windows, with the
Linux runtime harness only on Ubuntu. Windows CI is useful regression evidence,
but cannot replace the real desktop/browser/audio acceptance gate.

Native audio and the Windows gate remain open. The P2 silent-take residual risk
and all existing recording diagnostics/acceptance assertions are retained.
No P3 task specification or feature implementation was introduced.
