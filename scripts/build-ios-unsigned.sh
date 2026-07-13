#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$ROOT_DIR/.tmp-ios-unsigned"
DERIVED_DATA_PATH="$WORK_DIR/FTranslateDerivedData"
STAGING_DIR="$WORK_DIR/FTranslateIpa"
OUTPUT_DIR="$ROOT_DIR/ios/App/output/unsigned"
IPA_PATH="$OUTPUT_DIR/FTranslate-unsigned.ipa"

cd "$ROOT_DIR"
npm run ios:sync

for target in "$DERIVED_DATA_PATH" "$STAGING_DIR" "$OUTPUT_DIR"; do
  case "$target" in
    "$ROOT_DIR"/.tmp-ios-unsigned/*|"$ROOT_DIR"/ios/App/output/unsigned) ;;
    *)
      echo "Refusing to remove unexpected path: $target" >&2
      exit 1
      ;;
  esac
done

rm -rf "$DERIVED_DATA_PATH" "$STAGING_DIR" "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  build

APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/App.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Unsigned app bundle was not produced: $APP_PATH" >&2
  exit 1
fi

mkdir -p "$STAGING_DIR/Payload"
/usr/bin/ditto "$APP_PATH" "$STAGING_DIR/Payload/App.app"
(
  cd "$STAGING_DIR"
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent Payload "$IPA_PATH"
)

/usr/bin/shasum -a 256 "$IPA_PATH" > "$IPA_PATH.sha256"
echo "Unsigned IPA: $IPA_PATH"
cat "$IPA_PATH.sha256"
