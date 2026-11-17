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

final class UpdateManager {
    let repo = "bayernjf/pr-helper-git"
    let appName = "PR Helper Git"
    let currentVersion: String

    init() {
        currentVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "0.0.0"
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

    private var progressAlert: NSAlert?
    private var progressIndicator: NSProgressIndicator?
    private var progressStatus: NSTextField?
    private var progressDetail: NSTextField?
    private var activeDownloadTask: URLSessionDownloadTask?
    private var activeDownloadSession: URLSession?
    private var activeDownloadDelegate: DownloadDelegate?
    private var activeTemporaryDirectory: URL?
    private var isCancelling = false

    // MARK: Public entry

    func check(from window: NSWindow) {
        fetchLatest { result in
            DispatchQueue.main.async {
                switch result {
                case .failure(let error):
                    self.alert(title: "Update check failed", message: error.description)
                case .success(let release):
                    if isVersionNewer(release.version, than: self.currentVersion) {
                        self.promptUpdate(release, from: window)
                    } else {
                        self.alert(
                            title: "You're up to date",
                            message: "You are running \(self.currentVersion), the latest published release."
                        )
                    }
                }
            }
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
            alert(title: "Update failed", message: "Could not create a temporary directory: \(error.localizedDescription)")
            return
        }
        let dmgPath = tmp.appendingPathComponent("\(appName)-\(release.version)-macos.dmg")
        let sumsPath = tmp.appendingPathComponent("SHA256SUMS")

        isCancelling = false
        activeTemporaryDirectory = tmp
        showProgressAlert(for: release, in: window)
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

    private func showProgressAlert(for release: Release, in window: NSWindow) {
        let alert = NSAlert()
        alert.messageText = "Downloading \(release.tag)"
        alert.informativeText = "The update is downloading in the background. You can keep working."
        alert.addButton(withTitle: "Cancel")

        let accessory = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 66))

        let status = NSTextField(labelWithString: "Preparing download…")
        status.frame = NSRect(x: 0, y: 44, width: 360, height: 18)
        status.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize, weight: .medium)
        status.textColor = .labelColor
        status.lineBreakMode = .byTruncatingTail

        let progress = NSProgressIndicator(frame: NSRect(x: 0, y: 24, width: 360, height: 14))
        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 1
        progress.doubleValue = 0
        progress.controlSize = .small

        let detail = NSTextField(labelWithString: "Connecting…")
        detail.frame = NSRect(x: 0, y: 0, width: 360, height: 16)
        detail.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        detail.textColor = .secondaryLabelColor
        detail.lineBreakMode = .byTruncatingTail

        accessory.addSubview(status)
        accessory.addSubview(progress)
        accessory.addSubview(detail)
        alert.accessoryView = accessory

        progressAlert = alert
        progressIndicator = progress
        progressStatus = status
        progressDetail = detail
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self, self.progressAlert === alert else { return }
            if response == .alertFirstButtonReturn {
                self.cancelDownload()
            }
        }
    }

    private func updateProgress(fraction: Double, written: Int64, expected: Int64) {
        guard let progressIndicator else { return }
        let clamped = min(max(fraction, 0), 1)
        progressIndicator.isIndeterminate = expected <= 0
        if expected > 0 {
            progressIndicator.doubleValue = clamped
        }
        let percent = Int((clamped * 100).rounded())
        let writtenText = ByteCountFormatter.string(fromByteCount: written, countStyle: .file)
        if expected > 0 {
            let expectedText = ByteCountFormatter.string(fromByteCount: expected, countStyle: .file)
            progressStatus?.stringValue = "Downloading update… \(percent)%"
            progressDetail?.stringValue = "\(writtenText) of \(expectedText)"
        } else {
            progressStatus?.stringValue = "Downloading update…"
            progressDetail?.stringValue = writtenText
        }
    }

    private func updateStatus(_ status: String, detail: String? = nil) {
        progressStatus?.stringValue = status
        if let detail {
            progressDetail?.stringValue = detail
        }
    }

    private func finishProgress() {
        guard let alert = progressAlert else { return }
        progressAlert = nil
        progressIndicator = nil
        progressStatus = nil
        progressDetail = nil
        if let parent = alert.window.sheetParent {
            parent.endSheet(alert.window)
        } else {
            alert.window.orderOut(nil)
        }
    }

    private func cancelDownload() {
        guard !isCancelling else { return }
        isCancelling = true
        activeDownloadTask?.cancel()
        activeDownloadSession?.invalidateAndCancel()
        activeDownloadSession = nil
        activeDownloadDelegate = nil
        activeDownloadTask = nil
        finishProgress()
        if let tmp = activeTemporaryDirectory {
            try? FileManager.default.removeItem(at: tmp)
            activeTemporaryDirectory = nil
        }
    }

    private func fail(message: String) {
        finishProgress()
        if let tmp = activeTemporaryDirectory {
            try? FileManager.default.removeItem(at: tmp)
            activeTemporaryDirectory = nil
        }
        alert(title: "Update failed", message: message)
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

        finishProgress()
        promptInstall(release: release, dmgPath: dmgPath, tmp: tmp)
    }

    private func promptInstall(release: Release, dmgPath: URL, tmp: URL) {
        let alert = NSAlert()
        alert.messageText = "Update downloaded and verified"
        alert.informativeText = "\(release.tag) is ready to install. The app will quit, replace itself, and reopen."
        alert.addButton(withTitle: "Install & Restart")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn {
            install(release: release, dmgPath: dmgPath, tmp: tmp)
        } else {
            try? FileManager.default.removeItem(at: tmp)
            activeTemporaryDirectory = nil
        }
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
