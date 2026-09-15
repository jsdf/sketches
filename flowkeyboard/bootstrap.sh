#!/usr/bin/env bash
# Generates FlowClone.xcodeproj from project.yml. Run on a Mac with Xcode 26 or 27.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen not found. Install it with:  brew install xcodegen" >&2
  exit 1
fi

xcodegen generate
echo
echo "Generated FlowClone.xcodeproj"
echo "Next: open it, set your team under Signing & Capabilities for BOTH targets,"
echo "and replace group.com.example.flowclone with an App Group you own."
