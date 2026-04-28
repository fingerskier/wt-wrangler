'use strict'

;(function () {
  // Pure: turn the layouts:run result envelope into an ordered list of toasts.
  // Returns [{kind: 'error'|'success', message: string}, …] for the renderer
  // to dispatch. Kept in its own module so it's unit-testable without a DOM.
  //
  // Precedence (the path the bug R3.7 fixes):
  //   error  → first an error toast, then a launching toast (wt.exe was still
  //            spawned; user should know both that style failed AND that the
  //            terminal is on its way).
  //   warnings → one error toast per warning, no launching toast.
  //   applied → one success toast naming what was applied + Launching…
  //   neither → just "Launching Windows Terminal…".
  function interpretRunToast(res) {
    const launching = { kind: 'success', message: 'Launching Windows Terminal…' }
    const style = res && res.style
    if (!style) return [launching]
    if (style.error) {
      return [
        { kind: 'error', message: 'Style failed: ' + style.error },
        launching,
      ]
    }
    if (Array.isArray(style.warnings) && style.warnings.length) {
      return style.warnings.map(w => ({ kind: 'error', message: 'Style: ' + w }))
    }
    const applied = style.applied || {}
    if (applied.profile || applied.window) {
      const parts = []
      if (applied.profile) parts.push('profile fragment')
      if (applied.window) parts.push('window settings')
      return [{ kind: 'success', message: `Style applied (${parts.join(' + ')}). Launching…` }]
    }
    return [launching]
  }

  const api = { interpretRunToast }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.RunToast = api
})()
