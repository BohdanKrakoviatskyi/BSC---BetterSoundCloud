; Resonance - Windows installer (Inno Setup 6)
;
; Build:
;   ISCC.exe /DSourceDir=<staging dir with the installed app> /O<output dir> packaging\windows\resonance.iss
;
; The installer is per-user (no admin rights required) and installs to
; %LOCALAPPDATA%\Programs\Resonance, matching the layout produced by
; tools/build-windows.ps1.

#ifndef MyAppVersion
  #define MyAppVersion "0.3.0"
#endif

#ifndef SourceDir
  #define SourceDir "build\windows-package"
#endif

[Setup]
AppId={{7C4B2E19-5A6D-4F83-9B21-D0E6A4C8F357}
AppName=Resonance
AppVersion={#MyAppVersion}
AppPublisher=BohdanKrakoviatskyi
AppPublisherURL=https://github.com/BohdanKrakoviatskyi/BSC---BetterSoundCloud
DefaultDirName={localappdata}\Programs\Resonance
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=Resonance-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
SetupIconFile=resonance.ico
UninstallDisplayIcon={app}\resonance.ico
ArchitecturesAllowed=x64compatible
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs
Source: "resonance.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Resonance"; Filename: "{app}\bin\resonance.exe"; IconFilename: "{app}\resonance.ico"; Comment: "Resonance - SoundCloud client"
Name: "{autodesktop}\Resonance"; Filename: "{app}\bin\resonance.exe"; IconFilename: "{app}\resonance.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\vc_redist.x64.exe"; Description: "Install Visual C++ Runtime (only needed if the app reports missing DLLs)"; Flags: postinstall skipifsilent unchecked

[UninstallRun]
Filename: "taskkill"; Parameters: "/F /IM resonance.exe"; RunOnceId: "StopResonance"; Flags: runhidden
Filename: "taskkill"; Parameters: "/F /IM local-api.exe"; RunOnceId: "StopLocalApi"; Flags: runhidden

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  // Make sure no running copy blocks the file copy.
  Exec('taskkill', '/F /IM resonance.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill', '/F /IM local-api.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := True;
end;
