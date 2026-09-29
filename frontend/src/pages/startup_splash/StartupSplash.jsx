import './StartupSplash.css'

// Presentation only: App owns the minimum display time and session check.
export default function StartupSplash({ progress = 0 }) {
  return (
    <main className="nf-startup-splash">
      <div className="nf-startup-splash__content">
        <svg
          className="nf-startup-splash__symbol"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 240 240"
          width="240"
          height="240"
          aria-hidden="true"
          focusable="false"
        >
          <g fill="none" stroke="currentColor" strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M115 67 C106 101 68 88 55 130" />
            <path d="M45 119 L54 132 L67 121" />
            <path d="M81 158 H158" />
            <path d="M147 147 L159 158 L147 169" />
            <path d="M187 133 C205 95 179 66 153 55" />
            <path d="M165 46 L152 55 L161 69" />
          </g>
          <g fill="currentColor">
            <circle cx="120" cy="44" r="22" />
            <circle cx="54" cy="158" r="22" />
            <circle cx="186" cy="158" r="22" />
          </g>
        </svg>

        <div className="nf-startup-splash__brand">
          <h1 className="nf-startup-splash__name">NetFlow</h1>
          <p className="nf-startup-splash__tagline">Work made visible</p>
        </div>

        <p className="nf-startup-splash__status" role="status" aria-live="polite" aria-atomic="true">
          Loading your workspace...
        </p>
        <div className="nf-startup-splash__progress-group">
          <div className="nf-startup-splash__progress-meta" aria-hidden="true">
            <span>Estimated progress</span>
            <span className="nf-startup-splash__percentage">{progress}%</span>
          </div>
          <div
            className="nf-startup-splash__progress"
            role="progressbar"
            aria-label="Estimated startup progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-valuetext={progress === 100 ? '100% — Startup checks complete' : `${progress}% estimated`}
          >
            <span
              className="nf-startup-splash__progress-fill"
              style={{ transform: `scaleX(${progress / 100})` }}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </main>
  )
}
