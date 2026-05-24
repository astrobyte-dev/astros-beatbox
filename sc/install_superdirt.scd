// Install SuperDirt (pulls Vowel + Dirt-Samples as dependencies).
"INSTALL_BEGIN".postln;
Quarks.install("SuperDirt");
"INSTALL_DONE".postln;
"--- installed quarks ---".postln;
Quarks.installed.do { |q| (q.name ++ "  ->  " ++ q.localPath).postln };
0.exit;
