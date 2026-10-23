Option Explicit

Dim shell, files, projectDirectory, launcherPath, powershellPath, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
projectDirectory = files.GetParentFolderName(WScript.ScriptFullName)
launcherPath = files.BuildPath(projectDirectory, "scripts\reader-tray.ps1")
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")

If Not files.FileExists(launcherPath) Then
  MsgBox "Cannot find scripts\reader-tray.ps1. Keep start.vbs inside the project directory.", vbCritical, "I Love Work"
  WScript.Quit 1
End If

command = Quote(powershellPath) & " -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Quote(launcherPath)
shell.CurrentDirectory = projectDirectory
shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
