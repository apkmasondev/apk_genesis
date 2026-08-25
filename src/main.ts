import './style.css'

/*
  APK://GENESIS — scroll-driven scene runtime.

  The scene is one continuous silent video that is never played: scroll position
  maps to a frame index, and the only thing this module does per frame is decide
  whether it is worth asking the decoder for a different frame yet. Everything
  else (copy, glow, meter) is expressed as custom properties on :root so the
  stylesheet owns the look and this file owns the timing.
*/

declare global {
  interface Navigator {
    readonly connection?: { readonly saveData?: boolean }
    readonly deviceMemory?: number
  }
}

/* ── numeric helpers ──────────────────────────────────────────────────── */

const clamp = (value: number, min = 0, max = 1) => (value < min ? min : value > max ? max : value)

const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / Math.max(0.0001, to - from))
  return t * t * (3 - 2 * t)
}

/* ── environment ──────────────────────────────────────────────────────── */

const root = document.documentElement
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)')
const coarsePointerQuery = matchMedia('(pointer: coarse)')
const finePointerQuery = matchMedia('(hover: hover) and (pointer: fine)')
const portraitPhoneQuery = matchMedia('(max-width: 700px) and (orientation: portrait)')

const dataSaver = navigator.connection?.saveData === true
const lowPowerHint = (navigator.hardwareConcurrency ?? 8) <= 4 || (navigator.deviceMemory ?? 8) <= 4

const mediaUrl = (path: string) => new URL(path, document.baseURI).href

/*
  Two encodes of the same 28.8s timeline. `frameStep` is the encoded frame
  duration: every seek target is snapped to the centre of a frame interval so
  repeated scroll samples resolve to the same request and can be dropped.
*/
const RENDITIONS = {
  wide: { file: 'media/genesis-wide.mp4', frameStep: 1 / 20 },
  tall: { file: 'media/genesis-tall.mp4', frameStep: 1 / 16 },
} as const

type RenditionName = keyof typeof RENDITIONS

const resolveRendition = (): RenditionName => (portraitPhoneQuery.matches ? 'tall' : 'wide')

/* ── elements ─────────────────────────────────────────────────────────── */

const runway = document.querySelector<HTMLElement>('.runway')!
const skipLink = document.querySelector<HTMLAnchorElement>('.skip-link')!
const skipTarget = document.querySelector<HTMLElement>('.skip-target')!
const loaderLabel = document.querySelector<HTMLElement>('.loader span')!
const soundButton = document.querySelector<HTMLButtonElement>('.sound-toggle')!
const soundLabel = document.querySelector<HTMLElement>('.sound-label')!
const originCore = document.querySelector<HTMLButtonElement>('.origin-core')!
const replayButton = document.querySelector<HTMLButtonElement>('.replay-button')!
const phaseCode = document.querySelector<HTMLElement>('.phase-code')!
const phaseCount = document.querySelector<HTMLElement>('.phase-count')!
const scene = document.querySelector<HTMLVideoElement>('.scene')!

/* ── :root custom properties ──────────────────────────────────────────── */

/*
  Values are quantised before they are compared, so a property is only written
  when it actually changes at the precision the stylesheet can observe. That
  keeps a resting frame down to zero style writes and avoids allocating a
  formatted string per property per frame.
*/
const propertyCache = new Map<string, number>()

function setRootNumber(name: string, value: number, scale: number, unit = '') {
  const quantised = Math.round(value * scale)
  if (propertyCache.get(name) === quantised) return
  propertyCache.set(name, quantised)
  root.style.setProperty(name, `${quantised / scale}${unit}`)
}

let animatingFlag = false

function setAnimating(animating: boolean) {
  if (animatingFlag === animating) return
  animatingFlag = animating
  root.dataset.animating = animating ? 'true' : 'false'
}

/* ── chapters ─────────────────────────────────────────────────────────── */

type ChapterView = {
  element: HTMLElement
  start: number
  fade: number
  end: number
  isIntro: boolean
  isFinal: boolean
  opacity: number
  shift: number
  interactive: boolean
}

const chapters: ChapterView[] = [...document.querySelectorAll<HTMLElement>('.chapter')].map((element) => {
  const start = Number(element.dataset.start)
  const end = Number(element.dataset.end)
  return {
    element,
    start,
    end,
    fade: Math.min(0.045, (end - start) * 0.23),
    isIntro: element.classList.contains('chapter-intro'),
    isFinal: element.classList.contains('chapter-final'),
    opacity: -1,
    shift: -1,
    interactive: false,
  }
})

/*
  Chapter state is applied on transitions, so the initial state has to be
  established explicitly: without this the five chapters that are invisible on
  a fresh load would never flip, leaving their links in the tab order and their
  copy in the accessibility tree behind opacity: 0.
*/
function resetChapterAccessibility(accessible: boolean) {
  for (const view of chapters) {
    view.interactive = accessible
    view.element.classList.toggle('is-interactive', accessible)
    setChapterAccessibility(view, accessible)
  }
}

function setChapterAccessibility(view: ChapterView, accessible: boolean) {
  const hidden = !accessible
  if (hidden && view.element.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur()
  }
  view.element.inert = hidden
  if (hidden) view.element.setAttribute('aria-hidden', 'true')
  else view.element.removeAttribute('aria-hidden')
}

/* ── scroll geometry ──────────────────────────────────────────────────── */

let runwayStart = 0
let runwayLength = 1
let viewportWidth = window.innerWidth
let viewportHeight = window.innerHeight
let targetProgress = 0
let displayProgress = 0
let previousTarget = 0
let scrollVelocity = 0
let lastScrollTime = performance.now()
let introDismissed = false

function updateScrollTarget() {
  targetProgress = clamp((window.scrollY - runwayStart) / runwayLength)
}

function measure(preserveProgress = false) {
  const progressBeforeResize = targetProgress
  const wasInsideRunway = window.scrollY >= runwayStart && window.scrollY <= runwayStart + runwayLength

  runwayStart = runway.offsetTop
  runwayLength = Math.max(1, runway.offsetHeight - viewportHeight)

  if (preserveProgress && wasInsideRunway && !staticMode) {
    const preservedScrollY = runwayStart + progressBeforeResize * runwayLength
    if (Math.abs(window.scrollY - preservedScrollY) > 1) {
      window.scrollTo({ top: preservedScrollY, behavior: 'auto' })
    }
  }

  updateScrollTarget()
  previousTarget = targetProgress
}

/*
  Mobile browsers fire `resize` continuously while the URL bar collapses. Those
  events change nothing about the layout the runway is built from — the runway
  is sized in `svh` — so re-measuring on them only produces a visible jump in
  scroll-to-progress mapping. Only a width change, or a height change large
  enough to be a real viewport change, is treated as a resize.
*/
function viewportChangedMeaningfully() {
  const width = window.innerWidth
  const height = window.innerHeight
  if (width !== viewportWidth) return true
  if (height === viewportHeight) return false
  return !coarsePointerQuery.matches || Math.abs(height - viewportHeight) > viewportHeight * 0.2
}

/* ── scene playback ───────────────────────────────────────────────────── */

let renditionName: RenditionName = resolveRendition()
let frameStep = RENDITIONS[renditionName].frameStep
let sceneReady = false
let sceneDuration = 0
let lastFrameIndex = 0
let desiredFrame = -1
let pendingFrame = -1
let renderedFrame = -1
let lastSeekAt = 0
let latencySampledAt = 0
let seekLatency = 48
let awaitingFrame = false
let frameCallbackId: number | null = null
let frameWatchTimeouts = 0
let useFrameCallback = typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function'

let staticMode = reducedMotionQuery.matches || dataSaver
let performanceLite = lowPowerHint
let slowFrameScore = 0
let stableFrameCount = 0
let performanceLiteSince = 0

function cancelFrameWatch() {
  if (frameCallbackId !== null && typeof scene.cancelVideoFrameCallback === 'function') {
    scene.cancelVideoFrameCallback(frameCallbackId)
  }
  frameCallbackId = null
  awaitingFrame = false
}

function recordSeekLatency(completedAt: number) {
  if (lastSeekAt <= 0 || latencySampledAt === lastSeekAt) return
  latencySampledAt = lastSeekAt
  seekLatency += (clamp(completedAt - lastSeekAt, 8, 650) - seekLatency) * 0.22
}

/*
  Seeking is asynchronous and unthrottled requests queue up behind each other,
  which is what makes naive scrubbing feel like it lags a second behind the
  finger. The interval below is derived from the latency the device actually
  demonstrates, so a fast desktop stays responsive and a slow phone stops
  asking for frames it cannot deliver.
*/
function scrub(progress: number, now: number) {
  if (!sceneReady) return

  desiredFrame = Math.round(progress * lastFrameIndex)
  if (desiredFrame === renderedFrame) return

  if (awaitingFrame) {
    if (now - lastSeekAt <= clamp(seekLatency * 3.2, 300, 650)) return
    // A watch that never fired means this browser does not present frames for a
    // paused seek; fall back to the `seeked` event permanently.
    cancelFrameWatch()
    if ((frameWatchTimeouts += 1) >= 3) useFrameCallback = false
  }

  if (scene.seeking) {
    // A seek that has not resolved in four seconds is not going to. Accepting
    // the frame parks the loop instead of leaving it spinning at 60fps; the
    // next scroll asks again.
    if (now - lastSeekAt > 4000) renderedFrame = desiredFrame
    return
  }

  const floor = performanceLite ? 68 : coarsePointerQuery.matches ? 42 : 30
  const ceiling = performanceLite ? 110 : 80
  if (now - lastSeekAt < clamp(seekLatency * 0.55, floor, ceiling)) return

  pendingFrame = desiredFrame
  lastSeekAt = now

  if (useFrameCallback) {
    awaitingFrame = true
    frameCallbackId = scene.requestVideoFrameCallback((presentedAt) => {
      frameCallbackId = null
      awaitingFrame = false
      frameWatchTimeouts = 0
      renderedFrame = pendingFrame
      recordSeekLatency(presentedAt)
      requestTick()
    })
  }

  try {
    // Landing mid-interval keeps the request unambiguous across decoders.
    scene.currentTime = Math.min((pendingFrame + 0.5) * frameStep, sceneDuration - frameStep * 0.25)
  } catch {
    // Metadata can go missing mid source-swap; the next tick retries.
    cancelFrameWatch()
  }
}

function loadScene() {
  if (staticMode) return
  frameStep = RENDITIONS[renditionName].frameStep
  sceneReady = false
  desiredFrame = -1
  pendingFrame = -1
  renderedFrame = -1
  lastSeekAt = 0
  latencySampledAt = 0
  cancelFrameWatch()
  scene.preload = 'auto'
  scene.src = mediaUrl(RENDITIONS[renditionName].file)
  scene.load()
}

function unloadScene() {
  cancelFrameWatch()
  sceneReady = false
  desiredFrame = -1
  pendingFrame = -1
  renderedFrame = -1
  scene.removeAttribute('src')
  scene.load()
}

/*
  iOS keeps showing the poster until a video has been through the play path at
  least once, even for a video that will only ever be scrubbed. Muted inline
  playback needs no gesture, so one play/pause primes the decoder invisibly.
*/
function primeDecoder() {
  const playback = scene.play()
  if (playback) void playback.then(() => scene.pause()).catch(() => {})
}

scene.addEventListener('loadedmetadata', () => {
  if (!scene.currentSrc) return
  sceneDuration = Number.isFinite(scene.duration) ? scene.duration : 0
  lastFrameIndex = Math.max(1, Math.round(sceneDuration / frameStep) - 1)
  sceneReady = sceneDuration > 0
  scene.pause()
  requestTick()
})

scene.addEventListener('loadeddata', () => {
  if (!scene.currentSrc) return
  root.classList.remove('media-fallback')
  root.classList.add('media-ready')
  primeDecoder()
  requestTick()
})

scene.addEventListener('seeked', () => {
  if (awaitingFrame) return
  renderedFrame = pendingFrame
  recordSeekLatency(performance.now())
  requestTick()
})

scene.addEventListener('error', () => {
  if (!scene.currentSrc) return
  cancelFrameWatch()
  sceneReady = false
  root.classList.add('media-fallback', 'media-ready')
  loaderLabel.textContent = 'Visual ready in static mode'
})

/* ── soundtrack ───────────────────────────────────────────────────────── */

const MAX_VOLUME = 0.28
const audioSourceUrl = mediaUrl('audio/genesis-theme.m4a')
const audio = new Audio()
audio.preload = 'none'
audio.loop = true
audio.volume = 0

let soundEnabled = false
let audioVolume = 0
let audioTarget = 0
let audioEnergy = 0
let audioContext: AudioContext | null = null
let audioSource: MediaElementAudioSourceNode | null = null
let audioAnalyser: AnalyserNode | null = null
let audioFrequencyData: Uint8Array<ArrayBuffer> | null = null
let audioAnalyserAttempted = false
let audioSourceLoaded = false
let soundOperation = 0
let resumeAfterVisibility = false
let lastAudioEnergyAt = performance.now()

function ensureAudioSource() {
  if (audioSourceLoaded) return
  audioSourceLoaded = true
  audio.preload = 'auto'
  audio.src = audioSourceUrl
  audio.load()
}

async function ensureAudioAnalyser() {
  if (audioContext?.state === 'suspended') await audioContext.resume()
  if (audioAnalyser && audioContext) return
  if (audioAnalyserAttempted) return
  audioAnalyserAttempted = true

  try {
    audioContext = new AudioContext()
    audioAnalyser = audioContext.createAnalyser()
    audioAnalyser.fftSize = 64
    audioAnalyser.smoothingTimeConstant = 0.76
    audioSource = audioContext.createMediaElementSource(audio)
    audioSource.connect(audioAnalyser)
    audioAnalyser.connect(audioContext.destination)
    audioFrequencyData = new Uint8Array(audioAnalyser.frequencyBinCount)
    await audioContext.resume()
  } catch {
    // The soundtrack stays fully functional when Web Audio is unavailable.
    try { audioAnalyser?.disconnect() } catch { /* node was never connected */ }
    try { audioSource?.disconnect() } catch { /* node was never connected */ }
    audioAnalyser = null
    audioFrequencyData = null
    if (audioSource && audioContext) {
      audioSource.connect(audioContext.destination)
      if (audioContext.state === 'suspended') await audioContext.resume()
    }
  }
}

function updateAudioEnergy(dt: number) {
  let energyTarget = 0
  const canReact = soundEnabled && !audio.paused && audioVolume > 0.002 && !staticMode

  if (canReact && audioAnalyser && audioFrequencyData) {
    audioAnalyser.getByteFrequencyData(audioFrequencyData)
    const end = Math.min(audioFrequencyData.length, 18)
    let sum = 0
    for (let index = 1; index < end; index += 1) sum += audioFrequencyData[index]
    const average = end > 1 ? sum / (end - 1) / 255 : 0
    energyTarget = clamp((average - 0.035) * 2.45) * clamp(audioVolume / MAX_VOLUME)
  }

  const tau = energyTarget > audioEnergy ? 0.065 : 0.2
  audioEnergy += (energyTarget - audioEnergy) * (1 - Math.exp(-dt / tau))
  if (Math.abs(energyTarget - audioEnergy) < 0.002) audioEnergy = energyTarget

  const sceneCompensation = 1 + smoothstep(0.12, 0.72, displayProgress) * 0.95
  setRootNumber('--audio-energy', audioEnergy, 1e3)
  setRootNumber('--audio-visual-energy', clamp(audioEnergy * sceneCompensation), 1e3)
}

function updateAudio(dt: number, now: number) {
  const tau = audioTarget > audioVolume ? 0.42 : 0.28
  audioVolume += (audioTarget - audioVolume) * (1 - Math.exp(-dt / tau))
  if (Math.abs(audioTarget - audioVolume) < 0.002) audioVolume = audioTarget
  audio.volume = clamp(audioVolume, 0, MAX_VOLUME)

  const energyInterval = performanceLite ? 1000 / 30 : 0
  if (now - lastAudioEnergyAt >= energyInterval) {
    updateAudioEnergy(Math.min(0.1, Math.max(0.001, (now - lastAudioEnergyAt) / 1000)))
    lastAudioEnergyAt = now
  }

  if (!soundEnabled && audioVolume === 0 && !audio.paused) {
    audio.pause()
    if (audioContext?.state === 'running') void audioContext.suspend().catch(() => {})
  }
}

async function setSound(enabled: boolean) {
  const operation = ++soundOperation
  soundEnabled = enabled
  soundButton.setAttribute('aria-pressed', String(enabled))
  soundButton.setAttribute('aria-label', enabled ? 'Turn soundtrack off' : 'Turn soundtrack on')
  soundLabel.textContent = enabled ? 'Sound on' : 'Sound off'
  root.classList.toggle('sound-on', enabled)

  if (enabled) {
    audioTarget = MAX_VOLUME
    try {
      ensureAudioSource()
      await ensureAudioAnalyser()
      if (operation !== soundOperation || !soundEnabled) return
      await audio.play()
      if (operation !== soundOperation || !soundEnabled) audio.pause()
    } catch {
      if (operation !== soundOperation) return
      soundEnabled = false
      audioTarget = 0
      soundButton.setAttribute('aria-pressed', 'false')
      soundButton.setAttribute('aria-label', 'Turn soundtrack on')
      soundLabel.textContent = 'Sound unavailable'
      root.classList.remove('sound-on')
    }
  } else {
    audioTarget = 0
  }
  requestTick()
}

/* ── per-frame scene state ────────────────────────────────────────────── */

let pointerTargetX = 0
let pointerTargetY = 0
let pointerX = 0
let pointerY = 0

function updateCopy(progress: number) {
  for (let index = 0; index < chapters.length; index += 1) {
    const view = chapters[index]
    const enter = view.isIntro ? 1 : smoothstep(view.start, view.start + view.fade, progress)
    const exit = view.isFinal ? 1 : 1 - smoothstep(view.end - view.fade, view.end, progress)
    const opacity = view.isIntro && introDismissed ? 0 : clamp(Math.min(enter, exit))
    const entrance = clamp((progress - view.start) / 0.055)
    writeChapter(view, opacity, (1 - smoothstep(0, 1, entrance)) * 16)
  }

  const coreIsActive = progress < 0.035
  if (originCore.classList.contains('is-active') !== coreIsActive) {
    originCore.classList.toggle('is-active', coreIsActive)
    originCore.tabIndex = coreIsActive ? 0 : -1
  }
}

function writeChapter(view: ChapterView, opacity: number, shift: number) {
  if (Math.abs(opacity - view.opacity) > 0.0005) {
    view.opacity = opacity
    view.element.style.setProperty('--chapter-opacity', opacity.toFixed(3))
  }
  if (Math.abs(shift - view.shift) > 0.05) {
    view.shift = shift
    view.element.style.setProperty('--chapter-y', `${shift.toFixed(2)}px`)
  }

  const interactive = opacity > 0.72
  if (view.interactive !== interactive) {
    view.interactive = interactive
    view.element.classList.toggle('is-interactive', interactive)
    setChapterAccessibility(view, interactive)
  }
}

function updatePhase(progress: number) {
  const code = progress < 0.335 ? 'A' : progress < 0.665 ? 'P' : 'K'
  if (phaseCode.textContent === code) return
  phaseCode.textContent = code
  phaseCount.textContent = code === 'A' ? '01 / 03' : code === 'P' ? '02 / 03' : '03 / 03'
}

function setPerformanceLite(enabled: boolean, now: number) {
  if (performanceLite === enabled) return
  performanceLite = enabled
  performanceLiteSince = enabled ? now : 0
  slowFrameScore = 0
  stableFrameCount = 0
  root.classList.toggle('performance-lite', enabled)

  if (enabled) {
    setRootNumber('--cinematic-x', 0, 1e3, 'px')
    setRootNumber('--cinematic-y', 0, 1e3, 'px')
    setRootNumber('--cinematic-scale', 1.015, 1e5)
  }
}

/*
  Frame cost is only meaningful while the scene is under load; an idle tab full
  of long frames says nothing about how the device copes with scrubbing.
*/
function updatePerformanceMode(frameMs: number, now: number) {
  const underLoad =
    Math.abs(targetProgress - displayProgress) > 0.00008 ||
    scene.seeking ||
    awaitingFrame ||
    (soundEnabled && !audio.paused)

  if (!underLoad) return

  if (!performanceLite) {
    slowFrameScore = frameMs > 27 ? slowFrameScore + 1 : Math.max(0, slowFrameScore - 0.4)
    if (slowFrameScore >= 8) setPerformanceLite(true, now)
    return
  }

  if (lowPowerHint) return
  stableFrameCount = frameMs < 23 ? stableFrameCount + 1 : 0
  if (stableFrameCount >= 120 && now - performanceLiteSince > 5000) setPerformanceLite(false, now)
}

/* ── the loop ─────────────────────────────────────────────────────────── */

let animationFrame = 0
let lastFrameTime = performance.now()

function needsAnotherFrame() {
  return (
    Math.abs(targetProgress - displayProgress) > 0.00008 ||
    Math.abs(audioTarget - audioVolume) > 0.001 ||
    (soundEnabled && !audio.paused && audioAnalyser !== null) ||
    audioEnergy > 0.002 ||
    Math.abs(pointerTargetX - pointerX) > 0.01 ||
    Math.abs(pointerTargetY - pointerY) > 0.01 ||
    Math.abs(scrollVelocity) > 0.004 ||
    (sceneReady && desiredFrame !== renderedFrame) ||
    scene.seeking ||
    awaitingFrame
  )
}

function tick(now: number) {
  animationFrame = 0
  const frameMs = Math.min(100, Math.max(1, now - lastFrameTime))
  const dt = Math.min(0.064, frameMs / 1000)
  lastFrameTime = now
  updatePerformanceMode(frameMs, now)

  if (staticMode) {
    displayProgress = targetProgress
  } else {
    /*
      The scroll position is followed with an exponential approach whose time
      constant tightens once the finger or wheel has stopped, so motion stays
      cinematic while moving and lands exactly on the target when it does not.
    */
    const coarse = coarsePointerQuery.matches
    const settleBlend = smoothstep(90, coarse ? 220 : 190, now - lastScrollTime)
    const tau = (coarse ? 0.15 : 0.115) + ((coarse ? 0.065 : 0.05) - (coarse ? 0.15 : 0.115)) * settleBlend
    displayProgress += (targetProgress - displayProgress) * (1 - Math.exp(-dt / tau))
    if (Math.abs(targetProgress - displayProgress) < 0.00005 + 0.0002 * settleBlend) {
      displayProgress = targetProgress
    }
  }

  pointerX += (pointerTargetX - pointerX) * (1 - Math.exp(-dt / 0.24))
  pointerY += (pointerTargetY - pointerY) * (1 - Math.exp(-dt / 0.24))
  scrollVelocity += -scrollVelocity * (1 - Math.exp(-dt / 0.09))

  setRootNumber('--master-progress', displayProgress, 1e4)
  setRootNumber('--pointer-x', pointerX, 1e2, 'px')
  setRootNumber('--pointer-y', pointerY, 1e2, 'px')

  if (!performanceLite) {
    const phase = displayProgress * Math.PI * 2
    setRootNumber('--cinematic-x', Math.sin(phase * 1.4) * 0.55 + clamp(scrollVelocity * 0.16, -0.35, 0.35), 1e2, 'px')
    setRootNumber('--cinematic-y', Math.cos(phase * 1.1) * 0.38 + clamp(scrollVelocity * 0.08, -0.18, 0.18), 1e2, 'px')
    setRootNumber('--cinematic-scale', 1.015 + Math.sin(phase * 0.85) * 0.00065, 1e5)
  }

  setRootNumber('--kinetic-shift', clamp(scrollVelocity * 2.4, -5, 5), 1e2, 'px')
  setRootNumber('--kinetic-blur', clamp(Math.abs(scrollVelocity) * 0.55, 0, 1.2), 1e2, 'px')
  setRootNumber('--kinetic-track', 0.08 + clamp(Math.abs(scrollVelocity) * 0.008, 0, 0.035), 1e3, 'em')

  const aiSignal = smoothstep(0.045, 0.29, displayProgress)
  const aiAccent = Math.sin(aiSignal * Math.PI)
  const pixelResolve = smoothstep(0.285, 0.48, displayProgress)
  setRootNumber('--ai-sweep', -65 + aiSignal * 230, 1e1, '%')
  setRootNumber('--ai-split', aiAccent * 3.2, 1e2, 'px')
  setRootNumber('--ai-accent-opacity', aiAccent * 0.92, 1e3)
  setRootNumber('--pixel-shift', (1 - pixelResolve) * 9, 1e2, 'px')
  setRootNumber('--pixel-opacity', 0.14 + (1 - pixelResolve) * 0.58, 1e3)
  setRootNumber('--pixel-size', 7 + (1 - pixelResolve) * 5, 1e2, 'px')

  if (!staticMode) {
    scrub(displayProgress, now)
    updateCopy(displayProgress)
    updatePhase(displayProgress)
  }
  updateAudio(dt, now)

  if (needsAnotherFrame() && !document.hidden) {
    setAnimating(true)
    animationFrame = requestAnimationFrame(tick)
  } else {
    setAnimating(false)
  }
}

function requestTick() {
  if (animationFrame || document.hidden) return
  setAnimating(true)
  lastFrameTime = performance.now()
  animationFrame = requestAnimationFrame(tick)
}

/* ── input ────────────────────────────────────────────────────────────── */

function onScroll() {
  const now = performance.now()
  const elapsed = Math.max(16, now - lastScrollTime)
  updateScrollTarget()

  if (targetProgress > 0) introDismissed = true
  else if (previousTarget > 0) introDismissed = false

  scrollVelocity = clamp(((targetProgress - previousTarget) / elapsed) * 1900, -2.5, 2.5)
  previousTarget = targetProgress
  lastScrollTime = now
  requestTick()
}

function onResize() {
  if (!viewportChangedMeaningfully()) return
  viewportWidth = window.innerWidth
  viewportHeight = window.innerHeight
  measure(true)
  requestTick()
}

function onPointerMove(event: PointerEvent) {
  const coreOrFinalIsVisible = displayProgress < 0.09 || displayProgress >= 0.89
  if (!finePointerQuery.matches || staticMode || !coreOrFinalIsVisible) return
  pointerTargetX = ((event.clientX / window.innerWidth) * 2 - 1) * 5
  pointerTargetY = ((event.clientY / window.innerHeight) * 2 - 1) * 5
  requestTick()
}

function syncPointerParallax() {
  if (finePointerQuery.matches) addEventListener('pointermove', onPointerMove, { passive: true })
  else removeEventListener('pointermove', onPointerMove)
}

function skipToFinal(event: MouseEvent) {
  event.preventDefault()
  if (staticMode) {
    document.querySelector<HTMLElement>('.chapter-final')!.scrollIntoView({ behavior: 'auto', block: 'start' })
  } else {
    window.scrollTo({ top: runwayStart + runwayLength, behavior: 'auto' })
    targetProgress = 1
    displayProgress = 1
    previousTarget = 1
    introDismissed = true
    updateCopy(1)
    updatePhase(1)
    scrub(1, performance.now())
  }
  skipTarget.focus({ preventScroll: true })
  requestTick()
}

function onVisibilityChange() {
  if (document.hidden) {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = 0
    setAnimating(false)
    cancelFrameWatch()
    resumeAfterVisibility = soundEnabled && !audio.paused
    audio.pause()
    if (audioContext?.state === 'running') void audioContext.suspend().catch(() => {})
    return
  }

  const shouldResume = resumeAfterVisibility && soundEnabled
  resumeAfterVisibility = false
  if (shouldResume) {
    void (async () => {
      try {
        ensureAudioSource()
        await ensureAudioAnalyser()
        if (soundEnabled) await audio.play()
      } catch {
        if (soundEnabled) await setSound(false)
      }
    })()
  }
  updateScrollTarget()
  requestTick()
}

/*
  Rotating a phone flips which rendition is the right one: the tall encode shown
  in landscape would be blown up past its own resolution. The media query fires
  exactly on the flip, and the scrubber re-seeks from `displayProgress` as soon
  as the replacement reports its duration, so no scroll state is carried over.
*/
function onRenditionChange() {
  const next = resolveRendition()
  if (next === renditionName) return
  renditionName = next
  root.dataset.rendition = next
  if (!staticMode) loadScene()
}

function applyMotionMode(next: boolean) {
  if (staticMode === next) return
  staticMode = next
  root.dataset.motion = next ? 'static' : 'cinematic'

  if (next) {
    unloadScene()
    root.classList.remove('media-fallback')
    root.classList.add('media-ready')
    resetChapterAccessibility(true)
  } else {
    setPerformanceLite(lowPowerHint, performance.now())
    root.classList.remove('media-ready')
    loadScene()
    resetChapterAccessibility(false)
    updateCopy(targetProgress)
  }
  measure()
  requestTick()
}

/* ── actions ──────────────────────────────────────────────────────────── */

async function activateOrigin() {
  introDismissed = true
  root.classList.add('origin-activated')
  requestTick()
  if (!soundEnabled) await setSound(true)
  window.scrollTo({
    top: runwayStart + runwayLength * 0.055,
    behavior: staticMode ? 'auto' : 'smooth',
  })
}

function replay() {
  introDismissed = false
  root.classList.remove('origin-activated')
  window.scrollTo({ top: runwayStart, behavior: staticMode ? 'auto' : 'smooth' })
}

/* ── boot ─────────────────────────────────────────────────────────────── */

root.dataset.rendition = renditionName
root.dataset.motion = staticMode ? 'static' : 'cinematic'
root.classList.toggle('performance-lite', performanceLite)
measure()

if (staticMode) {
  root.classList.add('media-ready')
  resetChapterAccessibility(true)
} else {
  loadScene()
  resetChapterAccessibility(false)
  updateCopy(targetProgress)
}

addEventListener('scroll', onScroll, { passive: true })
addEventListener('resize', onResize, { passive: true })
addEventListener('orientationchange', onResize, { passive: true })
document.addEventListener('visibilitychange', onVisibilityChange)
syncPointerParallax()
finePointerQuery.addEventListener('change', syncPointerParallax)
soundButton.addEventListener('click', () => void setSound(!soundEnabled))
originCore.addEventListener('click', () => void activateOrigin())
replayButton.addEventListener('click', replay)
skipLink.addEventListener('click', skipToFinal)
portraitPhoneQuery.addEventListener('change', onRenditionChange)
reducedMotionQuery.addEventListener('change', () => applyMotionMode(reducedMotionQuery.matches || dataSaver))

requestTick()
