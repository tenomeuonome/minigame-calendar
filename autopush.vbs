' GameCenterEG: run autopush.js without a console window (Task Scheduler, every 10 min)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\d_ymz\Desktop\develop\minigame-calendar"
sh.Run "node autopush.js", 0, True
