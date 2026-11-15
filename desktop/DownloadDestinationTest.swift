import Foundation

@main
struct DownloadDestinationTest {
    static func main() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("prh-download-test-\(UUID().uuidString)")
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        func touch(_ name: String) throws {
            let path = dir.appendingPathComponent(name).path
            guard fm.createFile(atPath: path, contents: Data()) else {
                throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "create \(name)"])
            }
        }

        try touch("pr-helper-git-team.json")
        try touch("pr-helper-git-team-2.json")
        let suffixed = availableDownloadURL(filename: "pr-helper-git-team.json", directory: dir)
        guard suffixed.lastPathComponent == "pr-helper-git-team-3.json" else {
            fatalError("expected -3 suffix, got \(suffixed.lastPathComponent)")
        }

        try touch("secret.json")
        let traversal = availableDownloadURL(filename: "../secret.json", directory: dir)
        guard traversal.lastPathComponent == "secret-2.json" else {
            fatalError("expected sanitized name, got \(traversal.lastPathComponent)")
        }

        try touch("archive")
        let noExtension = availableDownloadURL(filename: "archive", directory: dir)
        guard noExtension.lastPathComponent == "archive-2" else {
            fatalError("expected extensionless suffix, got \(noExtension.lastPathComponent)")
        }

        let empty = availableDownloadURL(filename: "", directory: dir)
        guard empty.lastPathComponent == "download" else {
            fatalError("expected fallback name, got \(empty.lastPathComponent)")
        }

        guard isVersionNewer("0.2.6", than: "0.2.5") else {
            fatalError("expected 0.2.6 to be newer than 0.2.5")
        }
        guard isVersionNewer("v0.3.0", than: "0.2.9") else {
            fatalError("expected v0.3.0 to be newer than 0.2.9")
        }
        guard !isVersionNewer("v0.2.5", than: "0.2.5") else {
            fatalError("expected equal versions not to be newer")
        }
        guard !isVersionNewer("0.2.5-rc1", than: "0.2.5") else {
            fatalError("expected prerelease not to outrank the release")
        }

        // SHA256SUMS parsing: the filename may contain spaces, so the digest
        // must still resolve against the full name, not the first word.
        let sums = """
        0695a27d9cb3443c1e4add6e0780e86b06e5441ad8cd825f2cf3e492b8bdc2e9  PR Helper Git-0.3.0-macos.zip
        03ca392f742fce41edf0908b05277dbc46fc52359d42ae43d4a52a0c07a86489  PR Helper Git-0.3.0-macos.dmg
        """
        guard sha256Entry(for: "PR Helper Git-0.3.0-macos.dmg", in: sums)
            == "03ca392f742fce41edf0908b05277dbc46fc52359d42ae43d4a52a0c07a86489" else {
            fatalError("expected checksum lookup to handle a spaced filename")
        }
        guard sha256Entry(for: "PR Helper Git-0.3.0-macos.zip", in: sums)
            == "0695a27d9cb3443c1e4add6e0780e86b06e5441ad8cd825f2cf3e492b8bdc2e9" else {
            fatalError("expected the zip checksum to resolve too")
        }
        guard sha256Entry(for: "missing.dmg", in: sums) == nil else {
            fatalError("expected a missing file to return no checksum")
        }
        guard sha256Entry(for: "PR.Helper.Git-0.3.0-macos.dmg", in: sums)
            == "03ca392f742fce41edf0908b05277dbc46fc52359d42ae43d4a52a0c07a86489" else {
            fatalError("expected GitHub's dot-sanitized asset name to resolve against a spaced SHA256SUMS entry")
        }

        print("download destination and update-check tests OK")
    }
}
