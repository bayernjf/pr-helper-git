// Pure-Swift tests for the desktop window frame policy. No GUI is launched.
import AppKit
import Foundation

@main
struct WindowGeometryTest {
    private static func fail(_ message: String) -> Never {
        FileHandle.standardError.write(Data(("window-geometry: \(message)\n").utf8))
        exit(1)
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() { fail(message) }
    }

    static func main() {
        let visibleFrame = NSRect(x: 0, y: 0, width: 1409, height: 923)

        expect(
            WindowFramePolicy.isFilled(visibleFrame, in: visibleFrame),
            "the visible frame must be treated as filled",
        )
        expect(
            WindowFramePolicy.isFilled(
                NSRect(x: 0, y: 0, width: 1407, height: 923),
                in: visibleFrame,
            ),
            "a near-visible frame must be treated as filled",
        )
        expect(
            !WindowFramePolicy.isFilled(
                NSRect(x: 20, y: 20, width: 1200, height: 800),
                in: visibleFrame,
            ),
            "a reachable windowed frame must not be treated as filled",
        )

        let normal = WindowFramePolicy.normalFrame(in: visibleFrame)
        expect(!WindowFramePolicy.isFilled(normal, in: visibleFrame), "normal frame must not fill the desktop")
        expect(normal.width >= WindowFramePolicy.minimumWidth, "normal frame is narrower than the minimum")
        expect(normal.height >= WindowFramePolicy.minimumHeight, "normal frame is shorter than the minimum")
        expect(normal.maxX <= visibleFrame.maxX, "normal frame exceeds the visible width")
        expect(normal.maxY <= visibleFrame.maxY, "normal frame exceeds the visible height")
        expect(abs(normal.midX - visibleFrame.midX) < 0.01, "normal frame is not horizontally centered")
        expect(abs(normal.midY - visibleFrame.midY) < 0.01, "normal frame is not vertically centered")
        print("window-geometry: frame policy OK")
    }
}
