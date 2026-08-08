# APK://GENESIS

A cinematic, scroll-driven digital manifesto for ApkMason.dev: **AI · Pixels · Kinetics**.

## Local development

```bash
npm ci
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

The production output is written to `dist/`. Vite uses relative asset paths, so the same build works under the GitHub Pages project path (`/apk_genesis/`) and later on a custom domain.

## GitHub Pages

Pushes to `main` run the Pages workflow. In the GitHub repository, choose **Settings → Pages → Build and deployment → Source: GitHub Actions** once before the first deployment.

The workflow builds the site, uploads `dist/` as the Pages artifact, and deploys it with the official GitHub actions. No secrets are required.

## Media

The shipped MP4 files are silent H.264/YUV420p encodes with a six-frame keyframe interval for responsive bidirectional seeking. The soundtrack is delivered as lazy-loaded AAC-LC in an M4A container. Source masters are intentionally ignored by Git; only optimized delivery assets in `public/` are published.
