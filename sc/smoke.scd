// Headless smoke test: confirm sclang runs and report key paths.
"SCLANG_OK".postln;
("VERSION: " ++ Main.version).postln;
("EXTENSIONS_DIR: " ++ Platform.userExtensionDir).postln;
("CONFIG_DIR: " ++ Platform.userConfigDir).postln;
("QUARKS_DIR: " ++ Quarks.folder).postln;
0.exit;
