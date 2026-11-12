$ErrorActionPreference = "Stop"

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:LOCALAPPDATA "Programs\Onda"
$exe = Join-Path $target "Onda.exe"

Get-Process Onda -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

if ((Resolve-Path $source).Path -ne (Resolve-Path $target -ErrorAction SilentlyContinue).Path) {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Get-ChildItem $source -Force |
        Where-Object { $_.Name -notin @("instalar.cmd", "install.ps1") } |
        ForEach-Object {
            Copy-Item $_.FullName -Destination $target -Recurse -Force
        }
}

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = [Environment]::GetFolderPath("Programs")

foreach ($shortcutPath in @(
    (Join-Path $desktop "Onda.lnk"),
    (Join-Path $startMenu "Onda.lnk")
)) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $target
    $shortcut.IconLocation = "$exe,0"
    $shortcut.Description = "Onda"
    $shortcut.Save()
}

$protocolRoot = "HKCU:\Software\Classes\onda"
New-Item -Path $protocolRoot -Force | Out-Null
Set-ItemProperty -Path $protocolRoot -Name "(Default)" -Value "URL:Onda Protocol"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$protocolRoot\shell\open\command" -Name "(Default)" -Value "`"$exe`" `"%1`""

Write-Host "Onda instalado em $target"
$env:ELECTRON_RUN_AS_NODE = $null
Start-Process $exe -WorkingDirectory $target
