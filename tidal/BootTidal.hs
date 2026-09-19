:set -fno-warn-orphans -Wno-type-defaults -XMultiParamTypeClasses -XOverloadedStrings
:set prompt ""

import Sound.Tidal.Boot
import qualified Control.Exception
import qualified System.IO

default (Rational, Integer, Double, Pattern String)

tidalInst <- mkTidal

instance Tidally where tidal = tidalInst

:set prompt-cont ""

-- Beatbox P3: a bounded preparation pass and one exception-safe play-map swap.
-- All slots share one engine-selected boundary, including intentionally silent slots.
-- This is Tidal 1.10's jump transition applied under its existing play-map lock.
import qualified Control.Concurrent.MVar as ABXMVar
import qualified Data.Map.Strict as ABXMap
import qualified Data.IORef as ABXRef
import qualified Sound.Tidal.Stream.Types as ABXStream
import Sound.Tidal.Pattern.Types (patternTimeID)
import qualified Sound.Tidal.Transition as ABXTransition

abxPending <- ABXRef.newIORef (Nothing :: Maybe Time)
-- Clear transition-cache metadata when returning to classic/manual playback.
let hush = ABXRef.writeIORef abxPending Nothing >> Sound.Tidal.Boot.hush

:{
let abxPrepare :: ControlPattern -> IO ()
    abxPrepare pat = do
      _ <- Control.Exception.evaluate (length (show (queryArc pat (Arc 0 2))))
      return ()
    abxInstall :: Bool -> (Time -> [(String, ControlPattern)]) -> IO ()
    abxInstall quantized build = do
      mapM_ (abxPrepare . snd) (build 0)
      at <- ABXMVar.modifyMVar (ABXStream.sPMapMV tidal) $ \old -> do
        now <- getnow
        pending <- ABXRef.readIORef abxPending
        let start = if quantized then fromIntegral (floor now + 1 :: Integer) else now
            transition pat previous = if quantized then ABXTransition.jumpIn' 0 now [pat, previous] else pat
            entry (key, pat) = let previous = ABXMap.findWithDefault (ABXStream.PlayState silence False False []) key old
                                  audible = if maybe False (now >=) pending then case ABXStream.psHistory previous of { pat0 : _ -> pat0; [] -> ABXStream.psPattern previous } else ABXStream.psPattern previous
                                  routed = withQueryControls (ABXMap.insert patternTimeID (VR start)) (pat # pS "_id_" (pure key))
                              in (key, previous { ABXStream.psPattern = transition routed audible, ABXStream.psHistory = [routed], ABXStream.psMute = False, ABXStream.psSolo = False })
            entries = map entry (build start)
        mapM_ (abxPrepare . ABXStream.psPattern . snd) entries
        checked <- getnow
        if quantized && checked >= start then ioError (userError "Preparation crossed the selected cycle; launch again") else return ()
        ABXRef.writeIORef abxPending (Just start)
        return (ABXMap.union (ABXMap.fromList entries) old, start)
      putStrLn ("ABX_SCHEDULED " ++ show (fromRational at :: Double))
:}

:set prompt "tidal> "
