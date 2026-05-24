-- Post-boot commands piped to GHCi after BootTidal.hs.
-- Plays a clear groove through SuperDirt for ~9s, then stops and quits.
setcps 0.575
d1 $ stack [ sound "bd*4", sound "~ cp" # gain 0.9, sound "hh*8" # gain 0.6 ]
import Control.Concurrent
threadDelay 9000000
hush
threadDelay 1000000
:quit
