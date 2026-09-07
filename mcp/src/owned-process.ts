import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readLinuxIdentity } from "./linux-process.js";

export interface ProcessIdentity { pid: number; started: string }
const linuxHelper = fileURLToPath(new URL("../linux-stop.py", import.meta.url));
export function checkOwnershipSupport(): void {
  if (process.platform === "linux") execFileSync("python3", [linuxHelper, "--check"], { timeout: 5000, stdio: "pipe" });
  else if (process.platform !== "win32") throw new Error("Managed audio ownership is unsupported on this platform");
}
export function captureOwnedIdentity(pid: number): ProcessIdentity {
  if (process.platform === "win32") return identifyOwnedProcess(pid);
  if (process.platform !== "linux") throw new Error("Managed audio ownership is unsupported on this platform");
  const p = readLinuxIdentity(pid);
  if (p.group !== pid || p.session !== pid) throw new Error("Audio child has no dedicated Linux session");
  return { pid, started: p.started };
}
export function stopManagedTree(identity: ProcessIdentity, grace = 2, timeout = 6): void {
  if (process.platform === "win32") return stopOwnedProcessTree(identity);
  if (process.platform !== "linux") throw new Error("Managed audio cleanup is unsupported on this platform");
  if (!(grace >= 0 && timeout > 0 && timeout <= 30)) throw new Error("Invalid cleanup deadline");
  try { execFileSync("python3", [linuxHelper, JSON.stringify(identity), String(grace), String(timeout)], { timeout: (timeout + 2) * 1000, encoding: "utf8", stdio: "pipe" }); }
  catch (e) { throw new Error("Linux owned-process cleanup unconfirmed: " + String((e as { stderr?: string }).stderr || e)); }
}
function powershell(script: string): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 15000 }).trim();
}

// Called only for a still-live ChildProcess spawned by this application. Record
// creation time as well as PID so later PID reuse never grants ownership.
export function identifyOwnedProcess(pid: number): ProcessIdentity {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid owned PID");
  const started = powershell(`$ErrorActionPreference='Stop'; $p=[Diagnostics.Process]::GetProcessById(${pid}); $null=$p.Handle; $p.StartTime.ToUniversalTime().Ticks.ToString()`);
  if (!/^\d+$/.test(started)) throw new Error("Cannot establish process identity");
  return { pid, started };
}

export function stopOwnedProcessTree(identity: ProcessIdentity): void {
  if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0 || !/^\d+$/.test(identity.started)) throw new Error("Invalid process identity");
  // Open handles before checking identities and keep them through Kill(). Never
  // taskkill a PID/name, and never use a matching port as proof of ownership.
  powershell(`
$ErrorActionPreference='Stop'
try { $root=[Diagnostics.Process]::GetProcessById(${identity.pid}); $null=$root.Handle } catch { exit 0 }
if ($root.StartTime.ToUniversalTime().Ticks.ToString() -ne '${identity.started}') { exit 0 }
$rows=@(Get-CimInstance Win32_Process)
$owned=New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
$owned.Add($root)
for ($i=0; $i -lt $owned.Count; $i++) {
  $parent=$owned[$i]
  foreach ($row in $rows) {
    if ($row.ParentProcessId -eq $parent.Id) {
      try {
        $child=[Diagnostics.Process]::GetProcessById($row.ProcessId); $null=$child.Handle
        if ($child.StartTime.ToUniversalTime().Ticks -ge $parent.StartTime.ToUniversalTime().Ticks -and
            [Math]::Abs(($child.StartTime.ToUniversalTime() - $row.CreationDate.ToUniversalTime()).TotalMilliseconds) -lt 1) { $owned.Add($child) }
      } catch { }
    }
  }
}
$failed=New-Object 'System.Collections.Generic.List[string]'
for ($i=$owned.Count-1; $i -ge 0; $i--) {
  try { if (-not $owned[$i].HasExited) { $owned[$i].Kill(); if (-not $owned[$i].WaitForExit(3000)) { $failed.Add("Owned process did not exit: " + $owned[$i].Id) } } }
  catch { if (-not $owned[$i].HasExited) { $failed.Add($_.Exception.Message) } }
  finally { $owned[$i].Dispose() }
}
if ($failed.Count -gt 0) { throw ($failed -join '; ') }
`);
}
