# Astro's Beatbox

**Play with sound.** Start with something you can hear, change a little, then keep
what you like. Your music and recordings stay on this computer.

## Your first minute

Open Studio and choose **Start Playing**. Beatbox prepares Pocket groove and starts
its four instruments. Audio preparation can take a while on the first start; the
transport shows preparation until the runtime confirms playback. Tap a rhythm pad
to add or remove a beat. Press Undo to bring the previous rhythm back.

For a quiet start, **Start Pocket groove** prepares the pads without playing.
**Open Existing** opens My Jams. **Explore Jam starts** offers a groove, a minimal
two-instrument start, or a surprise. Starters only work in an empty project.
If a session was recovered, check the recovery message and press Play yourself.

Tips stay out of your way: **Got it** dismisses them, including Jam suggestions.
Open **? → Show contextual tips** to bring them back. This preference belongs to
this browser; it is not musical state and does not affect Undo.

## Find your way around

| Place | What it does |
| --- | --- |
| Studio · Instruments | Edit rhythm pads and select a track |
| Studio · Mixer | Balance channel levels and mute tracks |
| Sound Lab | Shape the selected sample or synth, add FX and motion |
| Collection · Sounds / Synths | Browse installed samples or add an instrument |
| Collection · My Sounds / Capture | Import WAVs or record an input to use as a sample |
| Scenes & arrangement | Keep different rhythms and put sections in order |
| Perform | Launch scenes and follow an arrangement |
| Jam ✳ | Keep parts, make variations, compare ideas and move macros |
| My Jams / Recordings | Reopen complete projects or listen to finished takes |
| System | Check audio, look into a problem, restart or quit Beatbox |

The Sound Lab, Scenes and Rhythm details links bring their controls into view.
At smaller laptop widths Rhythm details is below the workspace. These links move
keyboard focus too, so the next Tab continues in the selected area.

## Rhythm and sound

Select an instrument by its name. Tap pads to toggle beats, or drag across them to
paint. Arrow keys move between pads; Space or Enter toggles the focused pad.
Rhythm details includes swing and the selected pad's velocity. A zero velocity is
silence. Mixer levels change channel balance without changing your pad velocities.

In **Sounds**, preview a sample, then Replace the selected instrument's sound.
Preview does not edit your rhythm or enter the project recording. Your rhythm,
effects and velocities remain. Use Undo to restore the previous source.

In **Synths**, adding an instrument also adds a first phrase. Sound Lab opens its
instrument controls. Try a patch, then a small Cutoff adjustment. Basic controls
come first; Advanced controls offers more depth. Drag knobs vertically, or use
arrows; Shift makes adjustments finer. Reset restores that control's default.
Release a knob or slider gesture to apply the change as one Undo.

**Notes** edits synth note sequences. On a sample track, the Instrument tab can
replace the sample with a synth. **FX** adds effects in order; the earlier/later
buttons reorder them and the enable switch bypasses an effect. FX and source
editing are separate from channel mixing. Patches you save belong to the project.

**Motion** can modulate a control or automate its movement with a clip. Modulated
and automated controls have text indicators as well as visual rings. Turning motion
off restores the underlying setting. Existing automation uses stepped values.

## Bring your own sounds

Open **My Sounds → Add Files** or **Add Folder**, review the selection and import.
The supported format is **PCM16 WAV, mono or stereo**, up to 15 minutes / 256 MiB
per sound. Float, 24-bit, MP3 and other formats need conversion before importing.
A batch accepts up to 100 WAVs and 1 GiB. Hidden and unsupported files are skipped.

Beatbox keeps a managed copy and detects duplicate content. Preview it, then choose
**Add track** or **Use on [instrument]**. Search names, tags or collections; filter
Captured, Recent, Favorites or Loops. Library details do not create musical Undo;
assigning the sound to your project does.

The Sample tab offers start/end trim, reverse, pitch and an envelope. Waveform
dragging and Start/End sliders do the same job. Your original stays intact.
Pitch changes speed and duration. **Loop phrase** changes how many beats the pad
phrase spans; it does not stretch the audio. **Chop to pads** creates regions of
the same sound. Preview a chop and choose which region each rhythm pad triggers.

## Capture → Keep → Use

Capture records an external input as a sound. **Rec** in the top bar records your
whole Beatbox performance instead.

1. Pause playback and finish any active recording. Choose an input and channel.
2. **Prepare input** restarts audio with that input. Availability depends on the
   audio backend; an unavailable device list is not a promise of working input.
3. Check input level and gain. Monitoring starts off; use headphones if you enable it.
4. Name the take and **Record input**, then **Stop capture**. Wait for finalization.
5. Preview the take and **Keep as Sample**. **Use this sound →** opens My Sounds;
   choose Captured and add or assign the sound.

Captures are dry mono input after gain, up to five minutes. Add track FX after
keeping the sound. An interrupted take is not represented as a completed sample.
System's Stop audio releases the prepared input.

## Explore in Jam

Enter **Jam ✳** with your current project. Keep a whole instrument, or open its
card and protect just rhythm, sound, FX or motion. Kept parts retain their sound
while you explore. Explicit Studio edits and Undo still work on those parts.

Choose what to change and an intensity: Small change, Fresh or Wild. **Make
Variation** changes eligible unprotected parts and explains what changed and what
was kept. Chaos uses the same bounds and locks. Musical actions such as Get Dirtier
and Strip Back are ordinary, undoable changes; unsupported actions are unavailable.

Earlier ideas appear beside the controls. **A / B** restores earlier full ideas,
including their locks. **Keep This** marks an idea in the current runtime session.
The trail holds up to twelve alternatives with bounded storage; kept capacity is
also limited. Save your favorite complete sounds as named jams before restarting
the runtime or opening another project. Closing the browser alone keeps the runtime.

**Find useful macros** offers controls for your current instruments and FX.
They preserve underlying settings. Release a gesture to apply it; synth changes
arrive on new notes. A kept control holds its current contribution until unlocked.
Star an instrument to put a link on Your bench.

**Save as Scene** keeps independent rhythms and clip motion. Instruments, FX and
macros are shared between scenes. Use **Save jam** for a complete sound alternative.
The optional event notebook keeps an ordered account of a performance. It does not
replay gestures or replace an audio recording.

## Scenes and performing

Scenes collect the rhythm for each instrument. In editing, choose a scene to work
on it; duplicate it for an independent rhythm. Empty scene assignments mean
intentional silence. Capture editing rhythm updates the selected scene.

Open **Arrange your sections**, add the selected scene, set repeats and reorder
with arrows. One cycle lasts the project's beats-per-cycle value. **Perform**
brings scene and arrangement controls forward. Launch queues a scene for the next
cycle; Current and Next cycle indicate the engine's reported state. An unavailable
clock means playback position cannot be confirmed.

Prepared performances keep a snapshot. Relaunch a scene/arrangement to hear later
composition edits; mix and tempo changes remain live. **Hear editing rhythm**
returns playback to the active instruments. **Back to editing** returns the layout.
These are distinct actions: changing the view does not secretly switch the music.

## Save, reopen and recover

The header always shows the project name and save observation: Not saved yet,
Unsaved changes, Saving, or Saved on this computer. A successful disk write is
required before Saved appears. After any authored revision, save again. Undo can
restore the same music but still creates a new revision that needs saving.

**Save jam** stores instruments, rhythms, scenes, effects, patches and mix together.
Its Save as field uses the current saved filename even if you rename the project
title. Enter another filename to save a copy; an existing filename shows a replacement
notice. Names use letters, numbers, hyphens and underscores. Letter-case collisions
are rejected to keep projects portable between Linux and Windows.

**My Jams** lists saved projects. Opening over unsaved music asks you to cancel and
save, or explicitly open without saving. Opening clears Undo and transient Jam
ideas, and the loaded project is stopped. Recovery checkpoints protect the most
recent acknowledged edits, but a recovered session is not a named saved project.

Projects reference imported sounds rather than embedding them. When moving music
to another computer, copy the project store's **audio directory and its sidecars**
along with the `.abx.json` projects. The recordings directory is separate. Missing
sounds keep their rhythm but play silently. In My Sounds, relink the exact original
WAV to repair an imported sound; for built-in sounds choose another installed sample.

## Recording and System

Press **Rec**, play your performance, then **Finish**. Wait for the finalized take
in Recordings; listen or download the WAV. Silent recordings remain valid files and
are labelled as silent. Preview audio is excluded. Opening another jam or Undo does
not remove recordings.

System explains readiness without requiring process IDs. Open service details or
Ports & ownership when diagnosing a problem. Logs stay local, with up to 800 recent
entries; pause, filter or copy them. Restart/Stop/Quit use owned process identities
and leave unrelated processes alone. System confirms disruptive operations and
finalizes active project recording first. Closing a browser tab does not quit.

The classic dashboard remains under System's **Compatibility tools** for raw code,
Tidal source import/export, output-device selection and legacy routing. Those
workflows do not all have Studio parity; externally changed playback is identified.

## Keyboard reference

| Keys | Action |
| --- | --- |
| Ctrl/⌘ + Space | Play / Pause |
| Ctrl/⌘ + Z | Undo |
| Ctrl/⌘ + Shift + Z | Redo |
| Ctrl/⌘ + S | Save jam dialog |
| ? | Help and shortcuts |
| Arrows on pads | Move between pads |
| Space / Enter on a pad | Toggle its beat |
| Arrows on knobs/sliders | Adjust value; Shift on knobs gives fine control |
| Home / End on a slider | Minimum / maximum |
| Escape | Cancel a draft or close a dialog |

Global shortcuts do not intercept text, selectors, sliders, code editors or dialogs.
All drag operations have controls you can use from the keyboard. Reduced-motion
preference removes animations and the moving beat strip; text still reports state.

## If something needs attention

| Situation | Next useful action |
| --- | --- |
| Opening Studio stalls | Reconnect, or open System to inspect the local runtime |
| No sound or playback failure | Check System's Audio and recent activity; save your jam before troubleshooting |
| Missing native dependency | Follow [installation prerequisites](../README.md#prerequisites) and the reported missing path; the UI does not install system software |
| Audio port conflict | Inspect ownership in System; close the conflicting application yourself if appropriate |
| Save failed | Keep the dialog open, check its error, free space or correct the filename; the current jam remains available |
| Missing sample | Choose another built-in sound, or relink the exact original in My Sounds |
| Waveform unavailable | Retry waveform; trim controls remain available, but this does not prove the audio file is present |
| Capture interrupted | Inspect System and the take error; discard the incomplete take and record again |
| Recording interrupted or silent | Inspect the take and System logs; a ready WAV and audible content are separate observations |
| Concurrent edit rejected | Review the current state and try your intended edit again; stale gestures are not silently reapplied |

Ubuntu supports development and verified runtime lifecycle (Level B). Native Linux
audio/microphone quality and timing remain unvalidated. Windows revalidation for
the stacked development phases also remains pending. Browser fixtures cannot close
these acceptance gates. See [platform status](p26-ubuntu-portability.md).
