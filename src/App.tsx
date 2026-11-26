import { useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { IfInSessionMode, PointerEvents, XR, createXRStore, noEvents } from '@react-three/xr'
import { useStore } from 'zustand'
import { ControlDock } from './components/ControlDock'
import { LandingOverlay } from './components/LandingOverlay'
import { PomodoroCard } from './components/PomodoroCard'
import { StickyNote } from './components/StickyNote'
import { sceneRefs, setOrbitEnabled, useSpatialStore } from './store/useSpatialStore'
import { installQuestEmulator } from './utils/desktopEmulator'

/**
 * One XR store for the whole app. Defaults give hands and controllers ray, grab and
 * poke pointers, which is what <Handle> and the 3D buttons listen to.
 */
const xrStore = createXRStore({
  frameRate: 'high',
  // The desktop emulator is installed on demand by src/utils/desktopEmulator.ts instead.
  emulate: false,
  // Show the real room: no virtual floor / environment is ever rendered.
  hand: { teleportPointer: false },
  controller: { teleportPointer: false },
})

const DESKTOP_CAMERA_POSITION: [number, number, number] = [0, 1.6, 0.95]
const DESKTOP_TARGET: [number, number, number] = [0, 1.42, -0.7]
/** Head position of a standing user at the XR origin (local-floor reference space). */
const DESKTOP_VIRTUAL_VIEWER: [number, number, number] = [0, 1.6, 0]

/** Keeps the user's head pose available to non-React code (spawning notes in front of you). */
function ViewerTracker() {
  useFrame(({ camera }) => {
    if (useSpatialStore.getState().inXR) {
      camera.getWorldPosition(sceneRefs.viewerPosition)
      camera.getWorldQuaternion(sceneRefs.viewerQuaternion)
    } else {
      // Desktop preview: spawn as if standing where an XR session starts, so layouts match the headset.
      sceneRefs.viewerPosition.set(...DESKTOP_VIRTUAL_VIEWER)
      sceneRefs.viewerQuaternion.identity()
    }
  })
  return null
}

function Scene() {
  const notes = useSpatialStore((s) => s.notes)

  return (
    <>
      <ViewerTracker />

      {/* Desktop-only helpers: hidden as soon as an immersive session starts. */}
      <IfInSessionMode deny={['immersive-ar', 'immersive-vr']}>
        <OrbitControls
          ref={(controls) => {
            sceneRefs.orbitControls = controls
          }}
          makeDefault
          target={DESKTOP_TARGET}
          enableDamping
          dampingFactor={0.12}
          minDistance={0.3}
          maxDistance={4}
        />
        <gridHelper args={[6, 30, '#3a4255', '#222733']} />
      </IfInSessionMode>

      <ControlDock />
      <PomodoroCard />
      {notes.map((note) => (
        <StickyNote key={note.id} note={note} />
      ))}
    </>
  )
}

export default function App() {
  const session = useStore(xrStore, (s) => s.session)
  const setInXR = useSpatialStore((s) => s.setInXR)

  useEffect(() => {
    setInXR(session != null)
    document.body.classList.toggle('in-xr', session != null)
  }, [session, setInXR])

  // Re-enable desktop orbiting once any drag ends.
  useEffect(() => {
    const enable = () => setOrbitEnabled(true)
    window.addEventListener('pointerup', enable)
    window.addEventListener('pointercancel', enable)
    return () => {
      window.removeEventListener('pointerup', enable)
      window.removeEventListener('pointercancel', enable)
    }
  }, [])

  const enterAR = async (useEmulator: boolean) => {
    if (useEmulator) await installQuestEmulator()
    const started = await xrStore.enterAR()
    if (!started) throw new Error('The browser did not start an immersive-ar session.')
  }

  return (
    <>
      <Canvas
        className="xr-canvas"
        events={noEvents}
        // alpha + transparent clear colour = Quest colour passthrough shows behind the scene.
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ position: DESKTOP_CAMERA_POSITION, fov: 55, near: 0.01, far: 50 }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor(0x000000, 0)
          scene.background = null
        }}
      >
        {/* pmndrs pointer events: one event system for mouse, controllers, hand rays and pokes. */}
        <PointerEvents />
        <XR store={xrStore}>
          <Scene />
        </XR>
      </Canvas>

      {!session && <LandingOverlay onEnterAR={enterAR} />}
    </>
  )
}
