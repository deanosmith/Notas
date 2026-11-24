import AppKit
import OSLog
import WebKit

@MainActor
final class DesktopWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    let id: Int
    let window: NSWindow
    let webView: WKWebView
    let isNote: Bool
    private unowned let desktop: DesktopApplication
    private let origin: URL
    private let launchID: String
    private let logger = Logger(subsystem: "com.deanmsmith.notas.native", category: "Window")
    private var waitingEvents: [(String, Any)] = []
    private var startupWatch: Task<Void, Never>?
    private(set) var rendererReady = false
    var pendingReveal = false {
        didSet {
            if pendingReveal && !oldValue { watchStartup() }
            if !pendingReveal && rendererReady { startupWatch?.cancel() }
        }
    }
    var noteReady = false
    var noteID: String?
    var initialNote: [String: Any]?
    var accountID: String?
    var badgeCount = 0

    var isVisible: Bool { window.isVisible && !window.isMiniaturized }

    init(id: Int, note: Bool, origin: URL, bridge: String, launchID: String, desktop: DesktopApplication) {
        self.id = id
        self.origin = origin
        self.launchID = launchID
        self.desktop = desktop
        isNote = note

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(
            source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true
        ))
        webView = WKWebView(frame: .zero, configuration: configuration)
        let size = note ? NSSize(width: 760, height: 760) : NSSize(width: 1280, height: 880)
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        super.init()

        webView.configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "notas")
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.delegate = self
        window.contentView = webView
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.title = note ? "Notas Note" : "Notas"
        window.isReleasedWhenClosed = false
        window.minSize = note ? NSSize(width: 400, height: 360) : NSSize(width: 900, height: 620)
        window.isMovableByWindowBackground = true
        if note {
            window.level = .floating
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        } else {
            window.collectionBehavior = .fullScreenPrimary
        }
        window.center()
    }

    func load() {
        var target = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        target.queryItems = [URLQueryItem(name: "desktop", value: "1"),
                             URLQueryItem(name: "desktopWindow", value: isNote ? "note" : "main"),
                             URLQueryItem(name: "desktopLaunch", value: launchID)]
        if let noteID { target.queryItems?.append(URLQueryItem(name: "desktopNote", value: noteID)) }
        webView.load(URLRequest(url: target.url!))
    }

    func checkpointDrafts(freeze: Bool = false) async throws {
        guard rendererReady else { return }
        let result = try await webView.callAsyncJavaScript(
            """
            if (freeze) {
                document.activeElement?.blur();
                document.documentElement.inert = true;
            }
            const checkpointed = await window.desktopDrafts.checkpoint();
            if (!freeze && checkpointed) {
                if (saveTimer) flushActiveNoteBeforeSwitch();
                if (_noteSplitSaveTimer) flushSplitPeerSave();
            }
            return checkpointed;
            """, arguments: ["freeze": freeze], in: nil, contentWorld: .page
        )
        guard result as? Bool == true else { throw CocoaError(.fileWriteUnknown) }
    }

    func resumeEditing() {
        guard rendererReady else { return }
        webView.evaluateJavaScript("document.documentElement.inert = false")
    }

    func show() {
        if window.isMiniaturized { window.deminiaturize(nil) }
        NSApp.unhide(nil)
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
        if !rendererReady, !webView.isLoading { watchStartup() }
    }

    func hide() {
        if window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
        window.orderOut(nil)
    }

    func dispose(closeWindow: Bool = true) {
        startupWatch?.cancel()
        waitingEvents.removeAll()
        window.delegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "notas", contentWorld: .page)
        webView.stopLoading()
        if closeWindow { window.close() }
    }

    func markRendererReady() {
        rendererReady = true
        if !pendingReveal { startupWatch?.cancel() }
        let events = waitingEvents
        waitingEvents.removeAll()
        for (event, payload) in events { send(event, payload) }
    }

    func send(_ event: String, _ payload: Any = NSNull()) {
        guard rendererReady else {
            // Only user commands need queuing; the current window context is pulled at startup.
            if ["menuBarOpenNewNote", "menuBarOpenNote", "newNote", "openSettings", "openActiveNote"].contains(event) {
                waitingEvents.append((event, payload))
            }
            return
        }
        webView.callAsyncJavaScript("window.notasDesktopReceive(event, payload)", arguments: [
            "event": event, "payload": payload
        ], in: nil, in: .page) { [weak self] result in
            if case let .failure(error) = result {
                self?.logger.error("Could not deliver \(event, privacy: .public): \(error.localizedDescription, privacy: .private)")
            }
        }
    }

    func showImageMenu(_ payload: [String: Any]) {
        guard window.isKeyWindow,
              let x = payload["x"] as? Double, x.isFinite,
              let y = payload["y"] as? Double, y.isFinite else { return }
        let menu = NSMenu()
        if payload["editable"] as? Bool == true {
            menu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "")
        }
        menu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "")
        if payload["editable"] as? Bool == true {
            menu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "")
            menu.addItem(withTitle: "Paste and Match Style", action: #selector(NSTextView.pasteAsPlainText(_:)), keyEquivalent: "")
        }
        let point = NSPoint(x: x * webView.pageZoom, y: y * webView.pageZoom)
        guard webView.bounds.contains(point) else { return }
        menu.popUp(positioning: nil, at: NSPoint(x: point.x, y: webView.isFlipped ? point.y : webView.bounds.height - point.y),
                   in: webView)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { desktop.shouldClose(self) }
    func windowWillClose(_ notification: Notification) { desktop.didClose(self) }
    func windowDidBecomeKey(_ notification: Notification) { send("windowForegrounded") }
    func windowDidMiniaturize(_ notification: Notification) { desktop.sendNoteWindowPresence() }
    func windowDidDeminiaturize(_ notification: Notification) { desktop.sendNoteWindowPresence() }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.name == "notas", message.webView === webView, message.frameInfo.isMainFrame,
              isRendererURL(message.frameInfo.request.url), isRendererURL(webView.url),
              let body = message.body as? [String: Any],
              let method = body["method"] as? String, let args = body["args"] as? [Any] else {
            replyHandler(nil, "Invalid Desktop Message")
            return
        }
        desktop.receive(method, args: args, from: self, reply: replyHandler)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        if navigationAction.targetFrame?.isMainFrame == false { return .allow }
        if navigationAction.targetFrame != nil, isRendererURL(navigationAction.request.url) { return .allow }
        if navigationAction.sourceFrame.isMainFrame && isRendererURL(navigationAction.sourceFrame.request.url) {
            openExternal(navigationAction.request.url)
        }
        return .cancel
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.sourceFrame.isMainFrame && isRendererURL(navigationAction.sourceFrame.request.url) {
            openExternal(navigationAction.request.url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        rendererReady = false
        noteReady = false
        desktop.rendererReloaded(self)
        watchStartup()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        if (error as NSError).code != NSURLErrorCancelled { showLoadError(error.localizedDescription) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        if (error as NSError).code != NSURLErrorCancelled { showLoadError(error.localizedDescription) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        rendererReady = false
        desktop.rendererReloaded(self)
        showLoadError("The WebKit content process stopped.")
    }

    private func isRendererURL(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port &&
            (url.path == "/" || url.path == "/index.html")
    }

    private func openExternal(_ url: URL?) {
        guard let url, url.scheme == "https" || url.scheme == "http", !isRendererURL(url) else { return }
        NSWorkspace.shared.open(url)
    }

    private func watchStartup() {
        startupWatch?.cancel()
        startupWatch = Task { [weak self] in
            try? await Task.sleep(for: .seconds(25))
            guard !Task.isCancelled, let self else { return }
            if !self.rendererReady {
                self.showLoadError("The workspace did not finish loading. Check your internet connection and try again.")
            } else if self.pendingReveal && !self.noteReady {
                self.showLoadError("The note did not finish loading. Check your internet connection and try again.")
            }
        }
    }

    private func showLoadError(_ message: String) {
        startupWatch?.cancel()
        logger.error("Could not load the workspace: \(message, privacy: .private)")
        guard isVisible || pendingReveal, window.attachedSheet == nil else { return }
        if pendingReveal { show() }
        let alert = NSAlert()
        alert.messageText = "Could Not Open Notas"
        alert.informativeText = message
        alert.addButton(withTitle: "Retry")
        alert.addButton(withTitle: "Dismiss")
        alert.beginSheetModal(for: window) { [weak self] result in
            if result == .alertFirstButtonReturn { self?.load() }
        }
    }
}
