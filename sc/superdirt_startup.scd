// ============================================================================
//  SuperDirt startup for the live-coding rig (psy / trap / heavy bass)
//  Boots scsynth on FlexASIO -> FiiO K11, loads samples, opens 12 orbits,
//  and listens for Tidal on OSC port 57120.
//
//  HEADLESS-SAFE: uses Routine(...).play(SystemClock) -- NOT fork/waitForBoot,
//  which schedule on AppClock and do NOT tick when sclang runs headless
//  (spawned by the MCP / piped stdin). SystemClock ticks on its own thread.
//  Drive sclang by sending this code to stdin terminated by  \n <0x0C> \n.
// ============================================================================
(
// env vars (~x), NOT `var` — `var` is illegal inside a top-level ( ) block and
// breaks the whole file's compile (then scsynth never boots).
if(~devFile.isNil) { ~devFile = "audio_device.txt" };  // real path injected by the MCP before .load
~dev = if(File.exists(~devFile)) { File.readAllString(~devFile).stripWhiteSpace } { "" };
s = Server.default;
// WASAPI direct (not FlexASIO/ASIO): ASIO's callback needs a message pump that a
// Node-spawned process lacks, so the DSP stays frozen. WASAPI drives this fine headless.
// Output device is chosen by the dashboard (written to ~devFile): a device name =
// use it; "SYSTEM" = let the OS pick (leave nil); empty/absent = the default below.
if(~dev == "SYSTEM", {
    // leave s.options.device nil -> OS default device
}, {
    if(~dev.size > 0,
        { s.options.device = ~dev },
        { /* empty/absent -> OS default device; pick a "Windows WASAPI : <output>" in the dashboard for reliable headless audio */ }
    );
});
s.options.numInputBusChannels = 0;       // synthesis only
s.options.numOutputBusChannels = 2;
s.options.sampleRate = 48000;
s.options.hardwareBufferSize = 480;      // ~10ms; tighten via WASAPI exclusive later
s.options.memSize = 8192 * 16;           // 128 MB realtime memory (room for reverbs/FX)
s.options.numBuffers = 1024 * 256;       // enough buffers for the full sample library
s.options.maxNodes = 1024 * 32;
s.options.numWireBufs = 256;   // headroom for complex (bass) SynthDefs; 64 throws "exceeded interconnect buffers"

Routine({
    var numOrbits = 12;
    s.bootSync;
    ~dirt = SuperDirt(2, s);

    ~dirt.loadSoundFiles;                 // default Dirt-Samples
    // (to add your own samples later: ~dirt.loadSoundFiles("C:/path/to/samples/*");
    //  as a plain statement here — do NOT wrap a `var` in a nested ( ) inside this routine.)

    s.sync;
    ~dirt.start(57120, 0 ! numOrbits);    // OSC port 57120, 12 orbits

    s.sync;
    // Echo-proof ready marker: assembled at runtime so it can't match the echoed
    // source text (sclang echoes piped stdin). Driver waits for "SDIRT_RDY_7731".
    ("SDIRT_RDY_" ++ 7731).postln;
}).play(SystemClock);
);
