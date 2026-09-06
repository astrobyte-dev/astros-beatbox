Option Explicit
Dim url, allowed, desktop
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
url = WScript.Arguments(0)
Set allowed = New RegExp
allowed.Pattern = "^http://127\.0\.0\.1:[0-9]+/studio(\?alreadyRunning=1)?$"
If Not allowed.Test(url) Then WScript.Quit 2
' The helper stays headless; the browser is explicitly shown normally.
' Explorer launched with a hidden show state can acknowledge without showing a tab.
Set desktop = CreateObject("Shell.Application")
desktop.ShellExecute url, "", "", "open", 1
