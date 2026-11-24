import AppKit
import Network
import OSLog
import Security
import WebKit

@main
@MainActor
final class DesktopApplication: NSObject, NSApplicationDelegate {
    private let logger = Logger(subsystem: "com.deanmsmith.notas.native", category: "Desktop")
    private var server: RendererServer?
    private var origin: URL?
    private var bridge = ""
    private var nextWindowID = 1
    private var quitting = false
    private struct BrowserSignIn {
        let state: String
        let projectID: String
        let windowID: Int
        let reply: @MainActor @Sendable (Any?, String?) -> Void
    }

    private struct BrowserSignInResult: Decodable {
        let state: String
        let projectId: String
        let idToken: String?
        let accessToken: String?
        let cancelled: Bool?
    }

    private var browserSignIn: BrowserSignIn?
    private var browserSignInTimeout: Task<Void, Never>?
    private var theme: [String: Any]?
    private var libraryAccount: String?
    private var primary: DesktopWindow?
    private var secondary: DesktopWindow?
    private var floating: DesktopWindow?
    private var menuBarNotes: [String: [String: Any]] = [:]
    private var menuBarSettings = UserDefaults.standard.dictionary(forKey: "menuBarSettings") ?? ["mode": "new"]
    private var statusItem: NSStatusItem?
    private let portKey = "rendererPort"

    private var windows: [DesktopWindow] { [primary, secondary, floating].compactMap { $0 } }
    private var mains: [DesktopWindow] { [primary, secondary].compactMap { $0 } }
    private var focused: DesktopWindow? { windows.first { $0.window === NSApp.keyWindow } }
    private var menuBarNoteID: String? {
        menuBarSettings["mode"] as? String == "note" ? normalizedID(menuBarSettings["noteId"]) : nil
    }

    static func main() {
        let app = NSApplication.shared
        let delegate = DesktopApplication()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        Task { await launch() }
    }

    private func launch() async {
        do {
            guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
            bridge = try String(contentsOf: resources.appendingPathComponent("Bridge.js"), encoding: .utf8)
            let saved = UserDefaults.standard.integer(forKey: portKey)
            let port = RendererServer.portRange.contains(saved) ? saved : Int.random(in: RendererServer.portRange)
            // Do not silently use a new origin for an existing profile: it would appear signed out.
            let candidates = saved == port ? [port] : (0..<16).map {
                RendererServer.portRange.lowerBound +
                    (port - RendererServer.portRange.lowerBound + $0) % RendererServer.portRange.count
            }
            for candidate in candidates {
                let server = try RendererServer(resources: resources, port: UInt16(candidate)) { [weak self] data in
                    await self?.receiveBrowserSignIn(data) ?? false
                }
                do {
                    origin = try await server.start()
                    self.server = server
                    UserDefaults.standard.set(candidate, forKey: portKey)
                    break
                } catch NWError.posix(.EADDRINUSE) {
                    logger.notice("The workspace port \(candidate) is already in use.")
                }
            }
            guard origin != nil else { throw NWError.posix(.EADDRINUSE) }
            installStatusItem()
            _ = showPrimary()
        } catch {
            logger.error("Could not start Notas: \(error.localizedDescription, privacy: .private)")
            let alert = NSAlert()
            alert.messageText = "Could Not Start Notas"
            if (error as? CocoaError)?.code == .fileReadNoSuchFile {
                alert.informativeText = "A workspace resource is missing. Build Notas with firebase-config.local.js in the repository root."
            } else {
                alert.informativeText = "The local workspace could not start. \(error.localizedDescription)"
            }
            alert.addButton(withTitle: "Quit")
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { _ = showPrimary() }
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        for view in windows where view.isVisible { view.send("windowForegrounded") }
    }

    func applicationWillTerminate(_ notification: Notification) { quitting = true }

    private func makeWindow(note: Bool) -> DesktopWindow? {
        guard let origin else { return nil }
        let view = DesktopWindow(id: nextWindowID, note: note, origin: origin, bridge: bridge, desktop: self)
        nextWindowID += 1
        applyBackground(to: view)
        return view
    }

    @discardableResult
    private func showPrimary() -> DesktopWindow? {
        if primary == nil {
            primary = makeWindow(note: false)
            primary?.window.setFrameAutosaveName("Notas Workspace")
            primary?.load()
        }
        primary?.show()
        return primary
    }

    func shouldClose(_ view: DesktopWindow) -> Bool {
        if !quitting && (view === primary || (view.isNote && menuBarNoteID != nil)) {
            view.pendingReveal = false
            view.hide()
            sendNoteWindowPresence()
            if view.isNote { warmMenuBarNote() }
            return false
        }
        return true
    }

    func didClose(_ view: DesktopWindow) {
        if browserSignIn?.windowID == view.id { finishBrowserSignIn(error: "The Notas window was closed.") }
        if view === secondary { secondary = nil }
        if view === floating { floating = nil }
        if view === primary { primary = nil }
        updateDockBadge()
        sendNoteWindowPresence()
        // Break WebKit's script-message-handler retain cycle after the window delegate returns.
        Task { view.dispose(closeWindow: false) }
    }

    func rendererReloaded(_ view: DesktopWindow) {
        if browserSignIn?.windowID == view.id { finishBrowserSignIn(error: "The Notas workspace was reloaded.") }
        view.accountID = nil
        view.badgeCount = 0
        updateDockBadge()
    }

    private func context(for view: DesktopWindow) -> [String: Any] {
        let authorized = view.accountID != nil && view.accountID == libraryAccount
        return [
            "windowId": view.id,
            "type": view.isNote ? "note" : "main",
            "noteId": view.noteID as Any? ?? NSNull(),
            "initialNote": (authorized ? view.initialNote : nil) as Any? ?? NSNull(),
            "themeState": theme as Any? ?? NSNull(),
            "isAlwaysOnTop": view.isNote,
            "hasVisibleNoteWindow": floating?.isVisible == true
        ]
    }

    func sendNoteWindowPresence() {
        for view in mains {
            view.send("noteWindowPresenceChanged", ["hasVisibleNoteWindow": floating?.isVisible == true])
        }
    }

    private func setAccount(_ uid: String?, from view: DesktopWindow) {
        let previousAccount = view.accountID
        view.accountID = uid
        if view.isNote, uid != libraryAccount, (uid != nil || previousAccount != nil) {
            floating = nil
            // Return the bridge reply before removing the message handler.
            Task { view.dispose() }
            updateDockBadge()
            sendNoteWindowPresence()
            return
        }
        if view === primary || (!view.isNote && libraryAccount == nil && uid != nil) {
            if libraryAccount != uid {
                libraryAccount = uid
                menuBarNotes.removeAll()
                let note = floating
                floating = nil
                note?.dispose()
                sendNoteWindowPresence()
            }
        }
        if uid == nil {
            view.badgeCount = 0
            updateDockBadge()
        }
        if view.isNote { view.send("windowContextUpdated", context(for: view)) }
    }

    private func snapshot(_ value: Any?, matching id: String? = nil) -> [String: Any]? {
        guard var note = value as? [String: Any],
              let noteID = normalizedID(note["id"]), id == nil || id == noteID else { return nil }
        note["id"] = noteID
        note["title"] = title(note["title"])
        return note
    }

    private func normalizedID(_ value: Any?) -> String? {
        guard let raw = value as? String else { return nil }
        let id = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, id.utf16.count <= 180, !id.contains("/"),
              id.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        return id
    }

    private func title(_ value: Any?) -> String {
        let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? "Untitled Note" : String(text.prefix(300))
    }

    private func configureNoteWindow(id: String, note: [String: Any], reveal: Bool) -> DesktopWindow? {
        let existing = floating
        guard let view = existing ?? makeWindow(note: true) else { return nil }
        floating = view
        view.hide()
        view.noteID = id
        view.initialNote = note
        view.window.title = "\(title(note["title"])) - Notas"
        view.noteReady = false
        view.pendingReveal = reveal
        if existing == nil { view.load() }
        else { view.send("windowContextUpdated", context(for: view)) }
        sendNoteWindowPresence()
        return view
    }

    private func toggleNote(id: String, note: [String: Any], closeIfVisible: Bool = true) -> [String: Any] {
        if let view = floating, view.noteID == id {
            if closeIfVisible && view.isVisible {
                view.window.performClose(nil)
                return ["ok": true, "windowId": view.id, "closed": true]
            }
            if note["bodyLoaded"] as? Bool == true {
                view.initialNote = note
                if view.accountID != nil, view.accountID == libraryAccount { view.send("noteStateChanged", note) }
            }
            revealNote(view)
            return ["ok": true, "windowId": view.id, "reused": true]
        }
        guard let view = configureNoteWindow(id: id, note: note, reveal: true) else {
            return ["ok": false, "error": "Could Not Create Note Window"]
        }
        return ["ok": true, "windowId": view.id]
    }

    private func revealNote(_ view: DesktopWindow) {
        guard view.noteReady else {
            view.pendingReveal = true
            return
        }
        view.pendingReveal = false
        if !view.isVisible,
           let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main {
            let available = screen.visibleFrame
            let width = min(view.window.frame.width, available.width)
            let height = min(view.window.frame.height, available.height)
            view.window.setFrame(NSRect(x: available.midX - width / 2, y: available.midY - height / 2,
                                        width: width, height: height), display: false)
        }
        view.show()
        sendNoteWindowPresence()
    }

    private func warmMenuBarNote() {
        guard let id = menuBarNoteID, let note = menuBarNotes[id], note["bodyLoaded"] as? Bool == true,
              floating?.noteID != id,
              floating?.window.isMiniaturized != true, floating?.isVisible != true, floating?.pendingReveal != true else { return }
        _ = configureNoteWindow(id: id, note: note, reveal: false)
    }

    private func updateDockBadge() {
        let count = windows.filter { $0.accountID != nil }.map(\.badgeCount).max() ?? 0
        NSApp.dockTile.badgeLabel = count > 99 ? "99+" : (count > 0 ? String(count) : nil)
    }

    private func updateCatalog(_ notes: [[String: Any]]) {
        var catalog: [String: [String: Any]] = [:]
        for value in notes.prefix(2000) {
            guard var note = snapshot(value), let id = note["id"] as? String,
                  (note["deletedAt"] as? String ?? "").isEmpty else { continue }
            if id == menuBarNoteID, let previous = menuBarNotes[id], previous["bodyLoaded"] as? Bool == true,
               note["bodyLoaded"] as? Bool != true, (previous["modified"] as? String) == (note["modified"] as? String) {
                note["content"] = previous["content"]
                note["bodyLoaded"] = true
            }
            catalog[id] = note
        }
        menuBarNotes = catalog
        warmMenuBarNote()
    }

    private func saveMenuBarSettings(_ value: [String: Any]) {
        let id = value["mode"] as? String == "note" ? normalizedID(value["noteId"]) : nil
        menuBarSettings = id.map { ["mode": "note", "noteId": $0, "noteTitle": title(value["noteTitle"])] }
            ?? ["mode": "new", "noteId": "", "noteTitle": ""]
        UserDefaults.standard.set(menuBarSettings, forKey: "menuBarSettings")
        for view in mains { view.send("menuBarSettingsChanged", menuBarSettings) }
        if id == nil, let view = floating, !view.window.isVisible, !view.pendingReveal {
            floating = nil
            view.dispose()
            updateDockBadge()
        }
        warmMenuBarNote()
    }

    private func applyBackground(to view: DesktopWindow) {
        let mode = theme?["mode"] as? String
        let systemLight = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua
        let light = mode == "light" || (mode == "system" && systemLight)
        let rgb: Int
        switch theme?["accentMode"] as? String {
        case "bg": rgb = light ? 0xE6E6E6 : 0x070707
        case "custom": rgb = light ? 0xD7E4F0 : 0x050A12
        default: rgb = light ? 0xD7E4F0 : 0x02070F
        }
        let color = NSColor(srgbRed: Double(rgb >> 16) / 255, green: Double((rgb >> 8) & 255) / 255,
                            blue: Double(rgb & 255) / 255, alpha: 1)
        view.window.backgroundColor = color
        view.webView.underPageBackgroundColor = color
    }

    func receive(_ method: String, args: [Any], from view: DesktopWindow,
                 reply: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard windows.contains(where: { $0 === view }) else {
            reply(nil, "This Notas Window Is Closed")
            return
        }
        let signedIn = view.accountID != nil && view.accountID == libraryAccount
        var result: Any = NSNull()
        switch method {
        case "rendererReady":
            view.markRendererReady()
            view.send("windowContextUpdated", context(for: view))
        case "getWindowContext":
            result = context(for: view)
        case "setAccount":
            setAccount(normalizedID(args.first), from: view)
        case "openNoteWindow":
            guard signedIn, args.count == 2, let id = normalizedID(args.first), let note = snapshot(args[1], matching: id) else {
                reply(["ok": false, "error": "Could Not Open Note Window"], nil)
                return
            }
            result = toggleNote(id: id, note: note)
        case "noteWindowReady":
            if signedIn, view.isNote, normalizedID(args.first) == view.noteID {
                view.noteReady = true
                if view.pendingReveal { revealNote(view) }
            }
        case "updateNoteState":
            if signedIn, let note = snapshot(args.first), let id = note["id"] as? String,
               !view.isNote || view.noteID == id {
                for target in windows where target !== view && target.accountID == view.accountID &&
                    (!target.isNote || target.noteID == id) {
                    target.send("noteStateChanged", note)
                }
            }
        case "updateThemeState":
            if let state = args.first as? [String: Any], let mode = state["mode"] as? String,
               ["light", "dark", "system"].contains(mode) {
                theme = state
                for target in windows {
                    applyBackground(to: target)
                    if target !== view { target.send("themeStateChanged", state) }
                }
            }
        case "setWindowTitle":
            if view.isNote { view.window.title = "\(title(args.first)) - Notas" }
            result = view.isNote
        case "setDockNotificationCount":
            view.badgeCount = max(0, min(999, args.first as? Int ?? 0))
            updateDockBadge()
            result = true
        case "getMenuBarSettings":
            result = menuBarSettings
        case "setMenuBarSettings":
            if !view.isNote, let settings = args.first as? [String: Any] { saveMenuBarSettings(settings) }
            result = menuBarSettings
        case "updateMenuBarNotes":
            if signedIn, view === primary, let notes = args.first as? [[String: Any]] { updateCatalog(notes) }
        case "preloadMenuBarNote":
            if signedIn, view === primary, let id = menuBarNoteID, let note = snapshot(args.first, matching: id),
               note["bodyLoaded"] as? Bool == true, (note["deletedAt"] as? String ?? "").isEmpty {
                menuBarNotes[id] = note
                warmMenuBarNote()
            }
        case "showEditorImageContextMenu":
            if let payload = args.first as? [String: Any] { view.showImageMenu(payload) }
        case "writeEditorImageToClipboard":
            result = view.isVisible && writeImage(args.first as? [String: Any])
        case "signInWithGoogle":
            signIn(projectID: args.first as? String, from: view, reply: reply)
            return
        default:
            reply(nil, "Unrecognized Desktop Command")
            return
        }
        reply(result, nil)
    }

    private func writeImage(_ payload: [String: Any]?) -> Bool {
        let prefix = "data:image/png;base64,"
        guard let payload, let dataURL = payload["dataUrl"] as? String,
              dataURL.utf8.count <= 16 * 1024 * 1024, dataURL.hasPrefix(prefix),
              let png = Data(base64Encoded: String(dataURL.dropFirst(prefix.count))),
              let image = NSImage(data: png), image.isValid else { return false }
        let item = NSPasteboardItem()
        item.setData(png, forType: .png)
        item.setString(String((payload["text"] as? String ?? "Image").prefix(512)), forType: .string)
        if let html = payload["html"] as? String, !html.isEmpty, html.utf8.count <= 2 * 1024 * 1024 {
            item.setString(html, forType: .html)
        }
        NSPasteboard.general.clearContents()
        return NSPasteboard.general.writeObjects([item])
    }

    private func signIn(projectID: String?, from view: DesktopWindow,
                        reply: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let projectID, !projectID.isEmpty, let origin,
              var signinURL = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            reply(nil, "The Firebase project is not configured for this Notas build.")
            return
        }
        guard !view.isNote, view.window.isKeyWindow else {
            reply(nil, "Make the Notas Workspace the active window and try again.")
            return
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else {
            reply(nil, "Could Not Start Google Sign-In")
            return
        }
        let state = bytes.map { String(format: "%02x", $0) }.joined()
        signinURL.path = "/BrowserSignIn.html"
        signinURL.fragment = state
        guard let url = signinURL.url else {
            reply(nil, "Could Not Open Google Sign-In")
            return
        }
        if browserSignIn != nil { finishBrowserSignIn(error: "A new sign-in request replaced this one.") }
        browserSignIn = BrowserSignIn(state: state, projectID: projectID, windowID: view.id, reply: reply)
        guard NSWorkspace.shared.open(url) else {
            finishBrowserSignIn(error: "Could Not Open Your Default Browser")
            return
        }
        browserSignInTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(300))
            guard !Task.isCancelled, self?.browserSignIn?.state == state else { return }
            self?.finishBrowserSignIn(error: "Google Sign-In timed out. Try again.")
        }
    }

    private func receiveBrowserSignIn(_ data: Data) -> Bool {
        guard let active = browserSignIn, let result = try? JSONDecoder().decode(BrowserSignInResult.self, from: data),
              result.state == active.state, result.projectId == active.projectID,
              let view = mains.first(where: { $0.id == active.windowID }), view.rendererReady else { return false }
        if result.cancelled == true {
            finishBrowserSignIn(error: "Google Sign-In was cancelled.")
        } else {
            var credential: [String: String] = [:]
            if let token = result.idToken, !token.isEmpty { credential["idToken"] = token }
            if let token = result.accessToken, !token.isEmpty { credential["accessToken"] = token }
            guard !credential.isEmpty else { return false }
            // The signed-in session lives in Firebase inside the app, not in the browser.
            finishBrowserSignIn(credential: credential)
        }
        view.show()
        return true
    }

    private func finishBrowserSignIn(credential: [String: String]? = nil, error: String? = nil) {
        let active = browserSignIn
        browserSignIn = nil
        browserSignInTimeout?.cancel()
        browserSignInTimeout = nil
        active?.reply(credential, error)
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(item("New Window", #selector(openNewWindow)))
        return menu
    }

    @objc private func openNewWindow() {
        guard let primary, primary.isVisible || primary.window.isMiniaturized else {
            showPrimary()
            return
        }
        if secondary == nil {
            secondary = makeWindow(note: false)
            secondary?.window.cascadeTopLeft(from: NSPoint(x: primary.window.frame.minX, y: primary.window.frame.maxY))
            secondary?.load()
        }
        secondary?.show()
    }

    private func installStatusItem() {
        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem = status
        let url = Bundle.main.url(forResource: "notas-menubar-iconTemplate@2x", withExtension: "png")
        if let url, let image = NSImage(contentsOf: url) {
            image.isTemplate = true
            image.size = NSSize(width: 18, height: 18)
            status.button?.image = image
        } else {
            status.button?.image = NSImage(systemSymbolName: "note.text", accessibilityDescription: "Notas")
        }
        status.button?.toolTip = "Notas"
        status.button?.setAccessibilityLabel("Notas")
        status.button?.target = self
        status.button?.action = #selector(statusClicked)
        status.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc private func statusClicked(_ button: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp || NSApp.currentEvent?.modifierFlags.contains(.control) == true {
            statusMenu().popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 4), in: button)
        } else if let id = menuBarNoteID {
            if let view = floating, view.noteID == id, view.isVisible { view.window.performClose(nil) }
            else if let note = menuBarNotes[id] { _ = toggleNote(id: id, note: note, closeIfVisible: false) }
            else { showPrimary()?.send("menuBarOpenNote", ["noteId": id]) }
        } else if let primary, primary.isVisible {
            primary.hide()
        } else {
            showPrimary()?.send("menuBarOpenNewNote")
        }
    }

    private func statusMenu() -> NSMenu {
        let menu = NSMenu()
        let new = item("New Note", #selector(useNewNote))
        new.state = menuBarNoteID == nil ? .on : .off
        menu.addItem(new)
        let specific = NSMenuItem(title: "Specific Note", action: nil, keyEquivalent: "")
        let notes = NSMenu()
        let sorted = menuBarNotes.keys.sorted {
            let order = title(menuBarNotes[$0]?["title"]).localizedCaseInsensitiveCompare(title(menuBarNotes[$1]?["title"]))
            return order == .orderedSame ? $0 < $1 : order == .orderedAscending
        }
        for id in sorted {
            let choice = item(String(title(menuBarNotes[id]?["title"]).prefix(70)), #selector(useSpecificNote))
            choice.representedObject = id
            choice.state = id == menuBarNoteID ? .on : .off
            notes.addItem(choice)
        }
        if sorted.isEmpty { notes.addItem(NSMenuItem(title: "No Notes Available", action: nil, keyEquivalent: "")) }
        specific.submenu = notes
        menu.addItem(specific)
        menu.addItem(.separator())
        menu.addItem(item("Open Notas", #selector(reopenWorkspace)))
        menu.addItem(NSMenuItem(title: "Quit Notas", action: #selector(NSApplication.terminate(_:)), keyEquivalent: ""))
        return menu
    }

    @objc private func useNewNote() { saveMenuBarSettings(["mode": "new"]) }
    @objc private func useSpecificNote(_ item: NSMenuItem) {
        guard let id = item.representedObject as? String, let note = menuBarNotes[id] else { return }
        saveMenuBarSettings(["mode": "note", "noteId": id, "noteTitle": title(note["title"])])
    }
    @objc private func reopenWorkspace() { showPrimary() }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private func buildMainMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let submenu = NSMenu(title: title)
            items.forEach(submenu.addItem)
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.submenu = submenu
            main.addItem(item)
            return submenu
        }
        func command(_ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
            NSMenuItem(title: title, action: action, keyEquivalent: key)
        }

        let services = NSMenu()
        let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        servicesItem.submenu = services
        _ = add("Notas", [
            command("About Notas", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            item("Settings…", #selector(openSettings), key: ","), .separator(), servicesItem, .separator(),
            command("Hide Notas", #selector(NSApplication.hide(_:)), "h"),
            command("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h"),
            command("Show All", #selector(NSApplication.unhideAllApplications(_:))), .separator(),
            command("Quit Notas", #selector(NSApplication.terminate(_:)), "q")
        ])
        main.items[0].submenu?.item(withTitle: "Hide Others")?.keyEquivalentModifierMask = [.command, .option]
        _ = add("File", [
            item("New Note", #selector(newNote), key: "n"),
            item("Toggle Pop Out Note", #selector(toggleFocusedNote), key: "p"), .separator(),
            NSMenuItem(title: "Close Window", action: nil, keyEquivalent: "")
        ])
        _ = add("Edit", [
            command("Undo", Selector(("undo:")), "z"), command("Redo", Selector(("redo:")), "Z"), .separator(),
            command("Cut", #selector(NSText.cut(_:)), "x"), command("Copy", #selector(NSText.copy(_:)), "c"),
            command("Paste", #selector(NSText.paste(_:)), "v"),
            command("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), "V"),
            command("Select All", #selector(NSText.selectAll(_:)), "a")
        ])
        _ = add("View", [
            item("Reload", #selector(reload), key: "r"), .separator(),
            item("Actual Size", #selector(resetZoom), key: "0"),
            item("Zoom In", #selector(zoomIn), key: "="), item("Zoom Out", #selector(zoomOut), key: "-")
        ])
        let windows = add("Window", [
            command("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            command("Zoom", #selector(NSWindow.performZoom(_:))), .separator(),
            command("Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))
        ])
        NSApp.mainMenu = main
        NSApp.servicesMenu = services
        NSApp.windowsMenu = windows
    }

    @objc private func newNote() { (focused ?? showPrimary())?.send("newNote") }
    @objc private func openSettings() { (focused.flatMap { $0.isNote ? nil : $0 } ?? showPrimary())?.send("openSettings") }
    @objc private func toggleFocusedNote() {
        if let focused, focused.isNote { focused.window.performClose(nil) }
        else { (focused ?? showPrimary())?.send("openActiveNote") }
    }
    @objc private func reload() { focused?.load() }
    @objc private func resetZoom() { focused?.webView.pageZoom = 1 }
    @objc private func zoomIn() {
        if let webView = focused?.webView { webView.pageZoom = min(3, webView.pageZoom * 1.1) }
    }
    @objc private func zoomOut() {
        if let webView = focused?.webView { webView.pageZoom = max(0.5, webView.pageZoom / 1.1) }
    }
}
