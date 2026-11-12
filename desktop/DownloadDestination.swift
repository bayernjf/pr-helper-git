import Foundation

func downloadDirectory() -> URL {
    FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        ?? URL(fileURLWithPath: NSTemporaryDirectory())
}

// Keeps the suggested name but never trusts it as a path: only the last path
// component is used, and collisions get a -2/-3 suffix before the extension.
func availableDownloadURL(filename: String, directory: URL = downloadDirectory()) -> URL {
    let safeName = (filename as NSString).lastPathComponent
    let name = safeName.isEmpty ? "download" : safeName
    let ext = (name as NSString).pathExtension
    let base = (name as NSString).deletingPathExtension
    var candidate = directory.appendingPathComponent(name)
    var suffix = 2
    while FileManager.default.fileExists(atPath: candidate.path) {
        let next = ext.isEmpty ? "\(base)-\(suffix)" : "\(base)-\(suffix).\(ext)"
        candidate = directory.appendingPathComponent(next)
        suffix += 1
    }
    return candidate
}
