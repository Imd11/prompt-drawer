export function createCalicoMotionRuntime({
  renderer,
  host,
  manifest,
  sheetManifest,
  now = () => Date.now(),
}) {
  let currentPriority = 0;
  let minUntil = 0;
  let autoReturnTimer = 0;
  let disposed = false;

  function stateFor(requestedState) {
    if (requestedState && manifest.states[requestedState]) return requestedState;
    return manifest.defaultState;
  }

  function entryFor(state) {
    return manifest.states[state] || manifest.states[manifest.defaultState];
  }

  function render(state, entry) {
    renderer.setPresentation(entry);
    const operation = state === manifest.defaultState
      ? renderer.showBaseline(entry)
      : renderer.play(state, sheetManifest.states[state], { restart: entry.replay === true });
    Promise.resolve(operation).catch((error) => {
      console.error(`Failed to render Calico motion: ${state}`, error);
    });
  }

  function apply(payload = {}) {
    if (disposed) return false;
    const state = stateFor(payload.state);
    const entry = entryFor(state);
    if (!entry) return false;
    if (state !== manifest.defaultState && !sheetManifest.states[state]) return false;

    const priority = Number.isFinite(payload.priority) ? payload.priority : entry.priority;
    if (!payload.force && now() < minUntil && priority < currentPriority) return false;

    window.clearTimeout(autoReturnTimer);
    autoReturnTimer = 0;
    currentPriority = priority;
    minUntil = now() + (entry.minMs || 0);
    host.dataset.motionState = state;
    render(state, entry);

    const durationMs = payload.durationMs ?? entry.durationMs;
    if (durationMs > 0) {
      autoReturnTimer = window.setTimeout(reset, durationMs);
    }
    return true;
  }

  function reset() {
    return apply({ state: manifest.defaultState, priority: 0, force: true });
  }

  function suspend(options = { retainFrame: true }) {
    window.clearTimeout(autoReturnTimer);
    autoReturnTimer = 0;
    renderer.suspend(options);
  }

  function resume() {
    return renderer.resume();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(autoReturnTimer);
    autoReturnTimer = 0;
    renderer.dispose();
  }

  return { apply, reset, suspend, resume, dispose };
}
