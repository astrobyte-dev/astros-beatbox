# FULL CHAIN TEST: SuperDirt (sclang) + TidalCycles (ghci) -> beat through FlexASIO/K11.
# Writes stdin as raw UTF-8 bytes (no BOM) to avoid GHCi lexical errors.
$ErrorActionPreference = "Continue"
$sclang = "C:\Program Files\SuperCollider-3.14.1\sclang.exe"
$ghci   = "C:\ghcup\bin\ghci.exe"
$boottidal = "$PSScriptRoot\tidal\BootTidal.hs"
$scLog  = "$PSScriptRoot\sc_fc.log"
$tdLog  = "$PSScriptRoot\tidal_fc.log"
foreach ($f in @($scLog,$tdLog)) { if (Test-Path $f) { Remove-Item $f -Force }; New-Item -ItemType File -Path $f | Out-Null }

$env:PATH = "C:\ghcup\bin;C:\ghcup\msys64\mingw64\bin;" + $env:PATH
$env:CABAL_DIR = "C:\cabal"

$enc = New-Object System.Text.UTF8Encoding($false)   # no BOM

function New-Proc([string]$exe, [string]$procArgs, [string]$log) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  if ($procArgs) { $psi.Arguments = $procArgs }
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  try { $psi.StandardInputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $act = { if ($EventArgs.Data -ne $null) { Add-Content -Path $Event.MessageData -Value $EventArgs.Data } }
  Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $act -MessageData $log | Out-Null
  Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived  -Action $act -MessageData $log | Out-Null
  $proc.Start() | Out-Null
  $proc.BeginOutputReadLine()
  $proc.BeginErrorReadLine()
  return $proc
}

function Send([System.Diagnostics.Process]$proc, [string]$text) {
  $bytes = $enc.GetBytes($text)
  $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $proc.StandardInput.BaseStream.Flush()
}

$NL = "`n"; $FF = [string][char]0x0c

# ---- 1. boot SuperDirt ----
$sc = New-Proc $sclang $null $scLog
Start-Sleep -Seconds 6
$boot = '( s = Server.default; s.options.device = "FlexASIO"; s.options.numInputBusChannels = 0; s.options.numOutputBusChannels = 2; s.options.sampleRate = 48000; s.options.hardwareBufferSize = 480; s.options.memSize = 8192 * 16; s.options.numBuffers = 1024 * 256; s.options.maxNodes = 1024 * 32; Routine({ s.bootSync; ~dirt = SuperDirt(2, s); ~dirt.loadSoundFiles; s.sync; ~dirt.start(57120, 0 ! 12); s.sync; ("RDYTOKEN" ++ 8842).postln; }).play(SystemClock); )'
Send $sc ($boot + $NL + $FF + $NL)

$deadline = (Get-Date).AddSeconds(80); $ready = $false
while ((Get-Date) -lt $deadline) {
  $c = Get-Content $scLog -Raw -ErrorAction SilentlyContinue
  if ($c -and ($c -match "RDYTOKEN8842")) { $ready = $true; break }
  Start-Sleep -Milliseconds 1500
}
"SUPERDIRT_READY=$ready scsynth=$(((Get-Process scsynth -ErrorAction SilentlyContinue) -ne $null))"
if (-not $ready) { "ABORT: SuperDirt not ready"; if(-not $sc.HasExited){$sc.Kill()}; Get-EventSubscriber|Unregister-Event -EA SilentlyContinue; exit 1 }

# ---- 2. launch Tidal (ghci) ----
$td = New-Proc $ghci ('-ghci-script "{0}"' -f $boottidal) $tdLog
Start-Sleep -Seconds 5
Send $td $NL            # sacrificial first write: absorbs the .NET phantom BOM on line 1
Start-Sleep -Milliseconds 300
Send $td ("setcps 0.575" + $NL)
Start-Sleep -Milliseconds 300
Send $td ('d1 $ stack [ sound "bd*4", sound "~ cp" # gain 0.9, sound "hh*8" # gain 0.6 ]' + $NL)

"BEAT_PLAYING (10s)..."
Start-Sleep -Seconds 10

Send $td ("hush" + $NL)
Start-Sleep -Milliseconds 800
Send $td (":quit" + $NL)
Start-Sleep -Seconds 1

"--- tidal log tail ---"; Get-Content $tdLog -Tail 16 -ErrorAction SilentlyContinue

# ---- cleanup ----
try { $td.StandardInput.Close() } catch {}
try { $sc.StandardInput.Close() } catch {}
Start-Sleep -Milliseconds 600
foreach ($pr in @($td,$sc)) { if ($pr -and (-not $pr.HasExited)) { try { $pr.Kill() } catch {} } }
Get-Process scsynth,sclang,ghc,ghci -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-EventSubscriber | Unregister-Event -ErrorAction SilentlyContinue
"FULLCHAIN_TEST_COMPLETE"
