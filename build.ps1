param(
    [switch]$Console
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $csc)) {
    throw "csc.exe not found at $csc"
}

$target = if ($Console) { "exe" } else { "winexe" }
$outExe = Join-Path $root "KuroCat.exe"
$sources = Get-ChildItem (Join-Path $root "host") -Filter "*.cs" | Sort-Object Name | ForEach-Object { $_.FullName }

Write-Host "Compiling KuroCat.exe ($target)..."
& $csc `
    /nologo `
    /target:$target `
    /platform:x64 `
    /optimize+ `
    /warn:4 `
    /out:$outExe `
    /reference:System.dll `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    /reference:System.Web.Extensions.dll `
    /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll `
    $sources

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Build succeeded: $outExe"
