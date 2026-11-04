# iPhone target (Safari Web Extension)

This folder contains source assets for the iOS Safari Web Extension and native companion container. Generate the containing Xcode project on macOS:

1. Xcode → File → New → Project → iOS → Safari Extension App.
2. Set product name to `RAINY FB Pro`, bundle identifier to your registered identifier, language Swift.
3. Replace the generated extension resources with the files in `SafariExtension/`.
4. Add `RainyFBProApp.swift` to the containing app target.
5. Configure the extension's allowed website access for `facebook.com` and `www.facebook.com`; the user must explicitly enable the extension in iOS Settings.
6. Build and test on a physical iPhone. Distribution requires Apple Developer Program signing.

The Safari extension only runs on Safari web pages with user permission. It cannot operate inside the native Facebook app. Xcode/macOS signing is required; this repository does not contain a signed IPA.
