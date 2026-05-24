// Minimal: call s.boot at TOP LEVEL (no fork/clock). Does scsynth spawn detached?
s = Server.default;
s.options.device = "FlexASIO";
s.options.numInputBusChannels = 0;
s.options.numOutputBusChannels = 2;
s.options.sampleRate = 48000;
"CALLING_BOOT".postln;
s.boot;
"BOOT_CALLED".postln;
