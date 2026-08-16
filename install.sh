#!/usr/bin/env bash
# ==============================================================================
# OpenClaw NodeNexus Installer for macOS
# ==============================================================================
set -e

INSTALL_DIR="$HOME/.openclaw/sysgov"
BIN_DIR="$HOME/bin"

echo "=== Installing OpenClaw NodeNexus ==="
mkdir -p "$INSTALL_DIR" "$BIN_DIR"

cp -R ./* "$INSTALL_DIR/" 2>/dev/null || true
chmod +x "$INSTALL_DIR/bin/"*

ln -sf "$INSTALL_DIR/bin/nodepool" "$BIN_DIR/nodepool"
ln -sf "$INSTALL_DIR/bin/nodepool-proxy" "$BIN_DIR/nodepool-proxy"
ln -sf "$INSTALL_DIR/bin/sysgov" "$BIN_DIR/sysgov"

echo "[✓] Symlinks created in $BIN_DIR"

# LaunchAgent setup
PLIST_SRC="$INSTALL_DIR/com.openclaw.sysgov.plist"
if [ ! -f "$PLIST_SRC" ]; then
  cat << 'EOF' > "$HOME/Library/LaunchAgents/com.openclaw.sysgov.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.sysgov</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/maxbutler/.openclaw/sysgov/src/server.js</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>SYSGOV_PORT</key>
        <string>18890</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/maxbutler/.openclaw/sysgov/sysgov.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/maxbutler/.openclaw/sysgov/sysgov_err.log</string>
</dict>
</plist>
EOF
fi

echo "[✓] NodeNexus installed successfully!"
echo "Run 'nodepool status' or open http://127.0.0.1:18890 to view your live dashboard."
