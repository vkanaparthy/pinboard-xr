import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'

/**
 * Crisp text for WebXR: draw into a high-resolution 2D canvas and map it onto a plane.
 * At ~3000 px per meter a 24 cm note gets a ~720 px texture, which stays sharp on the
 * Quest 3S display at normal reading distance.
 */

export const UI_FONT = 'Roboto, "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
export const DEFAULT_PX_PER_METER = 3000
const MAX_TEXTURE_PX = 2048

export interface TextStyle {
  text: string
  color: string
  /** Font size in canvas pixels. */
  size: number
  weight?: number
  align?: 'left' | 'center' | 'right'
  /** Multiplier of font size. */
  lineHeight?: number
  letterSpacing?: number
}

export interface BodyStyle extends TextStyle {
  /** Smallest size the text may shrink to while trying to fit. */
  minSize?: number
  valign?: 'top' | 'middle'
}

export interface CardDrawOptions {
  /** Fill for the rounded card; omit for a transparent canvas (text only). */
  background?: string
  border?: { color: string; width: number }
  /** Corner radius in pixels. */
  radius?: number
  /** Inner padding in pixels. */
  padding?: number
  header?: TextStyle
  body?: BodyStyle
  footer?: TextStyle
  /** Horizontal progress bar drawn above the footer (0..1). */
  progress?: { value: number; color: string; track: string; height: number }
}

export function fontString(size: number, weight = 500): string {
  return `${weight} ${Math.round(size)}px ${UI_FONT}`
}

/** Word-wraps text to `maxWidth`, honoring explicit newlines and breaking very long words. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      if (ctx.measureText(word).width <= maxWidth) {
        line = word
        continue
      }
      // Break a single word that is wider than the line.
      let chunk = ''
      for (const char of word) {
        if (ctx.measureText(chunk + char).width > maxWidth && chunk) {
          lines.push(chunk)
          chunk = char
        } else {
          chunk += char
        }
      }
      line = chunk
    }
    lines.push(line)
  }
  return lines
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

function applyTextStyle(ctx: CanvasRenderingContext2D, style: TextStyle, size = style.size): void {
  ctx.font = fontString(size, style.weight)
  ctx.fillStyle = style.color
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = style.align ?? 'left'
  const spacing = `${style.letterSpacing ?? 0}px`
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing
}

function alignX(align: TextStyle['align'], left: number, width: number): number {
  if (align === 'center') return left + width / 2
  if (align === 'right') return left + width
  return left
}

/** Draws a full card (background, header, auto-fitting body, progress bar, footer). */
export function drawCard(ctx: CanvasRenderingContext2D, width: number, height: number, options: CardDrawOptions): void {
  const { background, border, radius = 0, padding = 0, header, body, footer, progress } = options
  ctx.clearRect(0, 0, width, height)

  if (background) {
    const inset = border ? border.width / 2 : 0
    roundRectPath(ctx, inset, inset, width - inset * 2, height - inset * 2, radius)
    ctx.fillStyle = background
    ctx.fill()
    if (border) {
      ctx.lineWidth = border.width
      ctx.strokeStyle = border.color
      ctx.stroke()
    }
  }

  const left = padding
  const innerWidth = width - padding * 2
  let top = padding
  let bottom = height - padding

  if (header) {
    applyTextStyle(ctx, header)
    const lineHeight = header.size * (header.lineHeight ?? 1.2)
    ctx.fillText(header.text, alignX(header.align, left, innerWidth), top + header.size * 0.95, innerWidth)
    top += lineHeight + header.size * 0.35
  }

  if (footer) {
    applyTextStyle(ctx, footer)
    ctx.fillText(footer.text, alignX(footer.align, left, innerWidth), bottom - footer.size * 0.2, innerWidth)
    bottom -= footer.size * (footer.lineHeight ?? 1.2) + footer.size * 0.3
  }

  if (progress) {
    const barY = bottom - progress.height
    roundRectPath(ctx, left, barY, innerWidth, progress.height, progress.height / 2)
    ctx.fillStyle = progress.track
    ctx.fill()
    const value = Math.max(0, Math.min(1, progress.value))
    if (value > 0) {
      roundRectPath(ctx, left, barY, Math.max(progress.height, innerWidth * value), progress.height, progress.height / 2)
      ctx.fillStyle = progress.color
      ctx.fill()
    }
    bottom = barY - progress.height
  }

  if (body && body.text) {
    const available = Math.max(0, bottom - top)
    const minSize = body.minSize ?? body.size
    let size = body.size
    let lines: string[] = []
    let lineHeight = size
    // Shrink the font until the text fits, then ellipsize if it still does not.
    for (;;) {
      applyTextStyle(ctx, body, size)
      lineHeight = size * (body.lineHeight ?? 1.25)
      lines = wrapText(ctx, body.text, innerWidth)
      if (lines.length * lineHeight <= available || size <= minSize) break
      size = Math.max(minSize, size * 0.92)
    }
    const maxLines = Math.max(1, Math.floor(available / lineHeight))
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      let last = lines[maxLines - 1]
      while (last.length > 0 && ctx.measureText(`${last}…`).width > innerWidth) last = last.slice(0, -1)
      lines[maxLines - 1] = `${last.trimEnd()}…`
    }
    const blockHeight = lines.length * lineHeight
    const startY = body.valign === 'middle' ? top + (available - blockHeight) / 2 : top
    const x = alignX(body.align, left, innerWidth)
    lines.forEach((line, i) => {
      ctx.fillText(line, x, startY + i * lineHeight + size * 0.95)
    })
  }
}

export interface CanvasSurface {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: CanvasTexture
  widthPx: number
  heightPx: number
}

/** Creates a canvas + texture sized for a plane of `widthM` × `heightM` meters. */
export function createCanvasSurface(widthM: number, heightM: number, pxPerMeter = DEFAULT_PX_PER_METER): CanvasSurface {
  let widthPx = Math.round(widthM * pxPerMeter)
  let heightPx = Math.round(heightM * pxPerMeter)
  const scale = Math.min(1, MAX_TEXTURE_PX / Math.max(widthPx, heightPx))
  widthPx = Math.max(16, Math.round(widthPx * scale))
  heightPx = Math.max(16, Math.round(heightPx * scale))

  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context is not available')

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  return { canvas, ctx, texture, widthPx, heightPx }
}

/** Scales a size given at 1000 px/m to the actual texture resolution. */
export function px(surface: CanvasSurface, widthM: number, valueAt1000: number): number {
  return (valueAt1000 * surface.widthPx) / (widthM * 1000)
}

let fontsReadyVersion = 0
const fontListeners = new Set<() => void>()
if (typeof document !== 'undefined' && document.fonts?.ready) {
  void document.fonts.ready.then(() => {
    fontsReadyVersion++
    fontListeners.forEach((fn) => fn())
  })
}

/**
 * React hook: returns a CanvasTexture for a `widthM` × `heightM` plane and redraws it
 * whenever `build` produces different options. `build` receives a helper that converts
 * sizes given in "pixels at 1000 px/m" to real texture pixels, so layouts stay
 * resolution-independent.
 */
export function useCardTexture(
  widthM: number,
  heightM: number,
  build: (s: (valueAt1000: number) => number) => CardDrawOptions,
  pxPerMeter = DEFAULT_PX_PER_METER,
): CanvasTexture {
  const surface = useMemo(() => createCanvasSurface(widthM, heightM, pxPerMeter), [widthM, heightM, pxPerMeter])
  const [fontVersion, setFontVersion] = useState(fontsReadyVersion)

  useEffect(() => {
    const listener = () => setFontVersion(fontsReadyVersion)
    fontListeners.add(listener)
    return () => {
      fontListeners.delete(listener)
    }
  }, [])

  const options = build((value) => px(surface, widthM, value))
  const key = JSON.stringify(options)

  useLayoutEffect(() => {
    drawCard(surface.ctx, surface.widthPx, surface.heightPx, JSON.parse(key) as CardDrawOptions)
    surface.texture.needsUpdate = true
  }, [surface, key, fontVersion])

  useEffect(() => () => surface.texture.dispose(), [surface])

  return surface.texture
}
