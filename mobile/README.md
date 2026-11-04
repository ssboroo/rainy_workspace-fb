# RAINY FB Pro Mobile

Shared Android + iPhone development workspace for the desktop extension baseline 5.8.0.

## Current status

- `shared/core.js`: platform-neutral queue transition, recovery, bridge protocol validation, duplicate fingerprint.
- Android: GeckoView browser shell proof of concept; opens Facebook mobile web. It does not yet inject the 5.8.0 extension or automate posts.
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

The Android browser shell and Safari extension are integration proofs only. They do not yet post to Facebook. Native Facebook app injection is not supported. Background execution is OS-controlled; uncertain post submissions must be marked UNKNOWN, not retried.
