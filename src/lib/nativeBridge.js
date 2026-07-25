// Bridges a handful of native-app behaviors when running inside the
// Capacitor iOS shell. Every function here is a no-op on the web and on
// Android's existing TWA -- Capacitor.isNativePlatform() is false in
// both of those, so none of this changes current production behavior
// there. Capacitor packages are already dependencies (see
// capacitor.config.json / ios/), imported dynamically so a plain web
// build never needs to load them.

// The production web origin. Used in place of window.location.origin
// specifically for Supabase auth redirect URLs (email confirmation,
// password reset) when running inside the bundled native app -- the
// bundled webview's own origin is a non-http scheme (e.g.
// capacitor://localhost), and a confirmation/reset email containing a
// link to that scheme would not be a real, openable link from any mail
// client. Hardcoding the real origin here means those emails always
// link to the actual website (opens in Safari, or reopens this app via
// Universal Links once the real Team ID is configured -- see
// docs/DWJ_IOS_APP_STORE_SUBMISSION.md). On web and the Android TWA,
// Capacitor.isNativePlatform() is false, so this always falls through
// to the existing window.location.origin behavior -- zero change there.
const PRODUCTION_WEB_ORIGIN = 'https://flippingtables.ai'

let capacitorAvailable = null

export function isNativeIOSApp() {
  return typeof window !== 'undefined' && !!window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
}

// Synchronous by design (auth calls need this value immediately, not
// after an async dynamic import resolves) -- relies on window.Capacitor
// already being present by the time React mounts, which Capacitor
// guarantees for a native-bundled app (it's injected before the page's
// own scripts run), unlike the other helpers in this file which lazily
// import @capacitor/core for tree-shaking on plain web builds.
export function getAuthRedirectOrigin() {
  return isNativeIOSApp() ? PRODUCTION_WEB_ORIGIN : window.location.origin
}

async function getCapacitor() {
  if (capacitorAvailable === false) return null
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) {
      capacitorAvailable = false
      return null
    }
    capacitorAvailable = true
    return Capacitor
  } catch {
    capacitorAvailable = false
    return null
  }
}

// Hides the native splash screen once the web app's own loading state
// (App.jsx's appReady) resolves -- launchAutoHide is set to false in
// capacitor.config.json specifically so this call is what controls the
// handoff, avoiding a flash between the native splash and the web
// loading screen.
export async function hideSplashScreen() {
  const Capacitor = await getCapacitor()
  if (!Capacitor) return
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch { /* never block app startup on a native plugin failing */ }
}

// Matches capacitor.config.json's StatusBar.style -- set again here at
// launch as a second, explicit guarantee independent of native config
// parsing, same "belt and suspenders" approach used elsewhere in this
// codebase for things that must not silently fail.
export async function configureStatusBar() {
  const Capacitor = await getCapacitor()
  if (!Capacitor) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Light })
    await StatusBar.setOverlaysWebView({ overlay: true })
  } catch { /* status bar styling is cosmetic -- never block on it */ }
}

// Opens a URL in an in-app SFSafariViewController (via the Browser
// plugin) instead of letting an external link either navigate away
// inside the app's own single WKWebView (losing the app entirely) or
// silently doing nothing. Intercepts clicks at the document level so
// no individual page needs to change how it renders external links
// (mailto:, onetengroup.ai, the Privacy Policy/Terms pages, etc.).
export function installExternalLinkHandler() {
  getCapacitor().then((Capacitor) => {
    if (!Capacitor) return
    document.addEventListener('click', async (event) => {
      const anchor = event.target.closest && event.target.closest('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href') || ''
      const isMailto = href.startsWith('mailto:')
      const isExternalHttp = /^https?:\/\//i.test(href) &&
        !href.includes('flippingtables.ai')
      if (!isMailto && !isExternalHttp) return
      event.preventDefault()
      if (isMailto) {
        window.location.href = href
        return
      }
      try {
        const { Browser } = await import('@capacitor/browser')
        await Browser.open({ url: href })
      } catch {
        window.open(href, '_blank')
      }
    })
  })
}
