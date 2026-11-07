// Renders the application icon as a 1024x1024 PNG using only system
// CoreGraphics/AppKit. The desktop build script turns this into an .icns.
// Design: dark rounded-rectangle background matching the app's dark theme,
// with a white commit-graph line whose nodes use the brand accent colour.
import AppKit
import Foundation

let size = 1024
let outputPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"

guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fatalError("cannot create bitmap")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

// Flip to a top-origin coordinate system so the layout reads top to bottom.
ctx.saveGState()
ctx.translateBy(x: 0, y: CGFloat(size))
ctx.scaleBy(x: 1, y: -1)

// Rounded-rectangle background (macOS-style squircle).
let background = CGRect(x: 0, y: 0, width: size, height: size)
let cornerRadius: CGFloat = 224
let backgroundPath = CGPath(roundedRect: background, cornerWidth: cornerRadius, cornerHeight: cornerRadius, transform: nil)

let backgroundColors = [
    CGColor(red: 0.157, green: 0.157, blue: 0.227, alpha: 1), // #28283a
    CGColor(red: 0.082, green: 0.082, blue: 0.114, alpha: 1), // #15151d
]
let gradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: backgroundColors as CFArray,
    locations: [0, 1]
)!
ctx.addPath(backgroundPath)
ctx.clip()
ctx.drawLinearGradient(
    gradient,
    start: CGPoint(x: 0, y: 0),
    end: CGPoint(x: 0, y: size),
    options: []
)

// Commit-graph glyph.
ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.92))
ctx.setLineWidth(52)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)

// Main vertical lane.
ctx.move(to: CGPoint(x: 360, y: 250))
ctx.addLine(to: CGPoint(x: 360, y: 774))
ctx.strokePath()

// Branch curving away from the main lane to a second commit.
let branch = CGMutablePath()
branch.move(to: CGPoint(x: 360, y: 380))
branch.addCurve(
    to: CGPoint(x: 664, y: 664),
    control1: CGPoint(x: 360, y: 520),
    control2: CGPoint(x: 664, y: 520)
)
ctx.addPath(branch)
ctx.strokePath()

// Accent-coloured nodes with a white ring, placed at each commit.
let nodeRadius: CGFloat = 46
let accent = CGColor(red: 0.486, green: 0.424, blue: 1.0, alpha: 1) // #7c6cff
let nodes = [
    CGPoint(x: 360, y: 250),
    CGPoint(x: 360, y: 380),
    CGPoint(x: 360, y: 774),
    CGPoint(x: 664, y: 664),
]
for node in nodes {
    let circle = CGPath(
        ellipseIn: CGRect(
            x: node.x - nodeRadius,
            y: node.y - nodeRadius,
            width: nodeRadius * 2,
            height: nodeRadius * 2
        ),
        transform: nil
    )
    ctx.addPath(circle)
    ctx.setFillColor(accent)
    ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.setLineWidth(14)
    ctx.drawPath(using: .fillStroke)
}

ctx.restoreGState()
NSGraphicsContext.restoreGraphicsState()

let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: outputPath))
print("wrote \(outputPath)")
