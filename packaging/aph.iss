; Aph Windows installer (Inno Setup 6).
;
; Built by CI — never by hand:
;   python -c "from PIL import Image; Image.open('branding/aph.png').save('packaging/aph.ico', ...)"
;   ISCC /dVersion=<ver> packaging/aph.iss
; Version defaults to 0.0.0 for local experiments; CI always passes /dVersion.
#ifndef Version
#define Version "0.0.0"
#endif

[Setup]
; Permanent upgrade identity: never change this GUID, or updates install
; side-by-side duplicates instead of upgrading in place.
AppId={{e521632c-cee2-452b-9bc1-46b0e1bae58e}
AppName=Aph
AppVersion={#Version}
AppVerName=Aph {#Version}
AppPublisher=Aph Browser
AppPublisherURL=https://github.com/aph-browser/aph
; Per-user install: no UAC prompt, works on restricted machines, and future
; background updates won't need admin rights (Chrome/Brave/VS Code model).
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\Aph
OutputDir=Output
OutputBaseFilename=Aph-Setup-{#Version}
SetupIconFile=aph.ico
UninstallDisplayIcon={app}\aph.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
MinVersion=10.0
ArchitecturesAllowed=x64compatible
; If Aph is running, ask to close it instead of corrupting locked files
; (xul.dll / firefox.exe). Never force-close: users would lose open tabs.
CloseApplications=yes
; Uninstall removes {app} only. The profile (%APPDATA%\Aph\profile with
; bookmarks, passwords, workspaces) is deliberately preserved.

[Files]
Source: "..\build\win-portable\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "aph.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Aph"; Filename: "{app}\aph.bat"; IconFilename: "{app}\aph.ico"; WorkingDir: "{app}"
Name: "{autodesktop}\Aph"; Filename: "{app}\aph.bat"; IconFilename: "{app}\aph.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
Filename: "{app}\aph.bat"; Description: "{cm:LaunchProgram,Aph}"; Flags: nowait postinstall skipifsilent

; Per-user (HKCU) default-browser registration so Aph appears in
; Windows Settings > Default Apps and "Open with". aph.bat forwards
; the URL through to firefox.exe (--profile ... %*).
[Registry]
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Aph"; ValueType: string; ValueData: "Aph"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Aph\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Aph"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Aph\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Aph Browser"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Aph\Capabilities\URLAssociations"; ValueType: string; ValueName: "http"; ValueData: "AphHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Aph\Capabilities\URLAssociations"; ValueType: string; ValueName: "https"; ValueData: "AphHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Aph\Capabilities\FileAssociations"; ValueType: string; ValueName: ".html"; ValueData: "AphHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Aph\Capabilities\FileAssociations"; ValueType: string; ValueName: ".htm"; ValueData: "AphHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\Aph\shell\open\command"; ValueType: string; ValueData: """{app}\aph.bat"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\AphHTML\shell\open\command"; ValueType: string; ValueData: """{app}\aph.bat"" ""%1"""; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Aph"; ValueData: "Software\Clients\StartMenuInternet\Aph\Capabilities"; Flags: uninsdeletevalue
