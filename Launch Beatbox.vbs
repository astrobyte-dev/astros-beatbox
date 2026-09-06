Option Explicit
Dim shell, fs, root, node, result, message, launchArgs
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
node = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fs.FileExists(node) Then node = "node.exe"
If Not fs.FileExists(root & "\mcp\dist\launcher.js") Then
  MsgBox "Build Beatbox first: run npm install and npm run build in the mcp folder.", 48, "Astro's Beatbox"
  WScript.Quit 1
End If
' Window style 0 applies at creation. No CMD/PowerShell wrapper or hide-after-launch.
launchArgs = " --open"
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--no-open" Then launchArgs = ""
End If
result = shell.Run("""" & node & """ """ & root & "\mcp\dist\launcher.js""" & launchArgs, 0, True)
If result <> 0 Then
  message = "Beatbox could not start. Check that Node.js is installed."
  If fs.FileExists(root & "\mcp\launch-error.txt") Then message = fs.OpenTextFile(root & "\mcp\launch-error.txt", 1).ReadAll
  MsgBox message, 48, "Astro's Beatbox"
End If
