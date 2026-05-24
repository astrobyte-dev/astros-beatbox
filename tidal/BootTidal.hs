:set -fno-warn-orphans -Wno-type-defaults -XMultiParamTypeClasses -XOverloadedStrings
:set prompt ""

import Sound.Tidal.Boot

default (Rational, Integer, Double, Pattern String)

tidalInst <- mkTidal

instance Tidally where tidal = tidalInst

:set prompt "tidal> "
:set prompt-cont ""
