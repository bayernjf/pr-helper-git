import AppKit

enum WindowFramePolicy {
    static let defaultWidth: CGFloat = 1280
    static let defaultHeight: CGFloat = 820
    static let minimumWidth: CGFloat = 900
    static let minimumHeight: CGFloat = 600

    /// A saved frame can be a hair smaller than the visible frame after a
    /// zoom transition. Treat that as filled so the next zoom restores a real
    /// windowed size instead of becoming a no-op.
    static func isFilled(
        _ frame: NSRect,
        in visibleFrame: NSRect,
        tolerance: CGFloat = 3,
    ) -> Bool {
        abs(frame.minX - visibleFrame.minX) <= tolerance
            && abs(frame.minY - visibleFrame.minY) <= tolerance
            && abs(frame.width - visibleFrame.width) <= tolerance
            && abs(frame.height - visibleFrame.height) <= tolerance
    }

    /// The size used when leaving a screen-filling frame. It is deliberately
    /// smaller than the visible frame so the edges are reachable for manual
    /// resizing and a later double-click has room to expand.
    static func normalFrame(in visibleFrame: NSRect) -> NSRect {
        let width = max(
            min(defaultWidth, visibleFrame.width - 40),
            minimumWidth,
        )
        let height = max(
            min(defaultHeight, visibleFrame.height - 40),
            minimumHeight,
        )
        return NSRect(
            x: visibleFrame.midX - width / 2,
            y: visibleFrame.midY - height / 2,
            width: width,
            height: height,
        )
    }
}
