; Twirly NSIS hooks (included by electron-builder).

!macro customInit
  ; Stop a running Twirly and its input helper so files can be replaced.
  nsExec::Exec 'taskkill /F /IM TwirlyHelper.exe'
!macroend

!macro customUnInstall
  ; Remove the optional per-user "Open with Twirly" Explorer verb and the login item.
  DeleteRegKey HKCU "Software\Classes\*\shell\Twirly"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "dev.twirly.app"
  nsExec::Exec 'taskkill /F /IM TwirlyHelper.exe'
!macroend
