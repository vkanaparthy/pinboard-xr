import { useRef, type RefObject } from 'react'
import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Handle, HandleTarget, defaultApply } from '@react-three/handle'
import type { Group, Object3D } from 'three'
import { setOrbitEnabled, useSpatialStore, type Quat, type Vec3 } from '../store/useSpatialStore'
import { useCardTexture } from '../utils/canvasTexture'
import { Button3D } from './Button3D'

const CARD_W = 0.28
const CARD_H = 0.17
const BUTTON_H = 0.036
const GAP = 0.008

export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Drives the countdown from the render loop (keeps running inside immersive sessions). */
function TimerDriver() {
  const tickTimer = useSpatialStore((s) => s.tickTimer)
  const last = useRef(0)
  useFrame(() => {
    const now = Date.now()
    if (now - last.current < 200) return
    last.current = now
    tickTimer(now)
  })
  return null
}

export function PomodoroCard() {
  const groupRef = useRef<Group>(null)
  const timer = useSpatialStore((s) => s.timer)
  const timerCard = useSpatialStore((s) => s.timerCard)
  const toggleTimer = useSpatialStore((s) => s.toggleTimer)
  const resetTimer = useSpatialStore((s) => s.resetTimer)
  const setTimerCardTransform = useSpatialStore((s) => s.setTimerCardTransform)

  const done = timer.completedAt !== null && !timer.running
  const fresh = !timer.running && timer.remainingMs === timer.durationMs
  const status = done ? 'DONE — TAKE A 5 MIN BREAK' : timer.running ? 'FOCUSING' : fresh ? 'READY' : 'PAUSED'
  const accent = done ? '#46d48c' : timer.running ? '#ff6b5b' : '#f5b942'
  const progress = 1 - timer.remainingMs / timer.durationMs

  const texture = useCardTexture(CARD_W, CARD_H, (s) => ({
    background: '#161a22',
    border: { color: accent, width: s(2.5) },
    radius: s(16),
    padding: s(14),
    header: { text: `POMODORO  ·  ${status}`, color: accent, size: s(11), weight: 700, letterSpacing: s(0.8) },
    body: {
      text: formatClock(timer.remainingMs),
      color: '#ffffff',
      size: s(64),
      minSize: s(40),
      weight: 700,
      align: 'center',
      valign: 'middle',
      lineHeight: 1,
    },
    progress: { value: progress, color: accent, track: '#2c323e', height: s(7) },
    footer: { text: 'Pinch the card to move it', color: '#8b93a3', size: s(9.5), align: 'center', weight: 500 },
  }))

  const halfButton = (CARD_W - GAP) / 2
  const rowY = -CARD_H / 2 - GAP - BUTTON_H / 2

  return (
    <>
      <TimerDriver />
      <group ref={groupRef} position={timerCard.position} quaternion={timerCard.quaternion}>
        <HandleTarget targetRef={groupRef as RefObject<Object3D | null>}>
          <Handle
            targetRef="from-context"
            scale={false}
            rotate={{ x: false, y: true, z: false }}
            apply={(state, target) => {
              const result = defaultApply(state, target)
              if (state.last) {
                setTimerCardTransform({
                  position: target.position.toArray() as Vec3,
                  quaternion: target.quaternion.toArray() as Quat,
                })
              }
              return result
            }}
          >
            <group onPointerDown={() => setOrbitEnabled(false)}>
              <RoundedBox args={[CARD_W, CARD_H, 0.01]} radius={0.008} smoothness={2} position={[0, 0, -0.0055]}>
                <meshBasicMaterial color="#0d1016" toneMapped={false} />
              </RoundedBox>
              <mesh>
                <planeGeometry args={[CARD_W, CARD_H]} />
                <meshBasicMaterial map={texture} alphaTest={0.5} toneMapped={false} />
              </mesh>
            </group>
          </Handle>

          <Button3D
            label={timer.running ? 'Pause' : done ? 'Start again' : fresh ? 'Start' : 'Resume'}
            position={[-CARD_W / 2 + halfButton / 2, rowY, 0]}
            width={halfButton}
            height={BUTTON_H}
            color={timer.running ? '#f5b942' : '#46d48c'}
            hoverColor={timer.running ? '#ffd27a' : '#7be6ad'}
            textColor="#0d1016"
            fontSize={13}
            onClick={toggleTimer}
          />
          <Button3D
            label="Reset"
            position={[CARD_W / 2 - halfButton / 2, rowY, 0]}
            width={halfButton}
            height={BUTTON_H}
            color="#2a2f3a"
            hoverColor="#3b4252"
            textColor="#ffffff"
            fontSize={13}
            onClick={resetTimer}
          />
        </HandleTarget>
      </group>
    </>
  )
}
