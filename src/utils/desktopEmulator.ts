/**
 * Desktop testing without a headset: installs Meta's IWER WebXR emulator (a virtual
 * Quest 3 with controllers/hands, a dev panel, and a simulated room standing in for
 * passthrough).
 *
 * @react-three/xr can inject IWER by itself, but IWER refuses to replace a browser's
 * native `navigator.xr` (desktop Chrome has one even with no headset attached), so
 * "Enter Mixed Reality" would fail. Here the runtime is force-installed, and only on
 * localhost when the browser can't start a real immersive-ar session.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

let installed: Promise<void> | null = null

export function isLocalhost(): boolean {
  return typeof window !== 'undefined' && LOCAL_HOSTS.has(window.location.hostname)
}

export function isEmulatorInstalled(): boolean {
  return installed !== null
}

/** Loads (lazily, ~3 MB) and installs the emulator once. Safe to call repeatedly. */
export function installQuestEmulator(): Promise<void> {
  installed ??= (async () => {
    const [{ XRDevice, metaQuest3 }, { DevUI }, { SyntheticEnvironmentModule }] = await Promise.all([
      import('iwer'),
      import('@iwer/devui'),
      import('@iwer/sem'),
    ])
    const device = new XRDevice(metaQuest3)
    // Start standing at the origin, like a real local-floor session.
    device.position.set(0, 1.6, 0)
    device.primaryInputMode = 'controller'
    device.installRuntime({ forceInstall: true })
    device.installDevUI(DevUI)
    // @iwer/sem 0.2.x (the version @react-three/xr ships with) predates one optional depth-sensing
    // method in iwer 2.8's typings; this app never requests depth sensing.
    device.installSEM(SyntheticEnvironmentModule as unknown as Parameters<typeof device.installSEM>[0])
    await device.sem?.loadDefaultEnvironment('living_room')
  })().catch((error: unknown) => {
    installed = null
    throw error
  })
  return installed
}
