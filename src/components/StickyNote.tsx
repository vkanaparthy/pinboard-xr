import { memo, useRef, type RefObject } from 'react'
import { RoundedBox } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { Handle, HandleTarget, defaultApply } from '@react-three/handle'
import type { Group, Object3D } from 'three'
import {
  NOTE_COLORS,
  NOTE_PALETTE,
  NOTE_SIZES,
  noteKindLabel,
  setOrbitEnabled,
  useSpatialStore,
  type Note,
  type Quat,
  type Vec3,
} from '../store/useSpatialStore'
import { useCardTexture } from '../utils/canvasTexture'
import { Button3D } from './Button3D'

const BUTTON_HEIGHT = 0.034
const BUTTON_GAP = 0.008

/**
 * A sticky note you can pinch (hands), grab (controllers) or mouse-drag (desktop).
 * The paper is the grab handle; the button row underneath stays clickable.
 */
export const StickyNote = memo(function StickyNote({ note }: { note: Note }) {
  const groupRef = useRef<Group>(null)
  const [width, height] = NOTE_SIZES[note.kind]
  const palette = NOTE_PALETTE[note.color]

  const busyHere = useSpatialStore((s) => s.ai.busyNoteId === note.id)
  const anyBusy = useSpatialStore((s) => s.ai.busy)
  const inXR = useSpatialStore((s) => s.inXR)
  const cycleNoteColor = useSpatialStore((s) => s.cycleNoteColor)
  const removeNote = useSpatialStore((s) => s.removeNote)
  const expandNote = useSpatialStore((s) => s.expandNote)
  const updateNoteText = useSpatialStore((s) => s.updateNoteText)
  const setNoteTransform = useSpatialStore((s) => s.setNoteTransform)

  const compact = note.kind === 'step'
  const texture = useCardTexture(width, height, (s) => ({
    background: palette.paper,
    radius: s(12),
    padding: s(compact ? 10 : 14),
    header: {
      text: busyHere ? 'AI IS THINKING…' : `${noteKindLabel(note.kind)}  ·  PINCH TO MOVE`,
      color: palette.muted,
      size: s(compact ? 9 : 10.5),
      weight: 700,
      letterSpacing: s(0.6),
    },
    body: {
      text: note.text,
      color: palette.ink,
      size: s(note.kind === 'summary' ? 19 : compact ? 17 : 22),
      minSize: s(compact ? 9 : 10),
      weight: note.kind === 'summary' ? 500 : 600,
      lineHeight: 1.22,
      valign: compact ? 'middle' : 'top',
    },
  }))

  const commitTransform = (target: Object3D) => {
    const position = target.position.toArray() as Vec3
    const quaternion = target.quaternion.toArray() as Quat
    setNoteTransform(note.id, { position, quaternion })
  }

  const editOnDesktop = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (inXR) return
    const next = window.prompt('Edit note', note.text)
    if (next !== null) updateNoteText(note.id, next)
  }

  const nextColor = NOTE_COLORS[(NOTE_COLORS.indexOf(note.color) + 1) % NOTE_COLORS.length]
  const nextPalette = NOTE_PALETTE[nextColor]

  // Button row layout (left to right): color, AI Expand, delete.
  const deleteWidth = 0.036
  const colorWidth = Math.max(0.05, width * 0.26)
  const expandWidth = width - deleteWidth - colorWidth - BUTTON_GAP * 2
  const rowY = -height / 2 - BUTTON_GAP - BUTTON_HEIGHT / 2
  const left = -width / 2

  return (
    <group ref={groupRef} position={note.position} quaternion={note.quaternion}>
      {/* Group lacks the pointer-capture typings that @pmndrs/pointer-events adds to Object3D; the runtime object is the same. */}
      <HandleTarget targetRef={groupRef as RefObject<Object3D | null>}>
        <Handle
          targetRef="from-context"
          scale={false}
          rotate={{ x: false, y: true, z: false }}
          apply={(state, target) => {
            const result = defaultApply(state, target)
            if (state.last) commitTransform(target)
            return result
          }}
        >
          <group onPointerDown={() => setOrbitEnabled(false)} onDoubleClick={editOnDesktop}>
            <RoundedBox args={[width + 0.006, height + 0.006, 0.006]} radius={0.004} smoothness={2} position={[0, 0, -0.0035]}>
              <meshBasicMaterial color={palette.edge} toneMapped={false} />
            </RoundedBox>
            <mesh>
              <planeGeometry args={[width, height]} />
              <meshBasicMaterial map={texture} alphaTest={0.5} toneMapped={false} />
            </mesh>
          </group>
        </Handle>

        <Button3D
          label={nextColor.toUpperCase()}
          position={[left + colorWidth / 2, rowY, 0]}
          width={colorWidth}
          height={BUTTON_HEIGHT}
          color={nextPalette.paper}
          hoverColor={nextPalette.buttonHover}
          textColor={nextPalette.ink}
          fontSize={10}
          onClick={() => cycleNoteColor(note.id)}
        />
        <Button3D
          label={busyHere ? 'Thinking…' : 'AI Expand'}
          position={[left + colorWidth + BUTTON_GAP + expandWidth / 2, rowY, 0]}
          width={expandWidth}
          height={BUTTON_HEIGHT}
          color="#2a2f3a"
          hoverColor="#3b4252"
          textColor="#ffffff"
          fontSize={11}
          disabled={anyBusy}
          onClick={() => void expandNote(note.id)}
        />
        <Button3D
          label="×"
          position={[width / 2 - deleteWidth / 2, rowY, 0]}
          width={deleteWidth}
          height={BUTTON_HEIGHT}
          color="#e5484d"
          hoverColor="#ff6369"
          textColor="#ffffff"
          fontSize={20}
          fontWeight={700}
          onClick={() => removeNote(note.id)}
        />
      </HandleTarget>
    </group>
  )
})
