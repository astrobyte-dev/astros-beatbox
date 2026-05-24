// Unmistakable test: 3-note ascending arpeggio + a held chord, through FlexASIO.
(
s = Server.local;
s.options.device = "FlexASIO";
s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
s.options.sampleRate = 48000;
s.options.hardwareBufferSize = 480;

fork {
    "BOOTING_SERVER".postln;
    s.bootSync;
    "SERVER_BOOTED".postln;
    s.sync;

    // tiny pluck synth
    SynthDef(\ping, { |freq = 440, amp = 0.2, pan = 0|
        var env = EnvGen.kr(Env.perc(0.005, 0.45), doneAction: 2);
        var sig = SinOsc.ar(freq, 0, amp) + (Saw.ar(freq) * 0.05);
        Out.ar(0, Pan2.ar(sig * env, pan));
    }).add;
    s.sync;

    // A3, C#4, E4 arpeggio
    [220, 277.18, 329.63].do { |f|
        Synth(\ping, [\freq, f, \amp, 0.25]);
        0.28.wait;
    };
    0.2.wait;
    // held A-major chord, gentle
    {
        var env = EnvGen.kr(Env.linen(0.05, 1.6, 0.6), doneAction: 2);
        var sig = Mix(SinOsc.ar([220, 277.18, 329.63, 440], 0, 0.12));
        Pan2.ar(sig * env, 0);
    }.play;
    "CHORD_PLAYING".postln;
    2.6.wait;

    "TONE_DONE".postln;
    s.quit;
    0.5.wait;
    0.exit;
};
)
