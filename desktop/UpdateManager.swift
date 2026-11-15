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

struct UpdateManager {
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

    // MARK: Public entry

    func check(from window: NSWindow) {
        fetchLatest { result in
            DispatchQueue.main.async {
                switch result {
                case .failure(let error):
                    self.alert(title: "Update check failed", message: error.description)
                case .success(let release):
                    if isVersionNewer(release.version, than: self.currentVersion) {
                        self.promptUpdate(release)
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
            let dmgName = "\(appName)-\(version)-macos.dmg"
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

    private func promptUpdate(_ release: Release) {
        let alert = NSAlert()
        alert.messageText = "A new version is available"
        alert.informativeText = "\(release.tag) is available. You are running \(currentVersion).\n\nDownload and install it now?"
        alert.addButton(withTitle: "Download & Install")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn {
            downloadAndInstall(release)
        }
    }

    private func downloadAndInstall(_ release: Release) {
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

        // Download both files, then verify, then hand off to the helper script.
        download(url: release.dmgURL, to: dmgPath) { dmgError in
            if let dmgError = dmgError {
                self.alert(title: "Update failed", message: dmgError)
                return
            }
            self.download(url: release.checksumsURL, to: sumsPath) { sumsError in
                if let sumsError = sumsError {
                    self.alert(title: "Update failed", message: sumsError)
                    return
                }
                self.verifyAndInstall(release: release, dmgPath: dmgPath, sumsPath: sumsPath, tmp: tmp)
            }
        }
    }

    private func download(url: URL, to destination: URL, completion: @escaping (String?) -> Void) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 120
        URLSession.shared.downloadTask(with: request) { tempURL, _, error in
            // URLSession callbacks arrive off the main thread; bounce back so
            // every downstream UI action (NSAlert, NSApp.terminate) is safe.
            DispatchQueue.main.async {
                if let error = error {
                    completion("Download failed: \(error.localizedDescription)")
                    return
                }
                guard let tempURL = tempURL else {
                    completion("Download failed: no data received.")
                    return
                }
                do {
                    try FileManager.default.moveItem(at: tempURL, to: destination)
                    completion(nil)
                } catch {
                    completion("Could not save the download: \(error.localizedDescription)")
                }
            }
        }.resume()
    }

    private func verifyAndInstall(release: Release, dmgPath: URL, sumsPath: URL, tmp: URL) {
        do {
            let sums = try String(contentsOf: sumsPath, encoding: .utf8)
            let dmgName = dmgPath.lastPathComponent
            guard let expected = expectedChecksum(for: dmgName, in: sums) else {
                alert(title: "Update failed", message: "The checksum file does not contain an entry for \(dmgName).")
                return
            }
            let actual = try sha256(of: dmgPath)
            guard actual.lowercased() == expected.lowercased() else {
                alert(
                    title: "Update failed",
                    message: "Checksum mismatch — the download may be corrupted or tampered with. Aborting."
                )
                return
            }
        } catch {
            alert(title: "Update failed", message: "Could not verify the download: \(error.localizedDescription)")
            return
        }

        install(release: release, dmgPath: dmgPath, tmp: tmp)
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
}
