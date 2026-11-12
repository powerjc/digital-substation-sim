import { ZOOMS } from '../hooks/useRun'
import { fmtTime } from '../lib/units'

function Btn({ onClick, title, children, primary }) {
  return (
    <button onClick={onClick} title={title}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition
        ${primary ? 'bg-gray-800 text-white border-gray-800 hover:bg-gray-700' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'}`}>
      {children}
    </button>
  )
}

export default function SimControls({ run, freqHz }) {
  const { time, zoom, setZoom, playing, togglePlay, stepForward, stepBack, frameForward, rewind, setTime, speed, setSpeed } = run
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1" role="group" aria-label="View">
          {Object.values(ZOOMS).map(z => (
            <button key={z.id} onClick={() => setZoom(z.id)}
              className={`px-2.5 py-1 text-sm font-semibold rounded-md transition ${zoom.id === z.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {z.label}
            </button>
          ))}
        </div>
        <Btn onClick={rewind} title="Back to the start of this view">Reset</Btn>
        <Btn onClick={stepBack} title="Previous event">◀ Step</Btn>
        <Btn onClick={togglePlay} title={playing ? 'Pause' : 'Play'} primary>{playing ? '⏸ Pause' : '▶ Play'}</Btn>
        <Btn onClick={stepForward} title="Next event">Step ▶</Btn>
        <Btn onClick={frameForward} title="Next frame on the wire">Frame ▶</Btn>
        <select value={speed} onChange={e => setSpeed(Number(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white" title="Playback speed">
          {zoom.speeds.map(s => <option key={s} value={s}>{s}× speed</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={zoom.t0} max={zoom.t1} step={(zoom.t1 - zoom.t0) / 2000} value={time}
          onChange={e => setTime(Number(e.target.value))} className="flex-1 min-w-[8rem] h-2" aria-label="Run time" />
        <span className="font-mono text-sm text-gray-700 whitespace-nowrap text-right">
          t = {fmtTime(time)}{zoom.id === 'trip' && <span className="text-gray-400"> ({(time * freqHz).toFixed(2)} cyc)</span>}
        </span>
      </div>
    </div>
  )
}
