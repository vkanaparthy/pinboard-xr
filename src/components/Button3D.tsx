import { useState } from 'react'
import { RoundedBox } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useCardTexture } from '../utils/canvasTexture'
import type { Vec3 } from '../store/useSpatialStore'

export interface Button3DProps {
  label: string
  onClick: () => void
  position?: Vec3
  width: number
  height: number
  depth?: number
  color: string
  hoverColor?: string
  textColor: string
  /** Font size in px at 1000 px/m (e.g. 15 ≈ 1.5 cm tall glyphs). */
  fontSize?: number
  fontWeight?: number
  disabled?: boolean
}

/**
 * A pressable 3D button: a rounded slab plus a canvas-texture label. Works with mouse
 * clicks on desktop and with controller rays, hand rays and finger pokes in XR.
 */
export function Button3D({
  label,
  onClick,
  position = [0, 0, 0],
  width,
  height,
  depth = 0.012,
  color,
  hoverColor,
  textColor,
  fontSize = 15,
  fontWeight = 600,
  disabled = false,
}: Button3DProps) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  const texture = useCardTexture(width, height, (s) => ({
    padding: s(4),
    body: {
      text: label,
      color: textColor,
      size: s(fontSize),
      minSize: s(fontSize * 0.7),
      weight: fontWeight,
      align: 'center',
      valign: 'middle',
      lineHeight: 1.1,
    },
  }))

  const fill = disabled ? '#8a8f99' : hovered ? (hoverColor ?? color) : color
  const scale = pressed && !disabled ? 0.95 : 1

  const setCursor = (value: string) => {
    if (typeof document !== 'undefined') document.body.style.cursor = value
  }

  return (
    <group
      position={position}
      scale={[scale, scale, scale]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        if (!disabled) onClick()
      }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        setPressed(true)
      }}
      onPointerUp={() => setPressed(false)}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        setHovered(true)
        setCursor(disabled ? 'not-allowed' : 'pointer')
      }}
      onPointerOut={() => {
        setHovered(false)
        setPressed(false)
        setCursor('auto')
      }}
    >
      <RoundedBox args={[width, height, depth]} radius={Math.min(height, width) * 0.28} smoothness={3}>
        <meshBasicMaterial color={fill} toneMapped={false} />
      </RoundedBox>
      <mesh position={[0, 0, depth / 2 + 0.0008]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} opacity={disabled ? 0.6 : 1} />
      </mesh>
    </group>
  )
}
