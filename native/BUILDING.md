# Notas for macOS

The **Notas** desktop target is the parity build for Apple silicon and macOS 26 or later. It uses Swift/AppKit for windows, menus, floating notes, the Dock badge, and the macOS menu bar item. System WebKit runs the same workspace and Notepad as Electron, not a second implementation of note editing or Firestore writes. Electron and Node are not used at runtime.

## Build Notas

Use full Xcode and XcodeGen. Supply the `firebase-config.local.js` from the web/Electron build; if starting from `.env`, generate it with `npm run dev:config` before generating the project. Build with a separate Firebase project and synthetic data for verification.

```sh
xcodegen generate --spec native/desktop.yml --project native
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project native/Notas.xcodeproj -scheme Notas -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath native/.build/desktop build
```

The bundle is `native/.build/desktop/Build/Products/Release/Notas.app`. It can run next to Electron under the separate `com.deanmsmith.notas.native` bundle identifier. It does not import the Electron login, local preferences, or any unsynced local edits. Synced library data is available after signing in to the same Firebase project with the same account. The app serves its packaged workspace on a stable local-only origin and still needs network access to load Firebase and the workspace's remote dependencies.

## Sign In With Google

Choose **Continue With Google** in the default browser when it opens, then select your usual Google account. Notas uses the same Firebase Google provider as Electron and returns to the workspace after sign-in. No additional Apple OAuth client or Keychain entitlement is required. The Firebase project must authorize `localhost`, as it does for Electron. The browser does not keep a Firebase login for Notas.

Before switching from Electron, compare both apps against staging: sign in as the same user, edit and reopen a rich note in both clients, then verify split view, the floating note, sharing, conversations, reminders, and the menu bar and Dock behavior.

To move the workspace or a floating note, drag the empty space along the top edge beside the window buttons. Double-click that space to maximize or restore the window, or to minimize it if you chose that action in macOS settings. The workspace extends behind the traffic lights, but AppKit handles these gestures without sending them to the editor.

On macOS 26.2 or later, click the note name itself to rename it. Clicking the empty space beside the name does not focus the title.

Double-click a word in the Notepad to select and copy just that word, even in a collapsed heading. A selection that spans the collapsed heading and another block still includes the hidden section when copied. Use **Edit → Paste and Match Style** to paste plain text using the destination formatting.

In a floating note, **Show Text Styling** sits immediately to the left of **Share Note**, on the same row as the title. The styling toolbar expands below that row when enabled.

Press Backspace on an empty bullet to remove just that line. Any nested bullets remain at their existing indentation.

Closing a Notas window hides it immediately while pending edits save in the background. Quit waits for local draft storage, not for the network. On relaunch, Notas retries drafts for the same account and Firebase project. If the cloud version changed or the note is no longer available, Notas keeps the draft instead of overwriting or restoring the note. Use **Settings → Local Drafts → Copy Drafts** to recover the title and note HTML.
