; Remember the language picked on the installer's first page; the app starts in it
!macro customInstall
  StrCpy $1 "en"
  ${If} $LANGUAGE == 2052
    StrCpy $1 "zh"
  ${EndIf}
  FileOpen $0 "$INSTDIR\resources\install-lang.txt" w
  FileWrite $0 $1
  FileClose $0
!macroend
