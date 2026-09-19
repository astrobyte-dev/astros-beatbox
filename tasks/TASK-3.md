You are continuing the redevelopment of Astro's Beatbox.

The active development branch is:

feat/p3-composition-performance

It is intentionally stacked on:

feat/p2.6-ubuntu-portability

P2.6 remains:
- Level B - Ubuntu Runtime Safe
- draft PR #4
- unmerged
- Windows revalidation pending

Do not alter or falsely close that acceptance state.

You are now responsible for implementing:

# P3 - Composition & Performance

P3 should turn Astro's Beatbox from a powerful groove editor into a musical performance and composition environment.

The key idea is:

A user should be able to build several musical moments, move between them fluidly, arrange them into a larger performance, automate movement, and retain access to the underlying Tidal depth without the browser becoming the musical clock.

Do not begin P3.5 Sound Lab.

---

# 0. VERIFY THE DEVELOPMENT BASE

Before modifying anything:

1. Confirm the operating system.
2. Confirm current branch is:

   feat/p3-composition-performance

3. Confirm its base is the P2.6 head:

   be2e73011bccbb19b6a2203ed1aabcd4f14ea186

4. Confirm working tree is clean.
5. Fetch current remote state.
6. Inspect:
   - HANDOFF.md
   - tasks/TASK-2.6.md
   - docs/p0a-command-boundary.md
   - docs/p0b-project-model.md
   - docs/p1-studio.md
   - docs/p2-creative-loop.md
   - docs/p25-runtime-control-center.md
   - docs/p26-ubuntu-portability.md
   - current canonical project model
   - current Studio
   - classic dashboard
   - engine/reconciler
   - compiler
   - automation
   - scene/arrangement remnants
   - managed-code support
   - persistence/history
   - MCP commands
   - existing tests

Treat the current repository as the source of truth.

Run the complete baseline:

- tests
- build
- both typechecks
- browser journeys available on Ubuntu

Do not begin implementation until the current baseline is known.

---

# 1. P3 PRODUCT GOAL

The user should be able to move naturally from:

“I have a groove”

to:

“I have several musical sections”

to:

“I can perform between them”

to:

“I can arrange them into something larger”

without needing to understand Tidal transition syntax or browser scheduling.

The P3 experience should support the musical mental model:

Groove
→ Lift
→ Drop
→ Breakdown
→ return / variation / ending

These names are examples, not rigid required templates.

The product should remain playful rather than becoming a traditional DAW timeline.

---

# 2. SCENES AS FIRST-CLASS MUSICAL OBJECTS

Complete the scene model introduced in P0b.

A Scene should represent a coherent musical moment.

A scene should reference tracks and clips by stable IDs.

It must never depend on:
- screen row number
- visual ordering
- current browser state
- transient component identity

Scene behavior should support:

- create scene
- rename scene
- duplicate scene
- reorder scenes
- delete scene safely
- launch scene
- queue scene
- repeat scene
- intentionally silence a track within a scene
- preserve track identity across scene changes
- preserve references after track reorder

Scene duplication should create independent musical material by default unless the existing canonical model explicitly supports intentional sharing.

Do not allow edits in one duplicated scene to unexpectedly mutate another merely because they share internal objects.

---

# 3. SCENE PERFORMANCE UX

Add a strong scene/performance strip to /studio.

The user should be able to see their sections at a glance.

Conceptually:

[ Groove ] [ Lift ] [ Drop ] [ Breakdown ] [ + ]

The actual visual implementation should fit the established Studio design language.

For each scene make clear:

- current scene
- queued scene
- upcoming transition
- scene name
- relevant duration/repeat information
- whether the scene contains intentional silence

A queued scene should communicate something human-readable such as:

Next bar
Next cycle
Queued

rather than exposing raw timing internals unless requested.

Scene launch should feel confident and musical.

Avoid accidental double-triggering from repeated clicks.

---

# 4. MUSICAL CLOCK OWNERSHIP

This is critical.

The browser must NOT own arrangement or scene timing.

Do not use:
- requestAnimationFrame
- UI timers
- setTimeout-based musical scheduling

as the authoritative scene advancement mechanism.

Scene transitions and arrangement timing must use the existing Tidal musical clock / engine timing capabilities where appropriate.

Build on Tidal's cycle-aligned transition mechanisms.

The browser may DISPLAY timing.

The engine must OWN musical timing.

Backgrounding, minimizing or closing the Studio must not stop an arrangement from advancing correctly.

---

# 5. SCENE TRANSITIONS

Implement dependable musical scene transitions.

At minimum support a safe initial transition model such as:

- immediate where explicitly appropriate
- next beat / cycle / bar boundary where musically appropriate

Use terminology consistent with Beatbox's existing timing model.

Do not add a huge transition-effects system yet.

The important behavior is:

I click Drop
→ Beatbox tells me it is queued
→ the change happens at the expected musical boundary
→ all affected managed tracks change coherently

Multi-track transitions should be prepared before replacement where possible.

Partial failure must not be silently described as successful.

Use existing P0a command truth guarantees.

---

# 6. ARRANGEMENT

Implement a lightweight arrangement model using scenes.

This should not become a conventional DAW timeline.

An arrangement could conceptually be:

Groove     x4
Lift       x2
Drop       x8
Breakdown  x4
Drop       x8

Use:

- stable scene IDs
- repeat counts
- ordering
- loop state where supported

Scene display order and arrangement identity must remain separate.

Reordering the scene library must not corrupt the arrangement.

Support:

- add scene to arrangement
- reorder arrangement entries
- set repeats
- remove entry
- play arrangement
- stop arrangement
- optionally loop arrangement
- return to manual scene performance

Arrangement playback must remain correct when:

- browser is backgrounded
- Studio reconnects
- frontend closes
- tempo changes where supported
- silent sections occur

Do not make the browser advance arrangement entries.

---

# 7. PERFORMANCE MODE

Introduce a focused performance presentation where appropriate.

Do not build an entirely separate application.

The goal is to make the most useful live controls easy to access:

- scenes
- current/queued section
- transport
- useful track states
- key mixer controls
- recording
- relevant macro/automation state

Avoid presenting every editing control while performing.

The user should be able to jam between scenes without feeling like they are operating a database.

Keep the normal editing workspace available.

---

# 8. AUTOMATION

Complete the canonical automation model started earlier.

Automation should be authored musical data.

It must use stable targets rather than visual component identities.

Support useful P3 automation editing for existing managed parameters.

Examples may include:

- track/instrument parameters already supported
- effects parameters already supported
- mixer-related values where musically appropriate

Automation requirements:

- saved with the project
- scene/clip relationship is explicit
- survives track reorder
- survives save/reopen
- participates correctly in Undo/Redo
- disabling automation restores the stored base value
- multiple lanes cannot silently fight for the same target
- editing a parameter must not accidentally destroy its automation
- automation must not be browser-local authority

Use the existing P0b canonical model.

---

# 9. AUTOMATION UX

Make automation understandable.

Do not force the user to think in raw Tidal expressions.

Where appropriate show:

- parameter name
- motion/curve
- active/inactive state
- target instrument
- duration/cycle relationship

Automation should feel like:

“Make this control move”

rather than:

“Write a modulation program.”

Preserve deeper code visibility for users who want it.

Do not build the future Sound Lab modulation system yet.

---

# 10. MANAGED CODE TRACKS

P3 should properly integrate managed code workflows into Studio.

Preserve the architecture principle:

Visual track
- structured source of truth
- generated Tidal is a projection

Managed code track
- exact Tidal source preserved
- application guarantees only explicitly supported controls

Raw session console
- arbitrary execution
- bounded synchronization guarantees

Do not pretend arbitrary Tidal can always round-trip into visual editing.

---

# 11. CODE WORKFLOW

For managed code tracks:

- preserve exact source
- allow editing where current architecture safely supports it
- validate/prepare before replacing the playing version
- failed code must preserve the previous working musical state
- failed drafts remain available for correction
- dependency declarations survive persistence
- mixer/channel state remains independent of source code

Make code something discoverable and powerful, not required for ordinary composition.

Do not turn Studio back into a terminal-first interface.

---

# 12. EXTERNALLY MODIFIED SESSIONS

Handle arbitrary/raw engine mutation honestly.

If untracked code changes the engine outside the managed project:

Do not silently pretend the visual project still perfectly represents playback.

Expose a clear state such as:

Externally modified

Provide safe actions such as:

- return to managed project
- inspect external state where possible

Do not automatically reverse-engineer arbitrary Haskell/Tidal execution.

Do not overwrite external changes without an explicit user action.

---

# 13. MCP + PERFORMANCE

Extend MCP structured operations where needed for P3.

Appropriate capabilities may include:

- get scenes
- create/duplicate scene
- apply scene edits
- launch/queue scene
- edit arrangement
- play arrangement
- edit supported automation
- edit managed code

Use project ID/revision protection.

A multi-track assistant action should remain one labelled transaction where appropriate.

MCP must not become a second composition authority.

---

# 14. UNDO / REDO

P3 musical actions should participate in meaningful project history.

Examples:

Duplicate scene
→ one Undo

Rename scene
→ one Undo

Reorder scenes
→ one Undo

Apply automation gesture
→ one Undo

MCP scene transformation
→ one Undo

Delete scene
→ restores its references appropriately

Launching a scene or playing an arrangement is performance state, not necessarily authored-history state.

Do not fill Undo history with transient transport actions.

---

# 15. SAVE / REOPEN

Complete P3 state must survive persistence.

Save/reopen must preserve:

- scenes
- scene names/order
- clip mappings
- intentional silence
- arrangement
- repeat counts
- arrangement loop state where authored
- automation
- managed code
- dependencies
- track identity
- mixer state
- assets

Runtime facts such as:

currently playing scene
queued transition
engine ready

must not be restored as if they are guaranteed truth after reopening.

Projects should reopen safely stopped unless the existing recovery contract specifies otherwise.

---

# 16. IMPORTANT RUNWAY FOR P3.5 SOUND LAB

P3 must NOT implement Sound Lab.

However, P3 should avoid architectural decisions that would make Sound Lab painful later.

Future P3.5 requirements are expected to include things such as:

- synthesizer-based tracks
- custom SuperCollider SynthDefs
- bass/synth/drum instruments
- user-imported samples
- effect chains
- mic/audio input
- modulation
- knobs/faders/XY controls
- instrument presets
- potentially loop/chop workflows

Therefore:

Do not hardcode the P3 composition model to assume:

“Every musical track is a sample triggered through the current sample library.”

Track/source identity should remain extensible enough that future sources could include concepts such as:

sample
synth
audio input
managed code

without replacing scene/arrangement architecture.

Do NOT implement those new source types yet.

Similarly:

Automation targets should use stable semantic parameter identities rather than direct React/component paths.

Future parameters may come from:
- synth controls
- FX modules
- audio input modules
- macro controls

Do not build those systems now.

Just avoid boxing the architecture into sample-only assumptions.

---

# 17. FUTURE FX COMPATIBILITY

Do not implement the future modular FX rack.

But preserve a clean distinction between:

musical source
→ source/instrument processing
→ channel mixer
→ master/output

where the current architecture supports it.

Do not make scene or automation design assume that all future effects must be represented by rewriting Tidal strings.

P3 should leave room for future engine-owned DSP modules.

Again:

DO NOT IMPLEMENT P3.5 HERE.

---

# 18. FUTURE JAM MODE COMPATIBILITY

P4 will likely introduce Jam/Exploration features such as:

- Make a Variation
- Keep / Change
- musical verbs
- macro controls
- variation history
- groove DNA
- constrained randomness
- performance experimentation

P3 scenes/history should be designed so future generated variations can be:

- duplicated
- compared
- undone
- promoted into scenes
- arranged

Do not implement generation now.

Just preserve stable scene/project semantics that make this possible later.

---

# 19. STUDIO VISUAL DESIGN

P3 should feel like a natural expansion of the P1/P2 Studio.

Reuse:

- existing design tokens
- typography
- spacing
- colors
- interaction language
- accessible controls

Do not create a separate DAW-looking design system.

The scene/arrangement experience should remain:

- tactile
- clear
- playful
- calm
- musical

Avoid dense spreadsheet-like arrangement interfaces.

Avoid turning the screen into Ableton Live.

Astro's Beatbox should retain its own identity.

---

# 20. ACCESSIBILITY

P3 additions must include:

- semantic controls
- keyboard-operable scenes
- clear focus states
- status text beyond colour
- understandable queued/current scene announcements
- accessible automation controls
- correct focus handling
- no drag-only arrangement functionality

Dragging may be offered as a shortcut, but there must be an accessible alternative.

---

# 21. UBUNTU DEVELOPMENT CONSTRAINTS

Ubuntu is the active development platform.

P2.6 Level B has validated Linux runtime lifecycle safety.

Native Linux audio remains UNVALIDATED.

Do not install or modify system audio packages merely to complete P3 unless explicitly approved.

Do not disturb the currently pending kernel/package state.

Use:

- deterministic/fake audio engine
- engine protocol tests
- browser tests
- domain/compiler tests
- timing fixtures

for development where native audio is unavailable.

Do not claim:

“real audio scene timing validated on Ubuntu”

unless it was actually validated with the native audio stack.

Be explicit about validation level.

---

# 22. WINDOWS STATUS

P2.6 Windows desktop revalidation is still pending because the Windows machine is unavailable.

Do not claim that gate has passed.

P3 is stacked on P2.6 intentionally.

Shared runtime/engine changes introduced by P3 must be tracked as requiring eventual Windows regression validation.

Do not merge directly to main.

If creating a PR:

- keep it draft
- target feat/p2.6-ubuntu-portability while P2.6 remains unmerged

Do not alter PR #4 acceptance status.

---

# 23. TESTING

Preserve every existing test.

Add meaningful P3 coverage including:

## Scenes

- stable IDs
- create
- duplicate
- delete
- rename
- reorder
- intentional silence
- track reorder integrity
- duplicated scene independence
- save/reopen

## Scene launching

- queued transition
- correct musical boundary
- multi-track application
- repeated launch deduplication
- stale project/revision rejection
- partial engine failure reporting

## Arrangement

- stable scene references
- reorder
- repeats
- loop
- silence
- tempo changes where supported
- browser background/close independence
- frontend reconnect
- project reopen

## Automation

- stable target IDs
- save/reopen
- base value restoration
- enable/disable
- collision prevention
- Undo/Redo
- external edits
- track reorder

## Managed code

- source preservation
- failed draft keeps previous working version
- dependencies
- unrelated mixer edits do not alter source
- external mutation state

## Synchronization

- Studio ↔ legacy
- Studio ↔ MCP
- stale revisions
- reconnect
- project switching
- queued actions for obsolete project do not apply

## Browser

Automate useful P3 journeys such as:

open project
→ duplicate Groove
→ rename duplicate Lift
→ edit Lift
→ launch Groove
→ queue Lift
→ observe transition
→ create Drop
→ arrange Groove/Lift/Drop
→ save
→ reopen
→ verify composition

Use deterministic timing/audio fixtures where native audio is unavailable.

---

# 24. PERFORMANCE / TIMING VALIDATION

Scene and arrangement timing are fundamental to P3.

Build deterministic timing tests that can establish:

- correct cycle boundary selection
- no browser ownership of scheduling
- transitions continue with no connected frontend
- queued state matches engine scheduling
- stale queue actions cannot apply to another project
- tempo changes behave according to defined semantics

Do not hide timing uncertainty behind arbitrary sleeps.

---

# 25. SCOPE LIMITS

This is P3 only.

DO NOT implement P3.5 Sound Lab.

Specifically do not add:

- new synth architecture
- custom instrument collection
- Dirty Bass synth
- 808 synth
- granular synth
- mic input
- audio input monitoring
- user sample-folder indexing expansion beyond what P3 requires
- modular FX rack
- drag/drop effect chain
- instrument preset system
- loop slicing/chopping
- MIDI controller mapping
- VST hosting
- Jam Mode
- Make a Variation
- Keep/Change
- generative fills
- macro Energy/Dirt/Chaos controls

Do not begin P4 or P5.

---

# 26. WORKING METHOD

Implement incrementally.

Suggested checkpoints:

A. Finish scene domain/invariants

B. Engine-clocked scene launch

C. Scene Studio UX

D. Arrangement domain + engine scheduling

E. Arrangement Studio UX

F. Canonical automation integration

G. Managed code workflow

H. MCP synchronization

I. Persistence/recovery validation

J. Full browser/timing review

Run relevant tests after every meaningful checkpoint.

Do not wait until the end.

Critically review the architecture as you implement.

If repository reality suggests a safer design than this prompt, make the safer engineering decision and explain it.

---

# 27. P3 EXIT CRITERIA

P3 is complete when:

- scenes are first-class canonical musical objects
- scenes retain meaning across track reorder
- scenes can be created, duplicated, named, reordered and deleted safely
- users can perform between scenes
- queued transitions occur at defined musical boundaries
- browser timing does not own musical scene advancement
- arrangements use stable scene references
- arrangements continue without the Studio controlling their clock
- automation is canonical, persistent and reversible
- managed code workflows are dependable
- arbitrary external mutation is represented honestly
- save/reopen preserves the P3 composition
- Studio/MCP/legacy remain synchronized
- P0a/P0b/P1/P2/P2.5/P2.6 guarantees are not intentionally regressed
- architecture remains extensible toward P3.5 Sound Lab
- no P3.5/P4/P5 features were implemented

---

# 28. COMPLETION VALIDATION

Before declaring P3 complete:

1. run the complete automated suite
2. run build
3. run both typechecks
4. run browser journeys
5. run deterministic scene timing validation
6. verify arrangement without connected browser
7. verify save/reopen
8. verify Undo/Redo
9. verify MCP synchronization
10. verify legacy synchronization where still supported
11. inspect Studio visually
12. critically review full diff
13. search specifically for browser-owned musical timers
14. search for sample-only assumptions that would obstruct P3.5
15. search for accidental second musical authorities
16. fix discovered issues
17. do not begin P3.5

---

# 29. COMPLETION REPORT

When finished report:

- P3 architecture implemented
- scene model
- scene launch/timing architecture
- arrangement model
- automation implementation
- managed-code workflow
- externally modified behavior
- Studio UX changes
- MCP changes
- persistence changes
- future Sound Lab compatibility decisions
- files added/modified
- tests added
- total automated results
- browser results
- timing validation
- Ubuntu validation level
- native audio validation status
- Windows regression status
- regressions discovered during final review
- remaining limitations
- working tree state
- whether a draft stacked PR was created
- exact P3 exit criteria status
- confirmation that P3.5 was not started

Begin by validating the branch and repository baseline.

Then implement P3 only.