import Foundation

// Compares dotted release versions such as "0.2.5" and "v0.2.6". A leading
// "v" is ignored; prerelease suffixes are treated as the same base version so
// the lightweight checker does not offer a prerelease as newer.
func isVersionNewer(_ candidate: String, than current: String) -> Bool {
    let candidateParts = versionParts(candidate)
    let currentParts = versionParts(current)
    let count = max(candidateParts.count, currentParts.count)
    for index in 0..<count {
        let candidateValue = index < candidateParts.count ? candidateParts[index] : 0
        let currentValue = index < currentParts.count ? currentParts[index] : 0
        if candidateValue != currentValue {
            return candidateValue > currentValue
        }
    }
    return false
}

private func versionParts(_ value: String) -> [Int] {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let withoutPrefix = trimmed.hasPrefix("v") ? String(trimmed.dropFirst()) : trimmed
    let base = withoutPrefix.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)[0]
    return base.split(separator: ".").compactMap { Int($0) }
}
