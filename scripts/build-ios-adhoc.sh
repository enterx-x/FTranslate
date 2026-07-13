#!/usr/bin/env bash
set -euo pipefail

: "${DEVELOPMENT_TEAM:?Set DEVELOPMENT_TEAM to your Apple Developer Team ID}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE_PATH="$ROOT_DIR/ios/App/output/FTranslate-Mobile.xcarchive"
EXPORT_PATH="$ROOT_DIR/ios/App/output/adhoc"

cd "$ROOT_DIR"
npm ci
npm run ios:sync

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  -allowProvisioningUpdates \
  archive

xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$ROOT_DIR/distribution/ios/ExportOptions-AdHoc.plist" \
  -allowProvisioningUpdates

IPA_PATH="$(find "$EXPORT_PATH" -maxdepth 1 -name '*.ipa' -print -quit)"
if [[ -z "$IPA_PATH" ]]; then
  echo "No IPA was produced in $EXPORT_PATH" >&2
  exit 1
fi

echo "Ad Hoc IPA: $IPA_PATH"
if [[ -n "${PUBLIC_BASE_URL:-}" ]]; then
  npm run ios:prepare-download -- "$IPA_PATH" "$PUBLIC_BASE_URL"
fi
