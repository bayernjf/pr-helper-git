import Foundation

// GitHub replaces spaces with dots in uploaded asset names, while a locally
// generated SHA256SUMS keeps the space-bearing basename. Compare names in the
// sanitized form so both spellings resolve to the same entry.
func githubSanitized(_ name: String) -> String {
    name.replacingOccurrences(of: " ", with: ".")
}

// Extracts the SHA-256 hex digest for a given filename from a SHA256SUMS
// listing. Lines look like "<64-hex>  <basename>", and the filename may itself
// contain spaces (e.g. "PR Helper Git-0.3.0-macos.dmg"), so the split happens
// on the first run of whitespace, never on every space.
func sha256Entry(for filename: String, in sums: String) -> String? {
    let wanted = githubSanitized(filename)
    for line in sums.split(separator: "\n") {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard let spaceRange = trimmed.rangeOfCharacter(from: .whitespaces) else { continue }
        let hash = String(trimmed[..<spaceRange.lowerBound])
        let name = trimmed[spaceRange.upperBound...].trimmingCharacters(in: .whitespaces)
        guard githubSanitized(name) == wanted else { continue }
        return hash
    }
    return nil
}
