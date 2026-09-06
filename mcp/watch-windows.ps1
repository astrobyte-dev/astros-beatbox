param([Parameter(Mandatory=$true)][string]$OutputFile, [Parameter(Mandatory=$true)][string]$StopFile)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class BeatboxWindowWatch {
  delegate void WinEvent(IntPtr hook, uint evt, IntPtr hwnd, int obj, int child, uint thread, uint ms);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr mod,WinEvent callback,uint pid,uint thread,uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder name,int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  static WinEvent callback;
  public static void Run(string output, string stop) {
    using(var writer = new StreamWriter(output, false, new UTF8Encoding(false))) {
      writer.AutoFlush=true;
      callback=(hook,evt,hwnd,obj,child,thread,ms)=> {
        if(obj!=0 || child!=0 || hwnd==IntPtr.Zero) return;
        uint pid; GetWindowThreadProcessId(hwnd,out pid);
        var cls=new StringBuilder(256); GetClassName(hwnd,cls,256);
        var name="unknown"; try { using(var p=Process.GetProcessById((int)pid)) name=p.ProcessName; } catch {}
        // Capture no titles, user content, command lines or environment.
        writer.WriteLine(DateTime.UtcNow.ToString("o")+"\t"+pid+"\t"+name+"\t"+cls+"\t"+IsWindowVisible(hwnd));
      };
      var handle=SetWinEventHook(0x8002,0x8002,IntPtr.Zero,callback,0,0,0);
      if(handle==IntPtr.Zero) throw new Exception("Window show hook unavailable");
      Console.WriteLine("WATCH_READY");
      var end=DateTime.UtcNow.AddMinutes(15);
      try { while(!File.Exists(stop) && DateTime.UtcNow<end) { Application.DoEvents(); System.Threading.Thread.Sleep(5); } }
      finally { UnhookWinEvent(handle); }
    }
  }
}
'@
[BeatboxWindowWatch]::Run($OutputFile, $StopFile)
