// Generates synthetic sample images for the mock camera server (no real photos in the repo).
// usage: swift mock/generate-samples.swift   (writes mock/samples/)
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let out = URL(fileURLWithPath: "mock/samples", isDirectory: true)
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func context(_ w: Int, _ h: Int) -> CGContext {
    CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
}

func save(_ image: CGImage, _ name: String, quality: Double = 0.85) {
    let url = out.appendingPathComponent(name)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    CGImageDestinationFinalize(dest)
}

func text(_ ctx: CGContext, _ string: String, x: CGFloat, y: CGFloat, size: CGFloat) {
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, size, nil)
    let attr = NSAttributedString(string: string, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 1, green: 1, blue: 1, alpha: 1),
    ])
    let line = CTLineCreateWithAttributedString(attr)
    ctx.textPosition = CGPoint(x: x, y: y)
    CTLineDraw(line, ctx)
}

/// An upright scene: gradient sky, "ground", a sun, an up arrow and a label, so orientation mistakes are obvious.
func scene(_ w: Int, _ h: Int, hue: CGFloat, label: String) -> CGImage {
    let ctx = context(w, h)
    let top = CGColor(red: 0.2 + hue * 0.5, green: 0.4, blue: 0.9 - hue * 0.5, alpha: 1)
    let bottom = CGColor(red: 0.95, green: 0.6 + hue * 0.3, blue: 0.3, alpha: 1)
    let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [bottom, top] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: h), options: [])
    ctx.setFillColor(CGColor(red: 0.15, green: 0.35, blue: 0.2, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h / 4))
    ctx.setFillColor(CGColor(red: 1, green: 0.95, blue: 0.6, alpha: 1))
    let r = CGFloat(min(w, h)) / 8
    ctx.fillEllipse(in: CGRect(x: CGFloat(w) * 0.72, y: CGFloat(h) * 0.62, width: r * 2, height: r * 2))
    // Up arrow
    let cx = CGFloat(w) / 2, base = CGFloat(h) * 0.35, tip = CGFloat(h) * 0.8
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.9))
    ctx.fill(CGRect(x: cx - r / 4, y: base, width: r / 2, height: tip - base - r))
    ctx.move(to: CGPoint(x: cx - r, y: tip - r)); ctx.addLine(to: CGPoint(x: cx, y: tip)); ctx.addLine(to: CGPoint(x: cx + r, y: tip - r))
    ctx.fillPath()
    text(ctx, label, x: CGFloat(w) * 0.05, y: CGFloat(h) * 0.08, size: CGFloat(min(w, h)) / 9)
    text(ctx, "UP", x: cx - r * 0.5, y: tip + r * 0.2, size: r * 0.7)
    return ctx.makeImage()!
}

func rotate(_ image: CGImage, degrees: Int) -> CGImage {
    let w = image.width, h = image.height
    let swap = degrees % 180 != 0
    let ctx = context(swap ? h : w, swap ? w : h)
    let W = CGFloat(swap ? h : w), H = CGFloat(swap ? w : h)
    ctx.translateBy(x: W / 2, y: H / 2)
    ctx.rotate(by: CGFloat(degrees) * .pi / 180)
    ctx.draw(image, in: CGRect(x: -CGFloat(w) / 2, y: -CGFloat(h) / 2, width: CGFloat(w), height: CGFloat(h)))
    return ctx.makeImage()!
}

func resize(_ image: CGImage, longEdge: Int) -> CGImage {
    let scale = CGFloat(longEdge) / CGFloat(max(image.width, image.height))
    let w = Int(CGFloat(image.width) * scale), h = Int(CGFloat(image.height) * scale)
    let ctx = context(w, h)
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()!
}

// id, aspect w:h (sensor), EXIF orientation
let photos: [(Int, Int, Int, Int)] = [
    (1, 3, 2, 1), (2, 16, 9, 1), (3, 3, 2, 6), (4, 4, 3, 1), (5, 1, 1, 1), (6, 3, 2, 8),
    (7, 16, 9, 1), (8, 3, 2, 1), (9, 16, 9, 8), (10, 3, 2, 3), (11, 3, 2, 1), (12, 4, 3, 6),
]
var manifest: [[String: Any]] = []
for (id, aw, ah, orientation) in photos {
    let sensorW = 1800, sensorH = sensorW * ah / aw
    let sideways = orientation == 6 || orientation == 8
    // What the scene looks like upright
    let uprightW = sideways ? sensorH : sensorW, uprightH = sideways ? sensorW : sensorH
    let upright = scene(uprightW, uprightH, hue: CGFloat(id % 5) / 5, label: String(format: "DSC%05d", id))
    // How the camera stores it: unrotated sensor pixels, orientation in EXIF.
    // CoreGraphics' y axis points up, so a positive angle here turns the picture counter-clockwise.
    let stored: CGImage
    switch orientation {
    case 6: stored = rotate(upright, degrees: 90)   // stored turned CCW; viewers rotate 90° CW
    case 8: stored = rotate(upright, degrees: -90)  // stored turned CW; viewers rotate 90° CCW
    case 3: stored = rotate(upright, degrees: 180)
    default: stored = upright
    }
    save(stored, "full-\(id).jpg", quality: 0.9)
    save(resize(stored, longEdge: 1920 * sensorW / max(sensorW, sensorH)), "preview-\(id).jpg")
    save(resize(upright, longEdge: 480), "small-\(id).jpg", quality: 0.75)
    manifest.append(["id": id, "width": sensorW * 3, "height": sensorH * 3, "orientation": orientation])
}
let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted])
try data.write(to: out.appendingPathComponent("photos.json"))

// Live view frames: 640x360 with a moving marker, so a frozen stream is visible
for frame in 0..<20 {
    let ctx = context(640, 360)
    let base = scene(640, 360, hue: 0.3, label: "LIVE")
    ctx.draw(base, in: CGRect(x: 0, y: 0, width: 640, height: 360))
    ctx.setFillColor(CGColor(red: 1, green: 0.6, blue: 0, alpha: 1))
    ctx.fill(CGRect(x: 20 + frame * 30, y: 330, width: 20, height: 20))
    text(ctx, String(format: "frame %02d", frame), x: 470, y: 20, size: 28)
    save(ctx.makeImage()!, String(format: "live-%02d.jpg", frame), quality: 0.7)
}
print("wrote \(photos.count) photos and 20 live frames to \(out.path)")
