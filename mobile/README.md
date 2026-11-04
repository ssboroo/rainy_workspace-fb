# RAINY FB Pro Mobile

Shared Android + iPhone development workspace for the desktop extension baseline 5.8.0.

## Current status

- `shared/core.js`: platform-neutral queue transition, recovery, bridge protocol validation, duplicate fingerprint.
- Android: GeckoView loads the Workspace and bundles the shared publishing bridge and desktop 5.8.0 Facebook content script.
- iPhone: SwiftUI companion source + Safari Web Extension source assets. The Xcode Safari Extension App project must be generated, signed, and tested on macOS/iPhone.
- No APK, AAB, IPA, or App Store/TestFlight build has been produced yet.

## Android build

Requires JDK 17, Android SDK 36, and Gradle 8.13+.

```bash
cd mobile/android
gradle assembleDebug
```

GeckoView is pinned to stable release `161.0.20261103075946`. Mozilla's quick start requires Java 17, the Mozilla Maven repository, and a GeckoView runtime/session/view lifecycle. See [Mozilla GeckoView quick start](https://mozilla.github.io/geckoview/consumer/docs/geckoview-quick-start).

## iPhone build

Requires macOS, Xcode, Apple signing, and a physical iPhone for Safari extension testing. Follow `ios/README.md`.

## Safety and scope

Open the deployed Workspace in the Android app or in Safari with the extension enabled. Save a post with text, one or more Facebook group links, and optionally one image. Tap **Нийтлэх** in Workspace, then confirm on the Facebook group page. A confirmed publish advances to the next selected group. For scheduled publishing, enable automatic publishing and leave the Workspace visible with the extension enabled. The scheduler only starts within five minutes of the selected local time. These foreground flows are awaiting physical-device validation. Native Facebook app injection and background publishing are outside this implementation. Unconfirmed submissions must be checked on Facebook before posting again.