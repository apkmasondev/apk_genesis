import './style.css'

type VideoState = {
  element: HTMLVideoElement
  start: number
  end: number
  source: string
  loaded: boolean
  loading: boolean
  pendingTime: number | null
  lastSeekAt: number
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / Math.max(0.0001, to - from))
  return t * t * (3 - 2 * t)
}

const root = document.documentElement
const runway = document.querySelector<HTMLElement>('.runway')!
const skipLink = document.querySelector<HTMLAnchorElement>('.skip-link')!
const loader = document.querySelector<HTMLElement>('.loader')!
const chapters = [...document.querySelectorAll<HTMLElement>('.chapter')]
const soundButton = document.querySelector<HTMLButtonElement>('.sound-toggle')!
const soundLabel = document.querySelector<HTMLElement>('.sound-label')!
const originCore = document.querySelector<HTMLButtonElement>('.origin-core')!
const replayButton = document.querySelector<HTMLButtonElement>('.replay-button')!
const skipTarget = document.querySelector<HTMLElement>('.skip-target')!
const phaseCode = document.querySelector<HTMLElement>('.phase-code')!
const phaseCount = document.querySelector<HTMLElement>('.phase-count')!
const videos = [...document.querySelectorAll<HTMLVideoElement>('.video-stack video')]
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const coarsePointerQuery = window.matchMedia('(pointer: coarse)')
const finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
const FRAME = 1 / 24
const mediaUrl = (path: string) => new URL(path, document.baseURI).href
const audioSourceUrl = mediaUrl('audio/genesis-theme.m4a')

const videoStates: VideoState[] = [
  { element: videos[0], start: 0, end: 0.345, source: mediaUrl('media/genesis-01-birth.mp4'), loaded: false, loading: false, pendingTime: null, lastSeekAt: 0 },
  { element: videos[1], start: 0.325, end: 0.675, source: mediaUrl('media/genesis-02-formation.mp4'), loaded: false, loading: false, pendingTime: null, lastSeekAt: 0 },
  { element: videos[2], start: 0.655, end: 1, source: mediaUrl('media/genesis-03-ascension.mp4'), loaded: false, loading: false, pendingTime: null, lastSeekAt: 0 },
]

let runwayStart = 0
let runwayLength = 1
let targetProgress = 0
let displayProgress = 0
let previousTarget = 0
let lastFrameTime = performance.now()
let animationFrame = 0
let warmedSecond = false
let warmedThird = false
let lastScrollTime = performance.now()
let scrollVelocity = 0
let pointerTargetX = 0
let pointerTargetY = 0
let pointerX = 0
let pointerY = 0
let hasMeasured = false

const audio = new Audio()
audio.id = 'genesis-soundtrack'
audio.hidden = true
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
document.body.append(audio)

function setChapterAccessibility(chapter: HTMLElement, accessible: boolean) {
  const hidden = !accessible
  const alreadySynced = chapter.inert === hidden
    && (hidden ? chapter.getAttribute('aria-hidden') === 'true' : !chapter.hasAttribute('aria-hidden'))
  if (alreadySynced) return

  if (hidden && chapter.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur()
  }
  chapter.inert = hidden
  if (hidden) chapter.setAttribute('aria-hidden', 'true')
  else chapter.removeAttribute('aria-hidden')
}

function ensureAudioSource() {
  if (audioSourceLoaded) return
  audioSourceLoaded = true
  audio.preload = 'auto'
  audio.src = audioSourceUrl
  audio.load()
}

function measure(preserveProgress = false) {
  const progressBeforeResize = targetProgress
  const wasInsideRunway = hasMeasured
    && window.scrollY >= runwayStart
    && window.scrollY <= runwayStart + runwayLength

  runwayStart = runway.offsetTop
  runwayLength = Math.max(1, runway.offsetHeight - window.innerHeight)

  if (preserveProgress && wasInsideRunway && !reducedMotionQuery.matches) {
    const preservedScrollY = runwayStart + progressBeforeResize * runwayLength
    if (Math.abs(window.scrollY - preservedScrollY) > 1) {
      window.scrollTo({ top: preservedScrollY, behavior: 'auto' })
    }
  }

  updateScrollTarget()
  previousTarget = targetProgress
  hasMeasured = true
}

function updateScrollTarget() {
  targetProgress = clamp((window.scrollY - runwayStart) / runwayLength)
}

function loadVideo(state: VideoState, priority: 'auto' | 'metadata' = 'auto') {
  if (state.loading || state.loaded) return
  state.loading = true
  state.element.preload = priority
  state.element.src = state.source
  state.element.load()
}

function warmMedia(progress: number) {
  if (!warmedSecond && progress > 0.1) {
    warmedSecond = true
    loadVideo(videoStates[1])
  }
  if (!warmedThird && progress > 0.26) {
    warmedThird = true
    loadVideo(videoStates[2])
  }
}

function localVideoProgress(progress: number, state: VideoState) {
  return clamp((progress - state.start) / (state.end - state.start))
}

function videoOpacity(index: number, progress: number) {
  if (index === 0) return 1 - smoothstep(0.325, 0.345, progress)
  if (index === 1) return smoothstep(0.325, 0.345, progress) * (1 - smoothstep(0.655, 0.675, progress))
  return smoothstep(0.655, 0.675, progress)
}

function requestSeek(state: VideoState, desiredTime: number, now: number, opacity: number) {
  const video = state.element
  if (!state.loaded || video.readyState < HTMLMediaElement.HAVE_METADATA || opacity < 0.015) return

  const safeDuration = Math.max(0, video.duration - FRAME * 0.5)
  const boundedTime = clamp(desiredTime, 0, safeDuration)
  state.pendingTime = clamp(Math.round(boundedTime / FRAME) * FRAME, 0, safeDuration)
  const minInterval = coarsePointerQuery.matches ? 46 : 32
  if (video.seeking || now - state.lastSeekAt < minInterval) return

  const gap = state.pendingTime - video.currentTime
  if (Math.abs(gap) < FRAME * 0.45) {
    state.pendingTime = null
    return
  }

  state.lastSeekAt = now
  const nextTime = state.pendingTime
  state.pendingTime = null
  try {
    video.currentTime = nextTime
  } catch {
    // Metadata can become temporarily unavailable during source selection.
  }
}

function updateVideos(progress: number, now: number) {
  videoStates.forEach((state, index) => {
    const opacity = videoOpacity(index, progress)
    state.element.style.opacity = opacity.toFixed(4)
    state.element.style.zIndex = String(opacity > 0.01 ? index + 1 : 0)
    if (opacity <= 0.015) {
      const duration = Number.isFinite(state.element.duration) ? state.element.duration : 10
      const boundaryTime = progress >= state.end ? Math.max(0, duration - FRAME * 0.5) : 0
      requestSeek(state, boundaryTime, now, 1)
      return
    }

    const duration = Number.isFinite(state.element.duration) ? state.element.duration : 10
    const desiredTime = localVideoProgress(progress, state) * Math.max(0, duration - FRAME * 0.5)
    requestSeek(state, desiredTime, now, opacity)
  })
}

function chapterOpacity(element: HTMLElement, progress: number) {
  const start = Number(element.dataset.start)
  const end = Number(element.dataset.end)
  const span = end - start
  const fade = Math.min(0.045, span * 0.23)
  const enter = element.classList.contains('chapter-intro') ? 1 : smoothstep(start, start + fade, progress)
  const exit = element.classList.contains('chapter-final') ? 1 : 1 - smoothstep(end - fade, end, progress)
  return clamp(Math.min(enter, exit))
}

function updateCopy(progress: number) {
  for (const chapter of chapters) {
    const opacity = chapterOpacity(chapter, progress)
    const start = Number(chapter.dataset.start)
    const entrance = clamp((progress - start) / 0.055)
    chapter.style.setProperty('--chapter-opacity', opacity.toFixed(4))
    chapter.style.setProperty('--chapter-y', `${(1 - smoothstep(0, 1, entrance)) * 16}px`)
    const interactive = opacity > 0.72
    if (chapter.classList.contains('is-interactive') !== interactive) {
      chapter.classList.toggle('is-interactive', interactive)
      setChapterAccessibility(chapter, interactive)
    }
  }

  const coreIsActive = progress < 0.035
  originCore.classList.toggle('is-active', coreIsActive)
  originCore.tabIndex = coreIsActive ? 0 : -1
}

function updatePhase(progress: number) {
  const phase = progress < 0.335 ? ['A', '01 / 03'] : progress < 0.665 ? ['P', '02 / 03'] : ['K', '03 / 03']
  if (phaseCode.textContent !== phase[0]) {
    phaseCode.textContent = phase[0]
    phaseCount.textContent = phase[1]
  }
}

async function ensureAudioAnalyser() {
  if (audioContext?.state === 'suspended') await audioContext.resume()
  if (audioAnalyser && audioContext) {
    return
  }
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
    // The soundtrack remains fully functional when Web Audio is unavailable.
    try { audioAnalyser?.disconnect() } catch { /* Node was not connected. */ }
    try { audioSource?.disconnect() } catch { /* Node was not connected. */ }
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
  const canReact = soundEnabled
    && !audio.paused
    && audioVolume > 0.002
    && audioAnalyser
    && audioFrequencyData
    && !reducedMotionQuery.matches

  if (canReact && audioAnalyser && audioFrequencyData) {
    audioAnalyser.getByteFrequencyData(audioFrequencyData)
    const end = Math.min(audioFrequencyData.length, 18)
    let sum = 0
    for (let index = 1; index < end; index += 1) sum += audioFrequencyData[index]
    const average = end > 1 ? sum / (end - 1) / 255 : 0
    const amplitude = clamp((average - 0.035) * 2.45)
    energyTarget = amplitude * clamp(audioVolume / 0.28)
  }

  const tau = energyTarget > audioEnergy ? 0.065 : 0.2
  audioEnergy += (energyTarget - audioEnergy) * (1 - Math.exp(-dt / tau))
  if (Math.abs(energyTarget - audioEnergy) < 0.002) audioEnergy = energyTarget
  const sceneCompensation = 1 + smoothstep(0.12, 0.72, displayProgress) * 0.95
  const visualEnergy = clamp(audioEnergy * sceneCompensation)
  root.style.setProperty('--audio-energy', audioEnergy.toFixed(4))
  root.style.setProperty('--audio-visual-energy', visualEnergy.toFixed(4))
  audio.dataset.energy = audioEnergy.toFixed(3)
  audio.dataset.visualEnergy = visualEnergy.toFixed(3)
}

function updateAudio(dt: number) {
  const tau = audioTarget > audioVolume ? 0.42 : 0.28
  const alpha = 1 - Math.exp(-dt / tau)
  audioVolume += (audioTarget - audioVolume) * alpha
  if (Math.abs(audioTarget - audioVolume) < 0.002) audioVolume = audioTarget
  audio.volume = clamp(audioVolume, 0, 0.28)
  audio.dataset.volume = audioVolume.toFixed(3)

  updateAudioEnergy(dt)

  if (!soundEnabled && audioVolume === 0 && !audio.paused) {
    audio.pause()
    if (audioContext?.state === 'running') void audioContext.suspend().catch(() => {})
  }
}

function needsAnotherFrame() {
  const progressMoving = Math.abs(targetProgress - displayProgress) > 0.00008
  const audioMoving = Math.abs(audioTarget - audioVolume) > 0.001
  const audioReactive = soundEnabled && !audio.paused && audioAnalyser !== null
  const haloSettling = audioEnergy > 0.002
  const pointerMoving = Math.abs(pointerTargetX - pointerX) > 0.01 || Math.abs(pointerTargetY - pointerY) > 0.01
  const seekPending = videoStates.some((state) => state.element.seeking || state.pendingTime !== null)
  return progressMoving || audioMoving || audioReactive || haloSettling || pointerMoving || seekPending
}

function tick(now: number) {
  animationFrame = 0
  const dt = Math.min(0.064, Math.max(0.001, (now - lastFrameTime) / 1000))
  lastFrameTime = now

  if (!reducedMotionQuery.matches) {
    const settling = now - lastScrollTime > 90
    const tau = settling
      ? (coarsePointerQuery.matches ? 0.055 : 0.04)
      : (coarsePointerQuery.matches ? 0.15 : 0.115)
    const alpha = 1 - Math.exp(-dt / tau)
    displayProgress += (targetProgress - displayProgress) * alpha
    const snapThreshold = settling ? 0.00035 : 0.00005
    if (Math.abs(targetProgress - displayProgress) < snapThreshold) displayProgress = targetProgress
  } else {
    displayProgress = targetProgress
  }

  const pointerAlpha = 1 - Math.exp(-dt / 0.24)
  pointerX += (pointerTargetX - pointerX) * pointerAlpha
  pointerY += (pointerTargetY - pointerY) * pointerAlpha
  const velocityAlpha = 1 - Math.exp(-dt / 0.09)
  scrollVelocity += (0 - scrollVelocity) * velocityAlpha

  root.style.setProperty('--master-progress', displayProgress.toFixed(5))
  root.style.setProperty('--pointer-x', `${pointerX.toFixed(2)}px`)
  root.style.setProperty('--pointer-y', `${pointerY.toFixed(2)}px`)
  root.style.setProperty('--kinetic-shift', `${clamp(scrollVelocity * 2.4, -5, 5).toFixed(2)}px`)
  root.style.setProperty('--kinetic-blur', `${clamp(Math.abs(scrollVelocity) * 0.55, 0, 1.2).toFixed(2)}px`)
  root.style.setProperty('--kinetic-track', `${(0.08 + clamp(Math.abs(scrollVelocity) * 0.008, 0, 0.035)).toFixed(3)}em`)
  const aiSignal = smoothstep(0.045, 0.29, displayProgress)
  const aiAccent = Math.sin(aiSignal * Math.PI)
  const pixelResolve = smoothstep(0.285, 0.48, displayProgress)
  root.style.setProperty('--ai-sweep', `${(-65 + aiSignal * 230).toFixed(1)}%`)
  root.style.setProperty('--ai-split', `${(aiAccent * 3.2).toFixed(2)}px`)
  root.style.setProperty('--ai-accent-opacity', (aiAccent * 0.92).toFixed(3))
  root.style.setProperty('--pixel-shift', `${((1 - pixelResolve) * 9).toFixed(2)}px`)
  root.style.setProperty('--pixel-opacity', (0.14 + (1 - pixelResolve) * 0.58).toFixed(3))
  root.style.setProperty('--pixel-size', `${(7 + (1 - pixelResolve) * 5).toFixed(2)}px`)

  if (!reducedMotionQuery.matches) {
    warmMedia(displayProgress)
    updateVideos(displayProgress, now)
    updateCopy(displayProgress)
    updatePhase(displayProgress)
  }
  updateAudio(dt)

  if (needsAnotherFrame() && !document.hidden) {
    root.dataset.animating = 'true'
    animationFrame = requestAnimationFrame(tick)
  } else {
    root.dataset.animating = 'false'
  }
}

function requestTick() {
  if (animationFrame || document.hidden) return
  root.dataset.animating = 'true'
  lastFrameTime = performance.now()
  animationFrame = requestAnimationFrame(tick)
}

function onScroll() {
  const now = performance.now()
  const elapsed = Math.max(16, now - lastScrollTime)
  updateScrollTarget()
  const delta = targetProgress - previousTarget
  scrollVelocity = clamp((delta / elapsed) * 1900, -2.5, 2.5)
  previousTarget = targetProgress
  lastScrollTime = now
  requestTick()
}

function onResize() {
  measure(true)
  requestTick()
}

function initializeVideo(state: VideoState, index: number) {
  const onMetadata = () => {
    if (!state.element.currentSrc) return
    state.loaded = true
    state.loading = false
    state.element.pause()
    state.element.currentTime = 0
    requestTick()
  }

  state.element.addEventListener('loadedmetadata', onMetadata)
  state.element.addEventListener('seeked', () => requestTick())
  state.element.addEventListener('error', () => {
    if (!state.element.currentSrc) return
    state.loading = false
    root.classList.add('media-fallback')
    if (index === 0) {
      loader.querySelector('span')!.textContent = 'Visual ready in static mode'
      window.setTimeout(() => root.classList.add('media-ready'), 800)
    }
  })

  if (index === 0) {
    state.element.addEventListener('loadeddata', () => {
      if (!state.element.currentSrc) return
      root.classList.remove('media-fallback')
      root.classList.add('media-ready')
      if (!warmedSecond) {
        warmedSecond = true
        loadVideo(videoStates[1])
      }
      warmMedia(displayProgress)
      requestTick()
    })
  }
}

async function setSound(enabled: boolean) {
  const operation = ++soundOperation
  soundEnabled = enabled
  soundButton.setAttribute('aria-pressed', String(soundEnabled))
  soundButton.setAttribute('aria-label', soundEnabled ? 'Turn soundtrack off' : 'Turn soundtrack on')
  soundLabel.textContent = soundEnabled ? 'Sound on' : 'Sound off'
  root.classList.toggle('sound-on', soundEnabled)

  if (soundEnabled) {
    audioTarget = 0.28
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

function toggleSound() {
  return setSound(!soundEnabled)
}

async function activateOrigin() {
  root.classList.add('origin-activated')
  if (!soundEnabled) await setSound(true)

  const destination = runwayStart + runwayLength * 0.055
  window.scrollTo({
    top: destination,
    behavior: reducedMotionQuery.matches ? 'auto' : 'smooth',
  })
}

function onVisibilityChange() {
  if (document.hidden) {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = 0
    resumeAfterVisibility = soundEnabled && !audio.paused
    audio.pause()
    if (audioContext?.state === 'running') void audioContext.suspend().catch(() => {})
  } else {
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
}

function onPointerMove(event: PointerEvent) {
  const coreOrFinalIsVisible = displayProgress < 0.09 || displayProgress >= 0.89
  if (!finePointerQuery.matches || reducedMotionQuery.matches || !coreOrFinalIsVisible) return
  pointerTargetX = ((event.clientX / window.innerWidth) * 2 - 1) * 5
  pointerTargetY = ((event.clientY / window.innerHeight) * 2 - 1) * 5
  requestTick()
}

function skipToFinal(event: MouseEvent) {
  event.preventDefault()
  if (reducedMotionQuery.matches) {
    document.querySelector<HTMLElement>('.chapter-final')!.scrollIntoView({ behavior: 'auto', block: 'start' })
  } else {
    window.scrollTo({ top: runwayStart + runwayLength, behavior: 'auto' })
    targetProgress = 1
    displayProgress = 1
    previousTarget = 1
    updateVideos(1, performance.now())
    updateCopy(1)
    updatePhase(1)
  }
  skipTarget.focus({ preventScroll: true })
  requestTick()
}

function onReducedMotionChange() {
  root.classList.toggle('reduced-motion', reducedMotionQuery.matches)
  if (reducedMotionQuery.matches) {
    warmedSecond = false
    warmedThird = false
    videoStates.forEach((state) => {
      state.element.pause()
      state.element.removeAttribute('src')
      state.element.load()
      state.loaded = false
      state.loading = false
      state.pendingTime = null
      state.lastSeekAt = 0
    })
    chapters.forEach((chapter) => setChapterAccessibility(chapter, true))
    root.classList.add('media-ready')
  } else {
    root.classList.remove('media-ready', 'media-fallback')
    loadVideo(videoStates[0])
    updateCopy(targetProgress)
  }
  measure()
  requestTick()
}

videoStates.forEach(initializeVideo)
measure()
root.classList.toggle('reduced-motion', reducedMotionQuery.matches)

if (reducedMotionQuery.matches) {
  root.classList.add('media-ready')
  chapters.forEach((chapter) => setChapterAccessibility(chapter, true))
} else {
  loadVideo(videoStates[0])
  updateCopy(0)
  updateVideos(0, performance.now())
}

window.addEventListener('scroll', onScroll, { passive: true })
window.addEventListener('resize', onResize, { passive: true })
window.addEventListener('orientationchange', onResize, { passive: true })
window.addEventListener('pointermove', onPointerMove, { passive: true })
document.addEventListener('visibilitychange', onVisibilityChange)
soundButton.addEventListener('click', () => void toggleSound())
originCore.addEventListener('click', () => void activateOrigin())
skipLink.addEventListener('click', skipToFinal)
replayButton.addEventListener('click', () => window.scrollTo({ top: runwayStart, behavior: reducedMotionQuery.matches ? 'auto' : 'smooth' }))
reducedMotionQuery.addEventListener('change', onReducedMotionChange)

requestTick()
