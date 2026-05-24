// Boot scsynth through FlexASIO and play a short test tone.
(
s = Server.local;
s.options.device = "FlexASIO";
s.options.numInputBusChannels = 0;   // matches FlexASIO input-disabled
s.options.numOutputBusChannels = 2;
s.options.sampleRate = 48000;
s.options.hardwareBufferSize = 480;

fork {
    "BOOTING_SERVER".postln;
    s.bootSync;
    "SERVER_BOOTED".postln;
    s.sync;
    // gentle stereo test tone, ~2s, with fade in/out so it isn't a click
    {
        var env = EnvGen.kr(Env.linen(0.08, 1.8, 0.5), doneAction: 2);
        var sig = SinOsc.ar([220, 330], 0, 0.18);
        (sig * env);
    }.play;
    "TONE_PLAYING".postln;
    3.wait;
    "TONE_DONE".postln;
    s.quit;
    0.5.wait;
    "EXITING".postln;
    0.exit;
};
)
