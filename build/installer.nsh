; 예전 버전이 다른 파일과 섞인 폴더(예: 소스 폴더)에 설치돼 있으면 그 경로를 기억해 둔다.
!ifndef BUILD_UNINSTALLER
  Var daylineOldDir
!endif

; Dayline 설치·제거 전에 실행 중인 Dayline을 확실히 끈다.
; (기본 방식은 사용자 이름 조건으로 프로세스를 찾는데, 일부 PC에서 강제 종료가 실패함)
!macro customCheckAppRunning
  StrCpy $R1 0
  ${Do}
    nsExec::Exec '"$SYSDIR\cmd.exe" /c tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO csv | "$SYSDIR\find.exe" /I "${APP_EXECUTABLE_FILENAME}"'
    Pop $R0
    ${If} $R0 != 0
      ${Break}
    ${EndIf}
    ${If} $R1 == 0
      DetailPrint "실행 중인 Dayline을 종료하는 중..."
      ; 1) 저장을 마치고 스스로 꺼지도록 요청 (0.1.2부터 지원)
      !ifndef BUILD_UNINSTALLER
        StrCpy $R2 $daylineOldDir
      !else
        StrCpy $R2 ""
      !endif
      ${If} $R2 != ""
      ${AndIf} ${FileExists} "$R2\${APP_EXECUTABLE_FILENAME}"
        nsExec::Exec '"$R2\${APP_EXECUTABLE_FILENAME}" --quit'
        Pop $R0
        Sleep 2000
      ${ElseIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        nsExec::Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit'
        Pop $R0
        Sleep 2000
      ${EndIf}
    ${Else}
      ; 2) 남아 있으면 강제 종료
      nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $R0
      Sleep 1000
      ${If} $R1 >= 3
        nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-Process -Name Dayline -ErrorAction SilentlyContinue | Stop-Process -Force"'
        Pop $R0
        Sleep 1000
      ${EndIf}
      ${If} $R1 >= 5
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Dayline이 아직 실행 중이에요.$\r$\n작업 표시줄 오른쪽 트레이에서 Dayline을 종료하거나, 작업 관리자에서 Dayline을 끝낸 뒤 [다시 시도]를 눌러 주세요." /SD IDCANCEL IDRETRY +2
        Quit
        StrCpy $R1 0
      ${EndIf}
    ${EndIf}
    IntOp $R1 $R1 + 1
  ${Loop}
!macroend

; 설치 폴더에 Dayline이 아닌 파일(소스 등)이 있으면 그 폴더는 건드리지 않는다.
; - 예전 제거 프로그램(폴더를 통째로 지움)이 돌지 않도록 설치 기록을 지우고
; - 기본 위치(%LOCALAPPDATA%\Programs\Dayline)에 새로 설치한다.
!ifndef BUILD_UNINSTALLER
!macro customInit
  StrCpy $daylineOldDir ""
  ${If} ${FileExists} "$INSTDIR\package.json"
  ${OrIf} ${FileExists} "$INSTDIR\index.html"
  ${OrIf} ${FileExists} "$INSTDIR\.git\*.*"
  ${OrIf} ${FileExists} "$INSTDIR\js\*.*"
    StrCpy $daylineOldDir "$INSTDIR"
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    !endif
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
  ${EndIf}
!macroend

; 위 경우, 옛 폴더에 남은 Dayline 실행 파일만 이름을 하나씩 지정해 지운다(다른 파일은 그대로).
!macro customInstall
  ${If} $daylineOldDir != ""
    DetailPrint "예전 설치 위치에서 Dayline 실행 파일만 정리하는 중..."
    !insertmacro daylineRemoveAppFiles "$daylineOldDir"
  ${EndIf}
!macroend
!endif

; 제거·업데이트할 때 폴더를 통째로 지우지 않고 Dayline 파일만 지운다.
!macro customRemoveFiles
  !insertmacro daylineRemoveAppFiles "$INSTDIR"
  RMDir "$INSTDIR"
!macroend

!macro daylineRemoveAppFiles DIR
  Delete "${DIR}\${APP_EXECUTABLE_FILENAME}"
  Delete "${DIR}\${UNINSTALL_FILENAME}"
  Delete "${DIR}\uninstallerIcon.ico"
  Delete "${DIR}\LICENSE.electron.txt"
  Delete "${DIR}\LICENSES.chromium.html"
  Delete "${DIR}\chrome_100_percent.pak"
  Delete "${DIR}\chrome_200_percent.pak"
  Delete "${DIR}\resources.pak"
  Delete "${DIR}\d3dcompiler_47.dll"
  Delete "${DIR}\ffmpeg.dll"
  Delete "${DIR}\libEGL.dll"
  Delete "${DIR}\libGLESv2.dll"
  Delete "${DIR}\vk_swiftshader.dll"
  Delete "${DIR}\vulkan-1.dll"
  Delete "${DIR}\vk_swiftshader_icd.json"
  Delete "${DIR}\icudtl.dat"
  Delete "${DIR}\snapshot_blob.bin"
  Delete "${DIR}\v8_context_snapshot.bin"
  Delete "${DIR}\locales\*.pak"
  RMDir "${DIR}\locales"
  Delete "${DIR}\resources\app.asar"
  RMDir /r "${DIR}\resources\app.asar.unpacked"
  Delete "${DIR}\resources\app-update.yml"
  Delete "${DIR}\resources\elevate.exe"
  RMDir "${DIR}\resources"
!macroend
