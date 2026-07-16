import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Short build identifier baked in at build time -- shown in Settings so
// a real device's version can be confirmed against what was actually
// deployed, not guessed from "it looks updated". Prefers Vercel's own
// built-in commit-SHA env var (always present in Vercel's build
// environment, exactly matches what's deployed) over shelling out to
// git, since a local dev machine's PATH may not have git on it even
// though the repo itself does -- confirmed the case in this project's
// own dev environment.
function getBuildVersion() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  }
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev-' + Date.now().toString(36)
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(getBuildVersion())
  },
  plugins: [
    react(),
    VitePWA({
      // Registration is done manually in src/main.jsx via
      // virtual:pwa-register, so this app has direct control over
      // update-check timing (immediate, on foreground return, and
      // periodic) and over exactly when a reload happens -- the
      // default auto-injected register script has none of that, which
      // is the main reason installed devices weren't reliably picking
      // up new deploys. injectRegister: false stops the plugin from
      // ALSO injecting its own basic script (would double-register).
      injectRegister: false,
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true
      },
      // Explicitly disabled, not just omitted -- omitting this option
      // still made the plugin emit a minimal, incomplete
      // dist/manifest.webmanifest (missing theme_color, triggering its
      // own "won't be installable" build warning) that nothing actually
      // links to. index.html links the real, correct, hand-authored
      // public/manifest.json directly -- one manifest, not two.
      manifest: false
    })
  ],
  publicDir: 'public'
})
