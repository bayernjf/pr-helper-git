// Native macOS shell for PR Helper Git. It hosts the existing web client in
// a WKWebView and manages the lifetime of the bundled Node.js loopback server.
// No third-party runtime is bundled: WKWebView and Swift are part of macOS,
// and the already-installed Node.js binary is located at well-known paths.
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private let readySemaphore = DispatchSemaphore(value: 0)
    private var readyPort: Int?
    private var readyToken: String?
    private var isTerminating = false
    private var pendingOpenPath: String?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]
    private var outputBuffer = Data()
    private let bufferQueue = DispatchQueue(label: "local.pr-helper-git.stdout")

    // MARK: Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let node = locateNode() else {
            showFatal(
                "Node.js not found",
                "The app bundle has no Node runtime and no system Node.js was found. Install Node 22 or later, or use a distribution build with a bundled runtime.",
            )
            return
        }
        // The build script copies server/ and dist/ into Resources/app.
        guard let resourcePath = Bundle.main.resourcePath else {
            showFatal("Missing bundle resources", "The application bundle is incomplete.")
            return
        }
        let appDir = (resourcePath as NSString).appendingPathComponent("app")
        let serverScript = (appDir as NSString).appendingPathComponent("server/main.mjs")

        setupMenu()
        setupWindow()
        startServer(node: node, script: serverScript)

        // Wait for readiness off the main thread so the UI stays responsive.
        DispatchQueue.global().async {
            let result = self.readySemaphore.wait(timeout: .now() + 20)
            DispatchQueue.main.async {
                if result == .timedOut {
                    self.showFatal("Server startup timed out", "The local server did not become ready in time.")
                    return
                }
                guard let port = self.readyPort, let token = self.readyToken else {
                    self.showFatal("Server readiness error", "Could not determine the local server endpoint.")
                    return
                }
                // First load carries the token; the server then sets the
                // HttpOnly cookie used by every subsequent API request.
                let url = URL(string: "http://127.0.0.1:\(port)/?token=\(token)")!
                self.webView.load(URLRequest(url: url))
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        guard let process = server, process.isRunning else { return }
        process.terminate()
        // Bounded wait so a wedged server can never stall termination forever.
        let deadline = Date(timeIntervalSinceNow: 3)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
            process.waitUntilExit()
        }
    }

    // MARK: Server process

    private func startServer(node: String, script: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [script, "--port=0"]
        var env = ProcessInfo.processInfo.environment
        env["PR_HELPER_GIT_DESKTOP"] = "1"
        // Legacy alias for older bundled servers; the current server accepts both.
        env["GIT2_DESKTOP"] = "1"
        process.environment = env

        let outPipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe

        outPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.bufferQueue.async {
                self?.outputBuffer.append(data)
                self?.processBuffer()
            }
        }
        errPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { FileHandle.standardError.write(data) }
        }

        process.terminationHandler = { [weak self] exited in
            DispatchQueue.main.async {
                // A crash after startup would otherwise leave a dead window
                // with no explanation. Ignore exits caused by our own quit.
                guard let self = self, !self.isTerminating else { return }
                self.showFatal(
                    "Local server stopped",
                    "The Node.js server exited with status \(exited.terminationStatus).",
                )
            }
        }

        do {
            try process.run()
            server = process
        } catch {
            showFatal("Failed to start server", String(describing: error))
        }
    }

    private func processBuffer() {
        while let newline = outputBuffer.range(of: Data([0x0A])) {
            let lineData = outputBuffer.subdata(in: 0..<newline.lowerBound)
            outputBuffer.removeSubrange(0..<newline.upperBound)
            guard let line = String(data: lineData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespaces) else { continue }
            // Accept both the current and legacy readiness prefixes so the
            // shell keeps working with old and new bundled servers.
            let prefixes = ["PR_HELPER_GIT_READY ", "GIT2_READY "]
            guard let prefix = prefixes.first(where: { line.hasPrefix($0) }) else { continue }
            guard readyPort == nil else { continue }
            let payload = String(line.dropFirst(prefix.count))
            guard let data = payload.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let port = json["port"] as? Int,
                  let token = json["token"] as? String else { continue }
            readyPort = port
            readyToken = token
            readySemaphore.signal()
        }
    }

    // GUI-launched processes inherit a minimal PATH that omits Homebrew, so
    // resolve Node.js against the common install locations explicitly. A
    // distribution build may carry its own official Node runtime instead.
    private func locateNode() -> String? {
        if let resourcePath = Bundle.main.resourcePath {
            let bundled = (resourcePath as NSString).appendingPathComponent("runtime/node")
            if FileManager.default.isExecutableFile(atPath: bundled) {
                return bundled
            }
        }
        let candidates = [
            "/opt/homebrew/bin/node",
            "/opt/homebrew/opt/node/bin/node",
            "/usr/local/bin/node",
            "/usr/local/opt/node/bin/node",
            "/usr/bin/node",
        ]
        if let found = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return found
        }
        // GUI-launched apps inherit a minimal PATH, so version managers that
        // only modify the login shell are invisible here. Probe their usual
        // install roots before giving up.
        let home = FileManager.default.homeDirectoryForCurrentUser
        let managerPaths = [
            home.appendingPathComponent(".volta/bin/node").path,
            home.appendingPathComponent(".asdf/shims/node").path,
            home.appendingPathComponent(".local/bin/node").path,
            "/opt/local/bin/node",
        ]
        if let found = managerPaths.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return found
        }
        // nvm keeps one directory per installed version; pick the newest.
        let nvmRoot = home.appendingPathComponent(".nvm/versions/node")
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmRoot.path) {
            let newest = versions
                .sorted { $0.compare($1, options: .numeric) == .orderedDescending }
                .first
            if let newest = newest {
                let path = nvmRoot.appendingPathComponent(newest).appendingPathComponent("bin/node").path
                if FileManager.default.isExecutableFile(atPath: path) { return path }
            }
        }
        return nil
    }

    // MARK: Menu

    private func setupMenu() {
        let appName = "PR Helper Git"
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "About \(appName)",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: "",
        )
        let checkUpdates = NSMenuItem(
            title: "Check for Updates…",
            action: #selector(checkForUpdates),
            keyEquivalent: "",
        )
        checkUpdates.target = self
        appMenu.addItem(checkUpdates)
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Hide \(appName)",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h",
        )
        let hideOthers = NSMenuItem(
            title: "Hide Others",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h",
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(
            withTitle: "Show All",
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: "",
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit \(appName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q",
        )
        appMenuItem.submenu = appMenu

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(
            withTitle: "Open Repository…",
            action: #selector(chooseRepository),
            keyEquivalent: "o",
        )
        fileMenuItem.submenu = fileMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reloadWebView), keyEquivalent: "r")
        viewMenuItem.submenu = viewMenu

        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(
            withTitle: "Minimize",
            action: #selector(NSWindow.performMiniaturize(_:)),
            keyEquivalent: "m",
        )
        windowMenu.addItem(
            withTitle: "Zoom",
            action: #selector(NSWindow.performZoom(_:)),
            keyEquivalent: "",
        )
        windowMenuItem.submenu = windowMenu

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    @objc private func reloadWebView() {
        webView?.reload()
    }

    // Lightweight update check: read the latest GitHub Release and offer the
    // release page. It never downloads or replaces the app; that remains a
    // deliberate manual action until signed artifacts are available.
    @objc private func checkForUpdates() {
        let currentVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString",
        ) as? String ?? "0.0.0"
        guard let url = URL(string: "https://api.github.com/repos/bayernjf/pr-helper-git/releases/latest") else {
            presentUpdateAlert(
                title: "Update check failed",
                message: "The release endpoint is not a valid URL.",
            )
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("PR Helper Git/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let error = error {
                    self.presentUpdateAlert(
                        title: "Update check failed",
                        message: "Could not reach GitHub Releases: \(error.localizedDescription)",
                    )
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    self.presentUpdateAlert(
                        title: "Update check failed",
                        message: "GitHub Releases returned an invalid response.",
                    )
                    return
                }
                if http.statusCode == 404 {
                    self.presentUpdateAlert(
                        title: "No releases found",
                        message: "This repository has no published GitHub Release yet.",
                    )
                    return
                }
                guard (200..<300).contains(http.statusCode) else {
                    self.presentUpdateAlert(
                        title: "Update check failed",
                        message: "GitHub Releases returned HTTP \(http.statusCode).",
                    )
                    return
                }
                guard
                    let data = data,
                    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let tag = json["tag_name"] as? String,
                    let releaseURLString = json["html_url"] as? String,
                    let releaseURL = URL(string: releaseURLString)
                else {
                    self.presentUpdateAlert(
                        title: "Update check failed",
                        message: "The GitHub Releases response did not contain a release tag and URL.",
                    )
                    return
                }
                if isVersionNewer(tag, than: currentVersion) {
                    self.presentUpdateAlert(
                        title: "A new version is available",
                        message: "\(tag) is available. You are running \(currentVersion).",
                        openURL: releaseURL,
                    )
                } else {
                    self.presentUpdateAlert(
                        title: "You're up to date",
                        message: "You are running \(currentVersion), the latest published release.",
                    )
                }
            }
        }.resume()
    }

    private func presentUpdateAlert(title: String, message: String, openURL: URL? = nil) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        if let openURL = openURL {
            alert.addButton(withTitle: "Open Release Page")
            alert.addButton(withTitle: "Later")
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(openURL)
            }
        } else {
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    @objc private func chooseRepository() {
        let panel = NSOpenPanel()
        panel.title = "Open Repository"
        panel.message = "Choose a folder that contains a Git repository."
        panel.prompt = "Open"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.openRepository(path: url.path)
        }
    }

    private func openRepository(path: String) {
        guard webView.url != nil else {
            pendingOpenPath = path
            return
        }
        sendOpenRepository(path: path)
    }

    private func sendOpenRepository(path: String) {
        guard let data = try? JSONSerialization.data(
            withJSONObject: path,
            options: [.fragmentsAllowed],
        ), let json = String(data: data, encoding: .utf8) else { return }
        let script = "window.__prHelperGitPendingOpenPath = \(json); window.dispatchEvent(new CustomEvent('git2:add-repo', { detail: { path: \(json) } }));"
        webView.evaluateJavaScript(script) { _, error in
            if let error = error {
                NSLog("desktop open-repository bridge failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: Window

    private func setupWindow() {
        let configuration = WKWebViewConfiguration()
        // The persistent store keeps localStorage preferences across launches.
        configuration.websiteDataStore = .default()
        // Theme bridge: the web client reports dark/light so the window
        // chrome (titlebar) matches the content instead of following the
        // system appearance (P4-3 desktop).
        configuration.userContentController.add(self, name: "themeSync")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.addObserver(self, forKeyPath: #keyPath(WKWebView.title), options: .new, context: nil)

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false,
        )
        window.center()
        window.title = "PR Helper Git"
        window.minSize = NSSize(width: 900, height: 600)
        // Transparent titlebar over the dark window background: the web
        // toolbar fills the top edge, so no light strip can appear. The web
        // client corrects the appearance via the themeSync bridge on load.
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(red: 0x10 / 255.0, green: 0x12 / 255.0, blue: 0x16 / 255.0, alpha: 1)
        // Persist and restore the window position/size across launches. On the
        // first run there is no saved frame, so the centering above is used.
        window.setFrameAutosaveName("PR Helper Git Main Window")
        window.contentView = webView
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
    }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?,
    ) {
        if keyPath == #keyPath(WKWebView.title) {
            let title = webView.title ?? ""
            window.title = title.isEmpty ? "PR Helper Git" : title
        }
    }

    // Open pop-up/navigation targets inside the same view instead of a dead link.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures,
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if isLocalURL(url) {
            webView.load(URLRequest(url: url))
        } else {
            // GitHub, docs and other external links belong in the user's browser,
            // not in the app's single localhost window.
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void,
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if #available(macOS 11.3, *), navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        if isLocalURL(url) || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    @available(macOS 11.3, *)
    func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload,
    ) {
        download.delegate = self
    }

    @available(macOS 11.3, *)
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void,
    ) {
        let destination = availableDownloadURL(filename: suggestedFilename)
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    @available(macOS 11.3, *)
    func downloadDidFinish(_ download: WKDownload) {
        guard let destination = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else {
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([destination])
    }

    @available(macOS 11.3, *)
    func download(
        _ download: WKDownload,
        didFailWithError error: Error,
        resumeData: Data?,
    ) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Download failed"
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let path = pendingOpenPath else { return }
        pendingOpenPath = nil
        sendOpenRepository(path: path)
    }

    private func isLocalURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host?.lowercased()
        else { return false }
        return host == "127.0.0.1" || host == "localhost"
    }

    // MARK: Theme bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "themeSync", let mode = message.body as? String else { return }
        let light = mode == "light"
        window.appearance = NSAppearance(named: light ? .aqua : .darkAqua)
        window.backgroundColor = light
            ? NSColor(red: 0.97, green: 0.97, blue: 0.98, alpha: 1)
            : NSColor(red: 0x10 / 255.0, green: 0x12 / 255.0, blue: 0x16 / 255.0, alpha: 1)
    }

    // MARK: Errors

    private func showFatal(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }
}

// Single-instance guard: a second launch (double-click, launcher, direct
// binary) must activate the existing window instead of spawning another app
// plus another loopback server. Runs before anything else starts.
let bundleID = Bundle.main.bundleIdentifier ?? "local.pr-helper-git"
let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
if let existing = running.first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
    existing.unhide()
    existing.activate(options: [.activateAllWindows])
    exit(0)
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.activate(ignoringOtherApps: true)
application.run()
