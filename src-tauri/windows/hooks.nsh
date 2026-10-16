; Installer hooks for Resonance (NSIS).
;
; Tauri has no `desktopShortcut` flag — checked against the config schema shipped with the CLI in this
; repo (@tauri-apps/cli 2.11.5): NsisConfig offers installerHooks and startMenuFolder and nothing about
; shortcuts, and WixConfig offers neither. An installer hook is the supported extension point.
;
; Two things need doing, and both come from the rename.
;
; ---- 1. The desktop shortcut -------------------------------------------------
;
; POSTINSTALL rather than PREINSTALL, because the hook has to run after the binary is on disk:
; CreateShortCut does nothing useful when the target is missing, and PREINSTALL runs before the files
; are copied. This install produced no desktop shortcut at all, which is the symptom.
;
; $INSTDIR\resonance.exe is the real installed filename (the Cargo crate name), not the product name —
; verified on disk rather than assumed from tauri.conf.json.
;
; $DESKTOP is NSIS's per-user desktop, which matches the default per-user install under %LOCALAPPDATA%.
;
; PREUNINSTALL deletes the shortcut again. It is not one of the installer's own, so the default
; uninstall pass would leave it pointing at a directory that no longer exists.

; ---- 2. Removing the previous install ----------------------------------------
;
; Tauri's NSIS installer identifies an existing installation by a registry key under
; HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall named after the product — confirmed on this
; machine, where the installed build registers under the key `Resonance`. Renaming the product therefore
; makes the new installer look at a key that does not exist, decide there is nothing to upgrade, and
; install alongside the old copy. The old one keeps its folder and its shortcut, so launching the app
; keeps starting the old version while the new one sits unused in the filesystem. That is exactly what
; happened.
;
; So the old key is looked for explicitly and the install it describes is removed first.
;
; Scope, deliberately narrow:
;
;   Only the `BetterSoundCloud` uninstall key is touched. That key belongs to this app's previous Tauri
;   builds; an unrelated program that happens to share the name is left alone.
;
;   Only $LOCALAPPDATA\BetterSoundCloud is deleted — the install directory. The user's settings, tokens
;   and history live in $APPDATA\BetterSoundCloud, a different directory, and the Go sidecar's
;   migrateLegacyDataDir carries those across on first launch. Nothing here touches them.

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BetterSoundCloud" "UninstallString"

  ${If} $0 != ""
    DetailPrint "Resonance: found a previous BetterSoundCloud install, removing it"

    ; A running old copy cannot be deleted, and this is exactly the case where the old version
    ; "comes back": the user launches it, then installs over it. Core NSIS only — nsExec and nsProcess
    ; are not part of the script Tauri's template is guaranteed to include.
    ExecWait 'taskkill /F /IM BetterSoundCloud.exe /T'

    ; Its own uninstaller first, so anything it knows how to clean up gets cleaned up. Then the folder
    ; regardless of how the uninstaller exited: a nested NSIS uninstaller is not reliably silent, and a
    ; half-removed previous install is the whole problem being fixed here.
    ExecWait '$0 /S'
    RMDir /r "$LOCALAPPDATA\BetterSoundCloud"

    ; Its desktop shortcut, for the same reason the old folder is removed unconditionally.
    Delete "$DESKTOP\BetterSoundCloud.lnk"

    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BetterSoundCloud"
    DetailPrint "Resonance: previous install removed"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$DESKTOP\Resonance.lnk" "$INSTDIR\resonance.exe" "" "$INSTDIR\resonance.exe,0"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\Resonance.lnk"
!macroend
