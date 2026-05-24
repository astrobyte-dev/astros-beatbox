// Foreground self-test: boot SuperDirt and trigger 6 kicks via /dirt/play.
// Proves the sample engine + OSC trigger path (what Tidal drives) without Tidal.
(
s = Server.default;
s.options.device = "FlexASIO";
s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
s.options.sampleRate = 48000;
s.options.hardwareBufferSize = 480;
s.options.memSize = 8192 * 16;
s.options.numBuffers = 1024 * 256;
s.options.maxNodes = 1024 * 32;

fork {
    s.bootSync;
    "SERVER_BOOTED".postln;
    ~dirt = SuperDirt(2, s);
    ~dirt.loadSoundFiles;
    s.sync;
    ~dirt.start(57120, 0 ! 12);
    s.sync;
    "SUPERDIRT_READY".postln;
    (
        var m = NetAddr("127.0.0.1", 57120);
        6.do { |i|
            m.sendMsg("/dirt/play", "s", "bd", "orbit", 0, "gain", 1.1);
            ("kick " ++ (i+1)).postln;
            0.4.wait;
        };
    );
    1.wait;
    "SELFTEST_DONE".postln;
    s.quit;
    0.5.wait;
    0.exit;
};
)
