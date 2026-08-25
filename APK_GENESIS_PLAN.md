# APK://GENESIS — Implementation Plan

## 0a. Revision — delivery decisions superseded

Everything below is the original plan and still describes the intent, the copy
and the choreography accurately. Three of its **delivery** decisions were
measured against real encodes and real devices and did not survive; the code is
authoritative where they disagree.

| Plan said | What was measured | What ships |
| --- | --- | --- |
| §3 — encode all-intra (`-g 1`), never below 720p | GOP=1 at 720p is **17.2 MB** for the sequence, 9.5 MB even at 540p. All-intra buys nothing once the seek is snapped to a frame boundary, because the cost of a scrub is the browser's seek pipeline, not the four to eight frames a short GOP has to decode. | One master, `-g 8` with B-frames, at 20 fps (wide) and 16 fps (tall) |
| §7 — three stacked `<video>` elements, not one stitched runtime video | Three elements means three live decoders, three buffers and a cross-fade the compositor has to blend every frame — the single largest mobile cost in the old build. | One `<video>`. The two cross-fades are rendered **into** the master by `xfade`, so the dissolve is free at runtime |
| §9 — let `object-fit: cover` crop the 16:9 video on portrait phones | On a 390×844 phone, cover throws away roughly 74% of every frame that was paid for, and stretches the surviving ~330 px across 1170 device pixels | A second 9:15 centre-crop rendition (`genesis-tall.mp4`) selected before first paint |

Net effect on what a visitor downloads:

| | before | after |
| --- | --- | --- |
| scene video, desktop | 13.9 MB (3 files) | 4.2 MB |
| scene video, portrait phone | 13.9 MB (3 files) | 2.3 MB |
| soundtrack (lazy) | 2.5 MB | 2.1 MB |

`tools/build-media.sh` regenerates every delivery asset from the archival
masters and is the only place the encode settings live.

---

## 0. Project identity

**Name:** APK://GENESIS  
**Brand:** ApkMason.dev  
**Core line:** `AI · Pixels · Kinetics`  
**Role line:** `Developer × AI Creator`  
**Format:** cinematic, single-page, scroll-driven digital manifesto / portfolio experience  
**Mood:** black, minimal, premium, intelligent, futuristic — no generic cyberpunk UI, no neon overload.

The experience should feel like one continuous birth of a digital intelligence. The three generated films are not three sections; visually they are one evolving object and one uninterrupted story.

---

## 1. Primary goals

1. Make the page feel exceptionally smooth on both desktop and mobile.
2. Use the three supplied videos as one continuous scroll-scrubbed sequence.
3. Turn `APK` into a meaningful identity: **AI · Pixels · Kinetics**.
4. Present the creator behind ApkMason.dev as a **Developer × AI Creator** working at the intersection of generative AI, motion, interaction and code.
5. Keep text sparse, strong and editorial. The visual must remain the hero.
6. Do not add unnecessary sections, cards, gradients, icons or dashboard-style UI.
7. Do not assume playback, seeking, mobile viewport handling or transitions work correctly — test them.

---

## 2. Source assets

Current videos supplied by the user:

- Film 1 — birth of the light / data structure
- Film 2 — evolving geometric / kinetic AI core
- Film 3 — final awakened form / hero state

Technical properties of all three source files:

- 1280 × 720
- 24 fps
- ~10 seconds each
- H.264 / yuv420p

Rename working assets clearly:

```text
/public/media/genesis-01-birth.mp4
/public/media/genesis-02-formation.mp4
/public/media/genesis-03-ascension.mp4
/public/audio/genesis-theme.mp3
```

Do not alter aspect ratio or upscale them.

---

## 3. Critical video preparation — REQUIRED

The source files are not encoded as GOP=1. For scroll scrubbing create dedicated all-intra versions before implementation.

Example FFmpeg command for each video:

```bash
ffmpeg -i input.mp4 \
  -an \
  -c:v libx264 \
  -preset medium \
  -crf 23 \
  -g 1 \
  -keyint_min 1 \
  -sc_threshold 0 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  output-gop1.mp4
```

Use the GOP=1 versions for scroll seeking. Keep originals only as archival/fallback assets.

If file size becomes unnecessarily large, CRF may be increased slightly to 24, but inspect the glow, fine lines and dark gradients before accepting it. Do not reduce resolution below 720p unless there is a proven performance problem on a real device.

---

## 4. Overall structure

Use one long scroll runway with a fixed visual stage.

Suggested structure:

```text
<body>
  <header minimal fixed navigation />

  <main class="genesis-scroll-runway">
    <section class="genesis-stage sticky/fixed">
      video layer 1
      video layer 2
      video layer 3
      vignette / subtle grain layers
      copy layer
      progress / sound UI
    </section>
  </main>

  optional existing portfolio continuation / footer
</body>
```

Recommended scroll runway: **~1000–1100vh**.

Do not use dozens of DOM sections to fake progress. Keep one normalized master progress `0 → 1` and derive video time, copy opacity, transforms and transitions from it.

The experience should occupy the viewport using `100dvh`, with a safe fallback for browsers that do not support it.

---

## 5. Master narrative / timeline

### Phase 0 — VOID / 0.00–0.06

Visual:
- nearly complete darkness
- first point of light begins to appear
- no large typography immediately

Copy, small and restrained:

```text
APKMASON.DEV
A DIGITAL MANIFESTO
```

Optional microcopy near the bottom:

```text
SCROLL TO INITIATE
```

Fade this out as soon as the core begins to form.

---

### Phase 1 — AI / ~0.06–0.32

Film 1 dominates.

Hero word:

```text
AI
```

Supporting line:

```text
I use generative AI as a creative material — shaping ideas into visual systems, motion and atmosphere.
```

Behavior:
- `AI` enters softly, not as a hard pop.
- Use opacity + very small translateY + tracking animation.
- Do not scale text aggressively.
- Keep text away from the bright center of the core.
- Desktop: copy can sit left/lower-left.
- Mobile: copy should sit below or above the central core in a safe area.

---

### Phase 2 — PIXELS / ~0.30–0.58

Transition Film 1 → Film 2 with a short overlap/crossfade.

Hero word:

```text
PIXELS
```

Supporting line:

```text
I turn frames, interfaces and generated imagery into cinematic digital worlds built for the web.
```

Small capability rail may appear briefly:

```text
GENERATIVE VISUALS   /   INTERACTIVE WEB   /   MOTION
```

Do not make it look like a traditional skills list.

---

### Phase 3 — KINETICS / ~0.56–0.82

Film 2 → Film 3.

Hero word:

```text
KINETICS
```

Supporting line:

```text
I design movement you can feel — scroll, timing, sound and interaction become part of the story.
```

This is the most energetic phase. Typography may react subtly to scroll velocity:
- tiny tracking expansion
- 1–2 px blur at high velocity, immediately settling back to sharp
- max ~4–6 px vertical displacement

Do not overdo glitch effects.

---

### Phase 4 — ABOUT / ~0.80–0.92

As the final core stabilizes, reduce visual motion in the copy and let the user read.

Copy:

```text
I’m the maker behind ApkMason.dev — a developer and AI creator exploring the space between code, motion and imagination.
```

Secondary line:

```text
I build cinematic web experiences where AI-generated visuals meet interaction, sound and precise front-end craft.
```

Optional compact capability line:

```text
AI VISUALS  ·  SCROLL EXPERIENCES  ·  INTERACTIVE WEB  ·  MOTION DESIGN
```

Keep this phase brief. It is an identity statement, not a biography page.

---

### Phase 5 — APK / ~0.92–1.00

The final core reaches its hero state.

Main lockup:

```text
APK
AI · Pixels · Kinetics
```

Below:

```text
Developer × AI Creator
```

Small statement:

```text
Built with curiosity. Shaped with code.
```

CTA:

```text
EXPLORE WORK
```

Secondary action if the current portfolio already has a real contact route:

```text
CONTACT
```

Do not invent routes. Inspect the existing project and connect these actions to actual portfolio/work/contact destinations.

At 100% progress, hold the final video frame rather than letting the experience disappear abruptly.

---

## 6. Optional project references

If this experience is integrated into the main portfolio, the final state may surface 3–4 existing real projects as understated text links — not cards.

Good examples from the creator’s recent visual work include themes such as:

- SINGULARITY
- FORM / METAMORPH
- MECHANIKA CZASU
- THE IRIS

Only use names/routes that actually exist in the repository. Do not fabricate case-study URLs or descriptions.

Presentation example:

```text
SELECTED EXPERIMENTS
01  SINGULARITY
02  FORM / METAMORPH
03  MECHANIKA CZASU
04  THE IRIS
```

This is optional. The cinematic APK ending is more important than showing every project.

---

## 7. Video layer architecture

Use **three stacked `<video>` elements**, not one stitched runtime video.

Each video:

```html
<video
  muted
  playsinline
  preload="auto"
  disablePictureInPicture
  aria-hidden="true"
></video>
```

All video layers:
- `position: absolute; inset: 0`
- black stage underneath
- hardware-friendly transforms only
- no CSS filters directly on the videos if avoidable
- opacity is animated only near transitions

Recommended mapping:

```text
Film 1 local progress: master 0.00 → ~0.345
Film 2 local progress: master ~0.325 → ~0.675
Film 3 local progress: master ~0.655 → 1.00
```

The overlap ranges deliberately create short transition windows.

At each handoff:
- outgoing video remains close to its last frame
- incoming video begins close to its first frame
- crossfade over roughly 0.015–0.025 master progress
- test visually; use the smallest overlap that hides the slight luminance shift
- never use a white flash

The actual generated transitions are already close, so the crossfade should be subtle rather than obvious.

---

## 8. Smooth scroll engine — highest priority

Do not bind `video.currentTime` directly to raw scroll events.

Use this architecture:

1. Scroll event only updates `targetProgress`.
2. One persistent `requestAnimationFrame` loop performs all animation work.
3. `displayProgress` follows `targetProgress` using **time-based exponential smoothing**, not a frame-dependent fixed lerp.
4. Text and video use the same eased master progress so they never drift apart.

Conceptual formula:

```js
const alpha = 1 - Math.exp(-dt / tau);
displayProgress += (targetProgress - displayProgress) * alpha;
```

Suggested smoothing constants to tune on real hardware:

```text
Desktop tau: ~0.10–0.14 s
Mobile tau:  ~0.14–0.18 s
```

The page should feel responsive, not floaty. Do not add excessive lag.

### Seek throttling

For each active video:

- calculate desired media time from eased progress
- only assign `currentTime` when delta is greater than roughly **0.5 frame**
- normal maximum seek jump per update: around **2–2.5 frames**
- if the user performs a very fast scroll and the media falls far behind, allow controlled catch-up so the video does not remain seconds behind the content
- once the gap becomes small, return immediately to the normal frame-step limit

Do not queue many seeks simultaneously.

Avoid seeking inactive videos on every frame. Only the active layer and the layer involved in a transition should be updated.

### Frame precision

FPS is 24, so:

```js
const FRAME = 1 / 24;
```

Quantization to exact frames may be tested, but do not force it if it creates visible stair-stepping. Smooth perceived motion is more important than mathematical frame locking.

---

## 9. Mobile behavior

Mobile is not a simplified afterthought. Test on an actual narrow viewport and touch scrolling.

### Visual fitting

Because the subject is centered, allow the 16:9 video to crop horizontally on portrait screens if needed.

Recommended approach:
- stage = full `100dvh`
- video centered
- `object-fit: cover`
- keep all critical text in a mobile safe zone
- do not place copy over the brightest core

If `cover` crops too aggressively on a specific breakpoint, tune scale using a CSS custom property rather than switching the whole design to a boxed 16:9 player.

### Text

Mobile typography should be genuinely responsive:
- hero words with `clamp()`
- max text width around 28–34rem desktop, significantly narrower mobile
- body text around 15–18px depending on viewport
- use comfortable line height
- no tiny 10px body copy

### Viewport stability

Use `dvh` / `svh` carefully to avoid iOS/Android browser chrome jumps.

Do not attach expensive `touchmove` handlers.

Use passive listeners where appropriate.

---

## 10. Desktop behavior

At final progress, add a very subtle post-scroll living state:

- pointer movement can translate the final visual by at most ~4–6 px
- optional glow layer follows pointer with slow easing
- do not seek video in response to mouse movement
- no dramatic 3D rotation

The final core should feel alive, not like a draggable object.

Disable pointer-reactive extras on touch devices.

---

## 11. Typography / visual design

Direction:
- premium editorial + technical
- restrained uppercase for large keywords
- generous tracking
- one strong grotesk/sans family already used by the portfolio, or a performant local/system fallback
- no random font imports solely for this page unless justified

Palette:
- background: near-black / black
- primary text: off-white
- secondary text: cool gray
- accent derived from the video itself: very restrained icy blue/white

Avoid:
- strong cyan neon borders
- glassmorphism cards
- large rounded UI pills everywhere
- fake terminal panels
- generic Matrix/cyberpunk decorations

Optional atmosphere:
- extremely subtle film grain/noise layer
- soft vignette
- faint radial glow behind the core

Grain should not be a huge animated bitmap. Prefer a tiny repeatable texture or lightweight CSS/SVG technique.

---

## 12. Sound design

Audio is optional by default because browsers block autoplay with sound.

UI:

```text
SOUND OFF  ↔  SOUND ON
```

Behavior:
- initial state: sound off
- a user click/tap starts playback
- fade volume from 0 to target over ~1.0–1.5 s
- target volume should be restrained, roughly 0.25–0.35
- fade out smoothly when disabling sound
- do not restart the soundtrack whenever the user reverses scroll
- do not bind the audio timeline rigidly to scroll; the soundtrack creates atmosphere while the visuals remain scroll-controlled
- pause when document becomes hidden if appropriate, resume gracefully when visible again

If the Suno track is long, choose a strong opening section. The page does not need to use the entire song.

Optional: add tiny UI clicks/impulses for the AI/PIXELS/KINETICS text changes only if they genuinely improve the result. Do not layer excessive SFX over the music.

---

## 13. Performance

Performance is part of the visual quality.

Required:
- no React state update on every scroll/rAF frame
- store high-frequency values in refs/local variables
- transform/opacity only for animated DOM elements
- avoid layout reads after writes in the same frame
- avoid large blur filters on fullscreen elements
- do not animate box-shadow on large layers
- do not run three video seeks continuously at once
- remove event listeners and cancel rAF on unmount
- `will-change` only on elements that genuinely animate
- lazy-load non-critical portfolio content below the cinematic experience

Consider pausing the animation loop when the page is not visible.

Do not add a heavy animation library unless the existing project already uses it and it measurably simplifies the implementation. A small rAF engine is sufficient.

---

## 14. Loading experience

Never show a broken/empty black stage while the video metadata is unresolved.

Before starting:
- load film 1 metadata and enough data to display first frame
- show a minimal static first-frame state / black stage
- remove loader only when the first visual is ready

Loader copy, if needed:

```text
INITIALIZING
```

Keep it minimal.

Preload strategy:
- Film 1 immediately
- Film 2 early
- Film 3 can be warmed shortly after first interaction or once progress passes an early threshold

Do not block the entire page until all three full files are downloaded.

---

## 15. Reduced motion / accessibility

Respect `prefers-reduced-motion`.

Reduced-motion fallback:
- no continuous video scrubbing
- show a strong static frame from the final/core visual
- present AI / PIXELS / KINETICS and About copy as normal readable content
- preserve navigation and CTAs

Other requirements:
- sufficient contrast
- keyboard-reachable sound toggle and CTA
- sound toggle has accessible label/state
- videos are decorative and hidden from screen readers
- no essential information exists only as animation

---

## 16. Optional micro-details

Only after the core experience is smooth:

- very subtle cursor-reactive radial light on desktop
- small vertical progress marker using `APK` phases instead of a generic percentage
- phase label can morph:
  - `A / AI`
  - `P / PIXELS`
  - `K / KINETICS`
- scroll velocity can add a tiny temporary grain/aberration impulse, but keep it almost imperceptible

These are polish, not requirements. Do not sacrifice performance for them.

---

## 17. QA checklist

Test, do not assume.

### Video
- [ ] Film 1 starts on the correct frame.
- [ ] Film 1 → 2 has no visible brightness jump or black flash.
- [ ] Film 2 → 3 has no visible brightness jump or black flash.
- [ ] Reverse scrolling is as smooth as forward scrolling.
- [ ] Fast scroll catches up quickly without wild frame skipping.
- [ ] Final frame holds cleanly.
- [ ] No controls / PiP UI appears accidentally.

### Desktop
- [ ] Chrome / Chromium.
- [ ] Firefox if supported by the current project.
- [ ] 1920×1080.
- [ ] 1440p viewport.
- [ ] Laptop-scale viewport around 1366×768.
- [ ] Trackpad and mouse wheel both feel controlled.

### Mobile
- [ ] ~390×844 class viewport.
- [ ] ~360×800 class viewport.
- [ ] Touch scroll forward and backward.
- [ ] Browser toolbar expansion/collapse does not break the stage.
- [ ] Text does not collide with the core.
- [ ] No horizontal overflow.
- [ ] No accidental selection or overscroll artifacts.

### Performance
- [ ] No obvious main-thread spikes during normal scroll.
- [ ] No React render storm.
- [ ] No simultaneous repeated seeks on all three videos.
- [ ] Video memory is released appropriately when leaving/unmounting the experience.

### Audio
- [ ] Starts only after user interaction.
- [ ] Smooth fade in/out.
- [ ] Toggle state is obvious and accessible.
- [ ] Sound does not restart unexpectedly.

---

## 18. Acceptance criteria

The implementation is complete only when:

1. The three videos feel like **one continuous evolving object**.
2. Scroll direction can be reversed at any point without breaking the illusion.
3. Mobile feels intentional and nearly as smooth as desktop.
4. Text remains readable without stealing attention from the core.
5. `AI · Pixels · Kinetics` is clearly understood as the expanded identity behind `APK`.
6. The final frame resolves into a strong ApkMason.dev identity moment.
7. Sound enhances the experience but is never required.
8. Existing portfolio routes/content are reused rather than invented.
9. No visual effect is kept merely because it looks flashy; every effect must support the narrative.

---

## 19. Final instruction to the coding agent

Build this as a premium cinematic web experience, not a conventional landing page. Prioritize **perceived smoothness, continuity, responsive behavior and restraint** above feature count. Inspect the existing codebase before changing architecture, reuse existing routes and brand assets where appropriate, and verify every major behavior on both mobile and desktop. Do not assume that video seeking, typography, transitions, audio or responsive layout are correct just because they compile.
