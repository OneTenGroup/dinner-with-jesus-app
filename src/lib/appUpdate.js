// Coordinates PWA update reloads so a newly-activated service worker
// never yanks the screen out from under someone mid-task. Plain module
// state (not React context) -- deliberately minimal so any screen can
// report "I'm busy" without a provider wired through the whole tree.
//
// Flow: main.jsx wires the actual service-worker registration/update
// checks and calls requestReload() when a new SW has taken control.
// App.jsx marks the user "busy" while they're actively at the dinner
// table (the existing atTable flag already means exactly this -- it's
// the same signal that hides the bottom nav during the flow), and
// JournalPage.jsx marks busy while there's unsent draft text. If a
// reload is requested while busy, it's deferred and a small "Update
// ready" notice is shown instead of forcing it.

let busy = false
let pendingReload = false
let reloaded = false
let notifyHandler = null

function doReload() {
  if (reloaded) return // guards against a reload-loop if controllerchange fires again post-reload
  reloaded = true
  window.location.reload()
}

export function setUpdateBusy(isBusy) {
  busy = isBusy
  if (!busy && pendingReload) {
    doReload()
  }
}

export function registerUpdateNotifyHandler(fn) {
  notifyHandler = fn
}

export function requestReload() {
  pendingReload = true
  if (!busy) {
    doReload()
  } else if (notifyHandler) {
    notifyHandler()
  }
}

// Called from the "Update ready" notice's own button -- an explicit
// user action always reloads immediately regardless of busy state.
export function applyUpdateNow() {
  doReload()
}
