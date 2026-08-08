Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\serve.ps1""", 1, False
WScript.Sleep 1500
sh.Run "http://127.0.0.1:8765/", 1, False