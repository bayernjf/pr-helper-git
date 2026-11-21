// Pure-Swift tests for the desktop server port memory. No GUI is launched.
import Darwin
import Foundation

@main
struct ServerPortTest {
    private static func fail(_ message: String) -> Never {
        FileHandle.standardError.write(Data(("server-port: \(message)\n").utf8))
        exit(1)
    }

    /// Bind and listen on a kernel-assigned loopback port, returning the
    /// descriptor and port. The caller holds the descriptor to keep the port
    /// occupied.
    private static func listenOnLoopback() -> (Int32, Int) {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { fail("socket() failed") }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                bind(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            close(fd)
            fail("bind() failed")
        }
        guard listen(fd, 8) == 0 else {
            close(fd)
            fail("listen() failed")
        }

        var bound = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &bound) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                getsockname(fd, sockaddrPointer, &length)
            }
        }
        guard nameResult == 0 else {
            close(fd)
            fail("getsockname() failed")
        }
        return (fd, Int(UInt16(bigEndian: bound.sin_port)))
    }

    static func main() {
        let suite = "prh-server-port-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            fail("could not create an isolated defaults suite")
        }
        defer { defaults.removePersistentDomain(forName: suite) }

        if DesktopServerPort.preferredPort(defaults) != 0 {
            fail("an empty store must start on port 0")
        }

        DesktopServerPort.remember(0, defaults: defaults)
        if DesktopServerPort.storedPort(defaults) != 0 {
            fail("port 0 must not be remembered")
        }

        // A free port can be remembered and reused.
        let (freeFd, freePort) = listenOnLoopback()
        close(freeFd)
        DesktopServerPort.remember(freePort, defaults: defaults)
        if DesktopServerPort.storedPort(defaults) != freePort {
            fail("remembered port was not persisted")
        }
        if DesktopServerPort.preferredPort(defaults) != freePort {
            fail("a remembered free port was not reused")
        }

        // A remembered port that is occupied falls back to port 0; the shell
        // then chooses a fresh port and remembers it after readiness.
        let (busyFd, busyPort) = listenOnLoopback()
        defer { close(busyFd) }
        DesktopServerPort.remember(busyPort, defaults: defaults)
        if DesktopServerPort.preferredPort(defaults) != 0 {
            fail("an occupied remembered port must fall back to 0")
        }

        print("server-port: stable-port preference and occupied-port fallback OK")
    }
}
