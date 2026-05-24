// Verify extensions compiled + list audio devices scsynth can use.
"VERIFY_BEGIN".postln;
("SuperDirt loaded: " ++ \SuperDirt.asClass.notNil).postln;
("Vowel loaded: "     ++ \Vowel.asClass.notNil).postln;
// a couple of sc3-plugins UGens (bass sound-design tools):
("Decimator (sc3p): "       ++ \Decimator.asClass.notNil).postln;
("Disintegrator (sc3p): "   ++ \Disintegrator.asClass.notNil).postln;
("SmoothDecimator (sc3p): " ++ \SmoothDecimator.asClass.notNil).postln;
"--- AUDIO DEVICES (for FlexASIO config) ---".postln;
ServerOptions.devices.do { |d, i| ("  [" ++ i ++ "] " ++ d).postln };
"--- default in/out ---".postln;
("  inDevices:  " ++ ServerOptions.inDevices).postln;
("  outDevices: " ++ ServerOptions.outDevices).postln;
"VERIFY_END".postln;
0.exit;
