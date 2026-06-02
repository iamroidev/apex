# Apex — Local LiveKit Development Server
# Run this script to download and start a local LiveKit server for development.
# If you don't run this, Apex will automatically use Sandbox Mode (simulated participants).

$LIVEKIT_VERSION = "1.7.2"
$INSTALL_DIR = "$PSScriptRoot\.livekit"
$BINARY = "$INSTALL_DIR\livekit-server.exe"

if (-not (Test-Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
}

if (-not (Test-Path $BINARY)) {
    Write-Host "Downloading LiveKit Server v$LIVEKIT_VERSION..." -ForegroundColor Cyan
    $url = "https://github.com/livekit/livekit/releases/download/v$LIVEKIT_VERSION/livekit_${LIVEKIT_VERSION}_windows_amd64.zip"
    $zipPath = "$INSTALL_DIR\livekit.zip"
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $INSTALL_DIR -Force
        Remove-Item $zipPath -Force
        Write-Host "LiveKit Server downloaded successfully." -ForegroundColor Green
    } catch {
        Write-Host "Failed to download LiveKit. You can run Apex in Sandbox Mode instead." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""
Write-Host "Starting LiveKit Server (dev mode)..." -ForegroundColor Cyan
Write-Host "API Key:    devkey" -ForegroundColor Gray
Write-Host "API Secret: devsecret" -ForegroundColor Gray
Write-Host "WebSocket:  ws://localhost:7880" -ForegroundColor Gray
Write-Host ""

& $BINARY --dev --keys "devkey: devsecret" --bind 0.0.0.0
