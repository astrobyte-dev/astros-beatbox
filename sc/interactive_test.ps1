# Test MCP sclang-driving mechanism with correct execute protocol:
#   send: <code>\n <0x0C>\n   (newline flushes line-read; form-feed evaluates buffer)
# Readiness proven by scsynth process + an execution-only marker (built via ++ so the
# echoed source text can't match it).
$exe = "C:\Program Files\SuperCollider-3.14.1\sclang.exe"
$outFile = "C:\Users\thr3e\livecoding\sc\interactive.log"
if (Test-Path $outFile) { Remove-Item $outFile -Force }
New-Item -ItemType File -Path $outFile | Out-Null

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$p = New-Object System.Diagnostics.Process
$p.StartInfo = $psi
$action = { if ($EventArgs.Data -ne $null) { Add-Content -Path $Event.MessageData -Value $EventArgs.Data } }
Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action $action -MessageData $outFile | Out-Null
Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived  -Action $action -MessageData $outFile | Out-Null
$p.Start() | Out-Null
$p.BeginOutputReadLine()
$p.BeginErrorReadLine()

$NL = "`n"
$FF = [string][char]0x0c
function Send-SC([string]$code) {
  $p.StandardInput.Write($code + $NL + $FF + $NL)
  $p.StandardInput.Flush()
}

Start-Sleep -Seconds 6   # class library compile

# marker "RDYTOKEN8842" is assembled at runtime, so the echoed source can't contain it verbatim
$boot = '( s = Server.default; s.options.device = "FlexASIO"; s.options.numInputBusChannels = 0; s.options.numOutputBusChannels = 2; s.options.sampleRate = 48000; s.options.hardwareBufferSize = 480; s.options.memSize = 8192 * 16; s.options.numBuffers = 1024 * 256; s.options.maxNodes = 1024 * 32; Routine({ s.bootSync; ~dirt = SuperDirt(2, s); ~dirt.loadSoundFiles; s.sync; ~dirt.start(57120, 0 ! 12); s.sync; ("RDYTOKEN" ++ 8842).postln; }).play(SystemClock); )'
Send-SC $boot

$deadline = (Get-Date).AddSeconds(80)
$ready = $false
while ((Get-Date) -lt $deadline) {
  $c = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
  if ($c -and ($c -match "RDYTOKEN8842")) { $ready = $true; break }
  Start-Sleep -Milliseconds 1500
}
$scOn = (Get-Process scsynth -ErrorAction SilentlyContinue) -ne $null
"REAL_READY=$ready  scsynth_running=$scOn"

if ($ready) {
  1..6 | ForEach-Object {
    Send-SC 'NetAddr("127.0.0.1",57120).sendMsg("/dirt/play","s","bd","orbit",0,"gain",1.1);'
    Start-Sleep -Milliseconds 420
  }
  Start-Sleep -Seconds 1
}

"--- output tail ---"
Get-Content $outFile -Tail 12 -ErrorAction SilentlyContinue

try { $p.StandardInput.Close() } catch {}
Start-Sleep -Milliseconds 500
if (-not $p.HasExited) { $p.Kill() }
Get-Process scsynth,sclang -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-EventSubscriber | Unregister-Event -ErrorAction SilentlyContinue
"TEST_COMPLETE"
