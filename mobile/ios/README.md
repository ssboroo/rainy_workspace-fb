# iPhone target (Safari Web Extension)

This folder contains source assets for the iOS Safari Web Extension and native companion container. Generate the containing Xcode project on macOS:

1. Xcode → File → New → Project → iOS → Safari Extension App.
2. Set product name to `RAINY FB Pro`, bundle identifier to your registered identifier, language Swift.
3. Replace the generated extension resources with the files in `SafariExtension/` and add `../../extension/content-facebook.js` to the extension resources under the filename `content-facebook.js`.
4. Add `RainyFBProApp.swift` to the containing app target.
5. Enable the extension in iOS Settings and allow website access for `workspace.rainy.studio`, `www.facebook.com`, and `m.facebook.com`. Open the workspace directly in Safari.
6. Build and test on a physical iPhone. Distribution requires Apple Developer Program signing.

The Safari extension only runs on Safari web pages with user permission. It cannot operate inside the native Facebook app. Xcode/macOS signing is required; this repository does not contain a signed IPA.