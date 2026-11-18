// App update flow: check GitHub Releases, download the dmg, verify its
// SHA-256 against the published SHA256SUMS, then hand off to a detached shell
// script that replaces the running app and relaunches it. No Apple Developer
// ID / notarization is required: integrity is anchored on the checksums the
// release author publishes alongside the artifact.
//
// The running app cannot replace itself (macOS locks the executable), so the
// actual swap runs in a short-lived /bin/sh helper after the app quits.

import Foundation
import AppKit
import CommonCrypto

final class UpdateManager: NSObject, NSWindowDelegate {
    let repo = "bayernjf/pr-helper-git"
    let appName = "PR Helper Git"
    let currentVersion: String

    override init() {
        currentVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "0.0.0"
        super.init()
    }

    // A released update, parsed from the /releases/latest JSON.
    struct Release {
        let tag: String
        let version: String
        let dmgURL: URL
        let checksumsURL: URL
    }

    struct UpdateError: Error, CustomStringConvertible {
        let message: String
        var description: String { message }
    }

    // MARK: Update progress state

    private var progressWindow: NSWindow?
    private var progressTitle: NSTextField?
    private var progressStatus: NSTextField?
    private var progressIndicator: NSProgressIndicator?
    private var progressDetail: NSTextField?
    private var progressNote: NSTextField?
    private var cancelButton: NSButton?
    private var installButton: NSButton?
    private var laterButton: NSButton?
    private var retryButton: NSButton?
    private var progressMode: ProgressMode = .downloading
    private var pendingRelease: Release?
    private var pendingDmgPath: URL?
    private var pendingTmp: URL?
    private var isClosingProgressWindow = false
    private var activeDownloadTask: URLSessionDownloadTask?
    private var activeDownloadSession: URLSession?
    private var activeDownloadDelegate: DownloadDelegate?
    private var activeTemporaryDirectory: URL?
    private var isCancelling = false
    // Download speed is sampled roughly once per second and smoothed; it is
    // reset for every attempt so a retry starts from "calculating", not from
    // the previous attempt's stale rate.
    private var lastSpeedSample: (date: Date, bytes: Int64)?
    private var smoothedBytesPerSecond: Double = 0

    private enum ProgressMode {
        case downloading
        case ready
        case failed
    }

    enum MenuState {
        case idle
        case checking
        case downloading(version: String, fraction: Double)
        case ready(version: String)
        case failed
    }

    var onMenuStateChange: ((MenuState) -> Void)?

    private func notifyMenu(_ state: MenuState) {
        onMenuStateChange?(state)
    }

    // MARK: Public entry

    func check(from window: NSWindow) {
        notifyMenu(.checking)
        fetchLatest { result in
            DispatchQueue.main.async {
                switch result {
                case .failure(let error):
                    self.notifyMenu(.idle)
                    self.alert(title: "Update check failed", message: error.description)
                case .success(let release):
                    if isVersionNewer(release.version, than: self.currentVersion) {
                        self.notifyMenu(.idle)
                        self.promptUpdate(release, from: window)
                    } else {
                        self.notifyMenu(.idle)
                        self.alert(
                            title: "You're up to date",
                            message: "You are running \(self.currentVersion), the latest published release."
                        )
                    }
                }
            }
        }
    }

    func checkOrShowProgress(from window: NSWindow) {
        if progressMode == .failed, pendingRelease != nil {
            // A failed download keeps the release and the progress window;
            // the menu item becomes a one-click retry instead of forcing the
            // user back through Check for Updates and Download.
            retryDownload(from: window)
        } else if progressWindow != nil {
            showProgressWindow()
        } else {
            check(from: window)
        }
    }

    // MARK: Fetch + parse

    // Shared proxy egress IPs exhaust GitHub's unauthenticated API quota
    // (60/h per IP), so a proxied check can 403 while a direct one succeeds.
    // Retry once without the system proxy before giving up.
    static let directSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        return URLSession(configuration: configuration)
    }()

    private func fetchLatest(completion: @escaping (Result<Release, UpdateError>) -> Void) {
        guard let url = URL(string: "https://api.github.com/repos/\(repo)/releases/latest") else {
            completion(.failure(UpdateError(message: "The release endpoint is not a valid URL.")))
            return
        }
        fetchLatest(url: url, session: URLSession.shared, fallbackSession: Self.directSession, completion: completion)
    }

    func fetchLatest(
        url: URL,
        session: URLSession,
        fallbackSession: URLSession?,
        completion: @escaping (Result<Release, UpdateError>) -> Void
    ) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("PR Helper Git/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        session.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(UpdateError(message: "Could not reach GitHub Releases: \(error.localizedDescription)")))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failure(UpdateError(message: "GitHub Releases returned an invalid response.")))
                return
            }
            if http.statusCode == 403, let fallbackSession = fallbackSession {
                self.fetchLatest(url: url, session: fallbackSession, fallbackSession: nil, completion: completion)
                return
            }
            if http.statusCode == 404 {
                completion(.failure(UpdateError(message: "This repository has no published GitHub Release yet.")))
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                let detail = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])?["message"] as? String
                let suffix = detail.map { " \($0)" } ?? ""
                completion(.failure(UpdateError(message: "GitHub Releases returned HTTP \(http.statusCode).\(suffix)")))
                return
            }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = json["tag_name"] as? String else {
                completion(.failure(UpdateError(message: "The GitHub Releases response did not contain a release tag.")))
                return
            }
            let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
            guard let assets = json["assets"] as? [[String: Any]] else {
                completion(.failure(UpdateError(message: "The GitHub Release has no downloadable assets.")))
                return
            }
            let dmgName = "\(self.appName)-\(version)-macos.dmg"
            guard let dmg = assets.first(where: { ($0["name"] as? String).map(githubSanitized) == githubSanitized(dmgName) }),
                  let dmgURLString = dmg["browser_download_url"] as? String,
                  let dmgURL = URL(string: dmgURLString) else {
                completion(.failure(UpdateError(message: "The \(dmgName) asset is missing from this release.")))
                return
            }
            let checksumName = "SHA256SUMS"
            guard let sums = assets.first(where: { ($0["name"] as? String) == checksumName }),
                  let sumsURLString = sums["browser_download_url"] as? String,
                  let sumsURL = URL(string: sumsURLString) else {
                completion(.failure(UpdateError(message: "The \(checksumName) asset is missing from this release.")))
                return
            }
            completion(.success(Release(tag: tag, version: version, dmgURL: dmgURL, checksumsURL: sumsURL)))
        }.resume()
    }

    // MARK: Update flow

    private func promptUpdate(_ release: Release, from window: NSWindow) {
        let alert = NSAlert()
        alert.messageText = "A new version is available"
        alert.informativeText = "\(release.tag) is available. You are running \(currentVersion).\n\nDownload it now? You can review progress and confirm installation after the download finishes."
        alert.addButton(withTitle: "Download")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn {
            downloadAndInstall(release, from: window)
        }
    }

    private func downloadAndInstall(_ release: Release, from window: NSWindow) {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("pr-helper-git-update-\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        } catch {
            notifyMenu(.idle)
            alert(title: "Update failed", message: "Could not create a temporary directory: \(error.localizedDescription)")
            return
        }
        let dmgPath = tmp.appendingPathComponent("\(appName)-\(release.version)-macos.dmg")
        let sumsPath = tmp.appendingPathComponent("SHA256SUMS")

        isCancelling = false
        activeTemporaryDirectory = tmp
        pendingRelease = release
        showProgressWindow(for: release, in: window)
        resetProgressWindow(for: release)
        lastSpeedSample = nil
        smoothedBytesPerSecond = 0
        notifyMenu(.downloading(version: release.version, fraction: 0))
        updateStatus("Connecting to GitHub Releases…", detail: "Preparing download")

        // Download both files, then verify, then hand off to the helper script.
        download(url: release.dmgURL, to: dmgPath, progress: { [weak self] fraction, written, expected in
            self?.updateProgress(fraction: fraction, written: written, expected: expected)
        }) { [self] dmgResult in
            guard !isCancelling else { return }
            if case .failure(let error) = dmgResult {
                fail(message: error.localizedDescription)
                return
            }
            updateStatus("Download complete — verifying checksum…", detail: "Checking SHA-256")
            download(url: release.checksumsURL, to: sumsPath, progress: nil) { [self] sumsResult in
                guard !isCancelling else { return }
                if case .failure(let error) = sumsResult {
                    fail(message: error.localizedDescription)
                    return
                }
                verifyAndInstall(release: release, dmgPath: dmgPath, sumsPath: sumsPath, tmp: tmp)
            }
        }
    }

    private func showProgressWindow(for release: Release, in parent: NSWindow) {
        if let existing = progressWindow {
            existing.makeKeyAndOrderFront(nil)
            return
        }

        // A real, miniaturizable window, not a sheet. Sheets block the main
        // window until dismissed; a separate window lets the user minimize the
        // progress panel, keep working, and reopen it from the Dock / Window
        // menu while the download continues.
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 240),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Downloading \(release.tag)"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()

        let content = NSView(frame: NSRect(x: 0, y: 0, width: 440, height: 240))
        window.contentView = content

        let title = NSTextField(labelWithString: "Downloading \(release.tag)")
        title.frame = NSRect(x: 20, y: 198, width: 400, height: 24)
        title.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        title.textColor = .labelColor
        title.lineBreakMode = .byTruncatingTail

        let status = NSTextField(labelWithString: "Connecting to GitHub Releases…")
        status.frame = NSRect(x: 20, y: 162, width: 400, height: 20)
        status.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        status.textColor = .labelColor
        status.lineBreakMode = .byTruncatingTail

        let progress = NSProgressIndicator(frame: NSRect(x: 20, y: 136, width: 400, height: 14))
        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 1
        progress.doubleValue = 0
        progress.controlSize = .small

        let detail = NSTextField(labelWithString: "Preparing download")
        detail.frame = NSRect(x: 20, y: 112, width: 400, height: 18)
        detail.font = NSFont.systemFont(ofSize: 12)
        detail.textColor = .secondaryLabelColor
        detail.lineBreakMode = .byTruncatingTail

        let note = NSTextField(labelWithString: "You can minimize this window and keep working. Restore it from the Dock or Window menu to check progress.")
        note.frame = NSRect(x: 20, y: 72, width: 400, height: 32)
        note.font = NSFont.systemFont(ofSize: 11)
        note.textColor = .secondaryLabelColor
        note.lineBreakMode = .byWordWrapping
        note.maximumNumberOfLines = 2

        let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelButtonTapped))
        cancel.frame = NSRect(x: 328, y: 20, width: 92, height: 32)
        cancel.bezelStyle = .rounded
        cancel.keyEquivalent = "\u{1b}"

        let install = NSButton(title: "Install & Restart", target: self, action: #selector(installButtonTapped))
        install.frame = NSRect(x: 240, y: 20, width: 180, height: 32)
        install.bezelStyle = .rounded
        install.isHidden = true

        let later = NSButton(title: "Later", target: self, action: #selector(laterButtonTapped))
        later.frame = NSRect(x: 140, y: 20, width: 90, height: 32)
        later.bezelStyle = .rounded
        later.isHidden = true

        let retry = NSButton(title: "Retry", target: self, action: #selector(retryButtonTapped))
        retry.frame = NSRect(x: 240, y: 20, width: 80, height: 32)
        retry.bezelStyle = .rounded
        retry.isHidden = true

        content.addSubview(title)
        content.addSubview(status)
        content.addSubview(progress)
        content.addSubview(detail)
        content.addSubview(note)
        content.addSubview(cancel)
        content.addSubview(install)
        content.addSubview(later)
        content.addSubview(retry)

        progressWindow = window
        progressTitle = title
        progressStatus = status
        progressIndicator = progress
        progressDetail = detail
        progressNote = note
        cancelButton = cancel
        installButton = install
        laterButton = later
        retryButton = retry
        progressMode = .downloading

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        _ = parent
    }

    /// Put an existing progress window back into download mode. Used both for
    /// the first attempt and for a retry after a failure; without this, a
    /// retry would keep the "Update failed" title and hidden progress bar.
    private func resetProgressWindow(for release: Release) {
        progressMode = .downloading
        progressTitle?.stringValue = "Downloading \(release.tag)"
        progressStatus?.stringValue = "Connecting to GitHub Releases…"
        progressIndicator?.isHidden = false
        progressIndicator?.isIndeterminate = false
        progressIndicator?.doubleValue = 0
        progressDetail?.stringValue = "Preparing download"
        progressNote?.stringValue = "You can minimize this window and keep working. Restore it from the Dock or Window menu to check progress."
        cancelButton?.isHidden = false
        cancelButton?.title = "Cancel"
        cancelButton?.keyEquivalent = "\u{1b}"
        installButton?.isHidden = true
        laterButton?.isHidden = true
        retryButton?.isHidden = true
        progressWindow?.title = "Downloading \(release.tag)"
    }

    func showProgressWindow() {
        guard let window = progressWindow else { return }
        if window.isMiniaturized {
            window.deminiaturize(nil)
        }
        window.makeKeyAndOrderFront(nil)
    }

    @objc private func cancelButtonTapped() {
        switch progressMode {
        case .downloading:
            cancelDownload()
        case .ready:
            laterButtonTapped()
        case .failed:
            closeProgressWindow(removeTemp: true)
        }
    }

    @objc private func installButtonTapped() {
        guard let release = pendingRelease,
              let dmgPath = pendingDmgPath,
              let tmp = pendingTmp else { return }
        install(release: release, dmgPath: dmgPath, tmp: tmp)
    }

    @objc private func laterButtonTapped() {
        closeProgressWindow(removeTemp: true)
    }

    @objc private func retryButtonTapped() {
        guard let window = progressWindow else { return }
        retryDownload(from: window)
    }

    private func retryDownload(from window: NSWindow) {
        guard let release = pendingRelease else {
            check(from: window)
            return
        }
        cleanUpTemporaryDirectory()
        downloadAndInstall(release, from: window)
    }

    // Called by the title-bar close button. A normal close while downloading
    // must also cancel the network task; otherwise the progress panel would
    // disappear while bytes keep arriving with no visible owner.
    func windowWillClose(_ notification: Notification) {
        guard !isClosingProgressWindow,
              let window = notification.object as? NSWindow,
              window === progressWindow else { return }

        let wasDownloading = progressMode == .downloading
        clearProgressReferences()
        if wasDownloading {
            isCancelling = true
            stopActiveDownload()
        }
        cleanUpTemporaryDirectory()
        notifyMenu(.idle)
    }

    private func closeProgressWindow(removeTemp: Bool) {
        let window = progressWindow
        isClosingProgressWindow = true
        clearProgressReferences()
        window?.delegate = nil
        window?.close()
        isClosingProgressWindow = false
        if removeTemp {
            cleanUpTemporaryDirectory()
        }
        notifyMenu(.idle)
    }

    private func clearProgressReferences() {
        progressWindow = nil
        progressTitle = nil
        progressStatus = nil
        progressIndicator = nil
        progressDetail = nil
        progressNote = nil
        cancelButton = nil
        installButton = nil
        laterButton = nil
        retryButton = nil
        pendingRelease = nil
        pendingDmgPath = nil
        pendingTmp = nil
        lastSpeedSample = nil
        smoothedBytesPerSecond = 0
    }

    private func cleanUpTemporaryDirectory() {
        if let tmp = activeTemporaryDirectory {
            try? FileManager.default.removeItem(at: tmp)
            activeTemporaryDirectory = nil
        }
    }

    private func updateProgress(fraction: Double, written: Int64, expected: Int64) {
        guard progressMode == .downloading, let progressIndicator else { return }
        let clamped = min(max(fraction, 0), 1)
        progressIndicator.isIndeterminate = expected <= 0
        if expected > 0 {
            progressIndicator.doubleValue = clamped
        }
        let percent = Int((clamped * 100).rounded())
        let writtenText = ByteCountFormatter.string(fromByteCount: written, countStyle: .file)

        // Measure transfer rate on a ~1s cadence. A shorter window is noisy
        // (URLSession can report bursts), while a longer one makes the ETA
        // feel stale on a slow connection.
        let now = Date()
        if let sample = lastSpeedSample {
            let interval = now.timeIntervalSince(sample.date)
            if interval >= 1.0 {
                let delta = max(0, written - sample.bytes)
                if delta > 0 {
                    let instantaneous = Double(delta) / interval
                    smoothedBytesPerSecond = smoothedBytesPerSecond == 0
                        ? instantaneous
                        : smoothedBytesPerSecond * 0.7 + instantaneous * 0.3
                }
                lastSpeedSample = (now, written)
            }
        } else {
            lastSpeedSample = (now, written)
        }

        if expected > 0 {
            let expectedText = ByteCountFormatter.string(fromByteCount: expected, countStyle: .file)
            var detail = "\(writtenText) of \(expectedText)"
            if smoothedBytesPerSecond > 0 {
                let speedText = ByteCountFormatter.string(
                    fromByteCount: Int64(smoothedBytesPerSecond.rounded()),
                    countStyle: .file
                )
                detail += " · \(speedText)/s"
                let remainingSeconds = Double(expected - written) / smoothedBytesPerSecond
                if remainingSeconds.isFinite, remainingSeconds > 0 {
                    detail += " · \(remainingTimeText(seconds: remainingSeconds)) left"
                }
            }
            progressStatus?.stringValue = "Downloading update… \(percent)%"
            progressDetail?.stringValue = detail
        } else {
            progressStatus?.stringValue = "Downloading update…"
            progressDetail?.stringValue = writtenText
        }
        notifyMenu(.downloading(version: pendingRelease?.version ?? "", fraction: clamped))
    }

    private func remainingTimeText(seconds: Double) -> String {
        let total = max(1, Int(seconds.rounded()))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m \(secs)s" }
        return "\(secs)s"
    }

    private func updateStatus(_ status: String, detail: String? = nil) {
        guard progressMode == .downloading else { return }
        progressStatus?.stringValue = status
        if let detail {
            progressDetail?.stringValue = detail
        }
    }

    private func showInstallReady(release: Release, dmgPath: URL, tmp: URL) {
        pendingRelease = release
        pendingDmgPath = dmgPath
        pendingTmp = tmp
        progressMode = .ready
        progressTitle?.stringValue = "Update downloaded and verified"
        progressStatus?.stringValue = "\(release.tag) is ready to install"
        progressIndicator?.isHidden = false
        progressIndicator?.doubleValue = 1
        progressDetail?.stringValue = "SHA-256 checksum verified."
        progressNote?.stringValue = "Click Install & Restart to quit, replace the app, and reopen. You can minimize this window while you finish up."
        cancelButton?.isHidden = true
        installButton?.isHidden = false
        laterButton?.isHidden = false
        retryButton?.isHidden = true
        installButton?.keyEquivalent = "\r"
        progressWindow?.title = "Update ready — \(release.tag)"

        // Do not yank a minimized window back in front of the user. Bounce the
        // Dock icon instead so the ready state can be restored when convenient.
        if let window = progressWindow, window.isMiniaturized {
            NSApp.requestUserAttention(.informationalRequest)
        } else {
            progressWindow?.makeKeyAndOrderFront(nil)
        }
        notifyMenu(.ready(version: release.version))
    }

    private func showFailure(_ message: String) {
        guard progressWindow != nil else {
            // Without the progress window there is no retry context to keep;
            // report the error and return the menu to its normal state.
            notifyMenu(.idle)
            alert(title: "Update failed", message: message)
            return
        }
        progressMode = .failed
        progressTitle?.stringValue = "Update failed"
        progressStatus?.stringValue = "The update could not be completed."
        progressIndicator?.isHidden = true
        progressDetail?.stringValue = message
        progressNote?.stringValue = "Retry downloads this release again without leaving the window. Close leaves the app unchanged."
        installButton?.isHidden = true
        laterButton?.isHidden = true
        retryButton?.isHidden = false
        cancelButton?.isHidden = false
        cancelButton?.title = "Close"
        cancelButton?.keyEquivalent = "\u{1b}"
        progressWindow?.title = "Update failed"
        if let window = progressWindow, window.isMiniaturized {
            NSApp.requestUserAttention(.informationalRequest)
        }
        notifyMenu(.failed)
    }

    private func cancelDownload() {
        guard !isCancelling else { return }
        isCancelling = true
        stopActiveDownload()
        closeProgressWindow(removeTemp: true)
    }

    private func fail(message: String) {
        stopActiveDownload()
        cleanUpTemporaryDirectory()
        showFailure(message)
    }

    private func stopActiveDownload() {
        activeDownloadTask?.cancel()
        activeDownloadSession?.invalidateAndCancel()
        activeDownloadDelegate = nil
        activeDownloadTask = nil
        activeDownloadSession = nil
    }

    private func finishActiveDownload() {
        activeDownloadSession?.invalidateAndCancel()
        activeDownloadSession = nil
        activeDownloadDelegate = nil
        activeDownloadTask = nil
    }

    private func download(
        url: URL,
        to destination: URL,
        progress: ((Double, Int64, Int64) -> Void)?,
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        let delegate = DownloadDelegate(
            destination: destination,
            progress: progress,
            completion: { [self] result in
                finishActiveDownload()
                completion(result)
            }
        )
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 600
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: .main)
        let request = URLRequest(url: url)
        let task = session.downloadTask(with: request)
        activeDownloadSession = session
        activeDownloadDelegate = delegate
        activeDownloadTask = task
        task.resume()
    }

    private func verifyAndInstall(release: Release, dmgPath: URL, sumsPath: URL, tmp: URL) {
        do {
            let sums = try String(contentsOf: sumsPath, encoding: .utf8)
            let dmgName = dmgPath.lastPathComponent
            guard let expected = expectedChecksum(for: dmgName, in: sums) else {
                throw UpdateError(message: "The checksum file does not contain an entry for \(dmgName).")
            }
            let actual = try sha256(of: dmgPath)
            guard actual.lowercased() == expected.lowercased() else {
                throw UpdateError(
                    message: "Checksum mismatch — the download may be corrupted or tampered with. Aborting."
                )
            }
        } catch {
            fail(message: "Could not verify the download: \(error)")
            return
        }

        showInstallReady(release: release, dmgPath: dmgPath, tmp: tmp)
    }

    private func install(release: Release, dmgPath: URL, tmp: URL) {
        // Write a self-contained helper that waits for this app to quit, swaps
        // the bundle, and relaunches. It runs detached so it survives our own
        // termination. The dmg/target/tmp paths are Swift-interpolated into the
        // script; only MOUNT stays a shell-local variable.
        let scriptURL = tmp.appendingPathComponent("install.sh")
        let dmg = dmgPath.path
        let target = "/Applications/\(appName).app"
        let volumeName = appName
        let script = """
        #!/bin/sh
        set -e
        while pgrep -x "PR Helper Git" >/dev/null 2>&1; do sleep 0.3; done

        MOUNT=$(hdiutil attach "\(dmg)" -nobrowse -readonly | awk -F'\\t' '/\\/Volumes\\//{print $NF; exit}')
        if [ -z "$MOUNT" ]; then MOUNT="/Volumes/\(volumeName)"; fi
        trap 'hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true' EXIT

        rm -rf "\(target)"
        ditto "$MOUNT/\(volumeName).app" "\(target)"
        xattr -dr com.apple.quarantine "\(target)" 2>/dev/null || true

        hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
        trap - EXIT

        open "\(target)"
        rm -rf "\(tmp.path)"
        """
        do {
            try script.write(to: scriptURL, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)
        } catch {
            alert(title: "Update failed", message: "Could not prepare the installer: \(error.localizedDescription)")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [scriptURL.path]
        do {
            try process.run()
        } catch {
            alert(title: "Update failed", message: "Could not start the installer: \(error.localizedDescription)")
            return
        }
        // The helper waits for our exit; terminate now to let it proceed.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NSApp.terminate(nil)
        }
    }

    // MARK: Helpers

    private func expectedChecksum(for filename: String, in sums: String) -> String? {
        return sha256Entry(for: filename, in: sums)
    }

    private func sha256(of url: URL) throws -> String {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        var digest = [UInt8](repeating: 0, count: 32)
        data.withUnsafeBytes { raw in
            guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return }
            _ = CC_SHA256(base, CC_LONG(data.count), &digest)
        }
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func alert(title: String, message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // MARK: Download delegate

    private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
        private let destination: URL
        private let progress: ((Double, Int64, Int64) -> Void)?
        private let completion: (Result<URL, Error>) -> Void
        private var finished = false

        init(
            destination: URL,
            progress: ((Double, Int64, Int64) -> Void)?,
            completion: @escaping (Result<URL, Error>) -> Void
        ) {
            self.destination = destination
            self.progress = progress
            self.completion = completion
        }

        func urlSession(
            _ session: URLSession,
            downloadTask: URLSessionDownloadTask,
            didWriteData bytesWritten: Int64,
            totalBytesWritten: Int64,
            totalBytesExpectedToWrite: Int64
        ) {
            guard let progress else { return }
            let fraction = totalBytesExpectedToWrite > 0
                ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
                : 0
            progress(fraction, totalBytesWritten, totalBytesExpectedToWrite)
        }

        func urlSession(
            _ session: URLSession,
            downloadTask: URLSessionDownloadTask,
            didFinishDownloadingTo location: URL
        ) {
            do {
                if FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.removeItem(at: destination)
                }
                try FileManager.default.moveItem(at: location, to: destination)
                finish(.success(destination))
            } catch {
                finish(.failure(error))
            }
        }

        func urlSession(
            _ session: URLSession,
            task: URLSessionTask,
            didCompleteWithError error: Error?
        ) {
            if let error {
                finish(.failure(error))
            } else if !finished {
                finish(.failure(UpdateError(message: "Download completed without a saved file.")))
            }
        }

        private func finish(_ result: Result<URL, Error>) {
            guard !finished else { return }
            finished = true
            completion(result)
        }
    }
}
