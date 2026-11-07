// Native macOS shell for PR Helper Git2. It hosts the existing web client in
// a WKWebView and manages the lifetime of the bundled Node.js loopback server.
// No third-party runtime is bundled: WKWebView and Swift are part of macOS,
// and the already-installed Node.js binary is located at well-known paths.
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private let readySemaphore = DispatchSemaphore(value: 0)
    private var readyPort: Int?
    private var readyToken: String?
    private var isTerminating = false
    private var outputBuffer = Data()
    private let bufferQueue = DispatchQueue(label: "local.pr-helper-git2.stdout")

    // MARK: Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let node = locateNode() else {
            showFatal(
                "Node.js not found",
                "The desktop app needs Node.js. Install it (for example: brew install node) and relaunch.",
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
            let prefix = "GIT2_READY "
            guard line.hasPrefix(prefix) else { continue }
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
    // resolve Node.js against the common install locations explicitly.
    private func locateNode() -> String? {
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

    // MARK: Window

    private func setupWindow() {
        let configuration = WKWebViewConfiguration()
        // The persistent store keeps localStorage preferences across launches.
        configuration.websiteDataStore = .default()
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
        window.title = "PR Helper Git2"
        // Persist and restore the window position/size across launches. On the
        // first run there is no saved frame, so the centering above is used.
        window.setFrameAutosaveName("PR Helper Git2 Main Window")
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
            window.title = title.isEmpty ? "PR Helper Git2" : title
        }
    }

    // Open pop-up/navigation targets inside the same view instead of a dead link.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures,
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
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

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.activate(ignoringOtherApps: true)
application.run()
