// Stable loopback port for the desktop shell.
//
// WKWebView scopes localStorage by scheme, host and port. The shell used to
// spawn the server on an ephemeral port every launch, so every launch was a
// new origin and the previous active repository, theme and other localStorage
// preferences were invisible. Remember the port returned by the readiness
// handshake and reuse it on the next launch when it is still free.
import Darwin
import Foundation

enum DesktopServerPort {
    static let defaultsKey = "desktopServerPort"

    static func storedPort(_ defaults: UserDefaults = .standard) -> Int {
        let value = defaults.integer(forKey: defaultsKey)
        return (1...65535).contains(value) ? value : 0
    }

    /// A previously remembered port is reusable only when it can still be
    /// bound on loopback. Otherwise the caller starts the server on port 0 and
    /// remembers the new port after readiness.
    static func preferredPort(_ defaults: UserDefaults = .standard) -> Int {
        let port = storedPort(defaults)
        guard port > 0, isAvailable(port) else { return 0 }
        return port
    }

    static func remember(_ port: Int, defaults: UserDefaults = .standard) {
        guard (1...65535).contains(port) else { return }
        defaults.set(port, forKey: defaultsKey)
    }

    static func isAvailable(_ port: Int) -> Bool {
        guard (1...65535).contains(port) else { return false }
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }

        // Match Node's listening socket semantics: SO_REUSEADDR lets us probe
        // a port whose previous connections are still in TIME_WAIT, while an
        // active listener still makes bind() fail.
        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                bind(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }
}
