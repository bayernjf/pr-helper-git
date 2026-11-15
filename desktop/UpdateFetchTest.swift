import Foundation
import CFNetwork

// Exercises UpdateManager.fetchLatest against a local HTTP stub. A proxied
// URLSession sends absolute-form request lines ("GET http://…"), a direct one
// origin-form ("GET /…"); the stub 403s the former like an exhausted shared
// proxy egress, so the test proves the direct fallback really happens.
@main
struct UpdateFetchTest {
    static func main() throws {
        let stub = try StubServer()
        defer { stub.stop() }
        let base = URL(string: "http://127.0.0.1:\(stub.port)/repos/test/test/releases/latest")!

        let proxiedConfig = URLSessionConfiguration.ephemeral
        proxiedConfig.connectionProxyDictionary = [
            kCFNetworkProxiesHTTPEnable: true,
            kCFNetworkProxiesHTTPProxy: "127.0.0.1",
            kCFNetworkProxiesHTTPPort: Int(stub.port),
        ]
        let proxied = URLSession(configuration: proxiedConfig)
        let directConfig = URLSessionConfiguration.ephemeral
        directConfig.connectionProxyDictionary = [:]
        let direct = URLSession(configuration: directConfig)
        let manager = UpdateManager()

        let fallback = try awaitResult { done in
            manager.fetchLatest(url: base, session: proxied, fallbackSession: direct, completion: done)
        }
        guard case .success(let release) = fallback, release.tag == "v9.9.9" else {
            fatalError("expected proxied 403 to fall back to direct, got \(fallback)")
        }
        let forms = stub.requestLines()
        guard forms.contains(where: { $0.hasPrefix("GET http://") }),
              forms.contains(where: { $0.hasPrefix("GET /") }) else {
            fatalError("expected an absolute-form then an origin-form request, got \(forms)")
        }
        print("update-fetch: proxied 403 falls back to direct OK")

        stub.setMode(.always403)
        let exhausted = try awaitResult { done in
            manager.fetchLatest(url: base, session: proxied, fallbackSession: direct, completion: done)
        }
        guard case .failure(let error) = exhausted,
              error.message.contains("403"),
              error.message.contains("API rate limit exceeded") else {
            fatalError("expected both-path 403 to surface GitHub's message, got \(exhausted)")
        }
        print("update-fetch: exhausted both paths reports GitHub message OK")

        // Opt-in live proof against real GitHub with the production sessions
        // (skipped in CI: needs a network whose proxy egress is rate-limited).
        if ProcessInfo.processInfo.environment["PR_HELPER_UPDATE_LIVE"] == "1" {
            let liveURL = URL(string: "https://api.github.com/repos/bayernjf/pr-helper-git/releases/latest")!
            let live = try awaitResult { done in
                manager.fetchLatest(url: liveURL, session: URLSession.shared, fallbackSession: UpdateManager.directSession, completion: done)
            }
            guard case .success = live else {
                fatalError("live update check failed: \(live)")
            }
            print("update-fetch: live check via production sessions OK")
        }
    }

    static func awaitResult(
        _ run: (@escaping (Result<UpdateManager.Release, UpdateManager.UpdateError>) -> Void) -> Void
    ) throws -> Result<UpdateManager.Release, UpdateManager.UpdateError> {
        let semaphore = DispatchSemaphore(value: 0)
        var outcome: Result<UpdateManager.Release, UpdateManager.UpdateError>!
        run { result in
            outcome = result
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + 20) == .success else {
            fatalError("fetchLatest did not complete within 20s")
        }
        return outcome
    }
}

// POSIX socket stub: NWListener fails with EINVAL on some macOS releases,
// and a plain loopback socket has no framework quirks to fight.
final class StubServer {
    enum Mode { case formBased, always403 }
    var mode: Mode = .formBased
    let port: UInt16
    private let serverFD: Int32
    private let queue = DispatchQueue(label: "update-fetch-stub", attributes: .concurrent)
    private let lock = NSLock()
    private var lines: [String] = []
    private var running = true

    init() throws {
        serverFD = socket(AF_INET, SOCK_STREAM, 0)
        guard serverFD >= 0 else { fatalError("socket() failed") }
        var one: Int32 = 1
        setsockopt(serverFD, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr = in_addr(s_addr: UInt32(0x7F00_0001).bigEndian)
        let fd = serverFD
        let bound = withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0, listen(fd, 8) == 0 else { fatalError("bind/listen failed") }
        var assigned = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &assigned) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                _ = getsockname(fd, $0, &length)
            }
        }
        port = UInt16(bigEndian: assigned.sin_port)
        queue.async { [weak self] in self?.acceptLoop() }
    }

    func stop() {
        lock.lock()
        running = false
        lock.unlock()
        close(serverFD)
    }

    func setMode(_ newMode: Mode) {
        lock.lock()
        mode = newMode
        lock.unlock()
    }

    func requestLines() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return lines
    }

    private func acceptLoop() {
        while true {
            lock.lock()
            let alive = running
            lock.unlock()
            guard alive else { return }
            let client = accept(serverFD, nil, nil)
            guard client >= 0 else { return }
            queue.async { [weak self] in self?.handle(client) }
        }
    }

    private func handle(_ client: Int32) {
        var buffer = [UInt8](repeating: 0, count: 65536)
        let received = recv(client, &buffer, buffer.count, 0)
        guard received > 0 else {
            close(client)
            return
        }
        let text = String(decoding: buffer[0..<received], as: UTF8.self)
        let requestLine = text.components(separatedBy: "\r\n").first ?? ""
        lock.lock()
        lines.append(requestLine)
        let rateLimited = mode == .always403 || requestLine.hasPrefix("GET http://")
        lock.unlock()
        let body = rateLimited
            ? #"{"message":"API rate limit exceeded for 203.0.113.7."}"#
            : Self.releaseJSON
        let status = rateLimited ? "403 Forbidden" : "200 OK"
        let response = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\n"
            + "Content-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
        Array(response.utf8).withUnsafeBufferPointer { raw in
            var sent = 0
            while sent < raw.count {
                let written = send(client, raw.baseAddress! + sent, raw.count - sent, 0)
                guard written > 0 else { break }
                sent += written
            }
        }
        close(client)
    }

    private static let releaseJSON = """
    {"tag_name":"v9.9.9","assets":[\
    {"name":"PR.Helper.Git-9.9.9-macos.dmg","browser_download_url":"http://127.0.0.1:1/update.dmg"},\
    {"name":"SHA256SUMS","browser_download_url":"http://127.0.0.1:1/SHA256SUMS"}]}
    """
}