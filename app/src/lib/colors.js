// Per-device colors shared by the station view, timing chart and frame list.
export const DEVICE_COLOR = {
  '21-AB': '#2563eb', // blue (as Relay A in the Line Protection Simulator)
  '52-AB': '#ea580c', // orange
  PB: '#475569',      // slate
  SB: '#64748b',
  GW: '#7c3aed',
  TS: '#a855f7',      // purple: the test set
  '21-AX': '#ca8a04', // yellow (as in the Line Protection Simulator)
  '52-AX': '#0d9488', // teal
}
export const deviceColor = id => DEVICE_COLOR[id] ?? '#6b7280'

// Frame fate at a subscriber
export const FATE = {
  new:      { label: 'new state',  color: '#16a34a', bg: 'bg-green-100 text-green-800' },
  repeat:   { label: 'repeat',     color: '#9ca3af', bg: 'bg-gray-100 text-gray-600' },
  old:      { label: 'old',        color: '#9ca3af', bg: 'bg-gray-100 text-gray-600' },
  ignored:  { label: 'ignored',    color: '#d97706', bg: 'bg-amber-100 text-amber-800' },
  rejected: { label: 'rejected',   color: '#ea580c', bg: 'bg-orange-100 text-orange-800' },
  testIgnored: { label: 'test: not used', color: '#a855f7', bg: 'bg-purple-100 text-purple-800' },
  simIgnored: { label: 'simulated: ignored', color: '#c084fc', bg: 'bg-purple-50 text-purple-700' },
  realIgnored: { label: 'real: ignored (sim mode)', color: '#7e22ce', bg: 'bg-purple-200 text-purple-900' },
  lost:     { label: 'lost',       color: '#dc2626', bg: 'bg-red-100 text-red-800' },
  inFlight: { label: 'in flight',  color: '#9ca3af', bg: 'bg-gray-100 text-gray-500' },
  pending:  { label: 'in flight',  color: '#9ca3af', bg: 'bg-gray-100 text-gray-500' },
}

// Subscription supervision status
export const SUB_STATUS = {
  healthy:  { label: 'OK',        color: '#16a34a', bg: 'bg-green-100 text-green-800 border-green-300' },
  stale:    { label: 'LOST',      color: '#dc2626', bg: 'bg-red-100 text-red-800 border-red-300' },
  noMsg:    { label: 'NO MSG',    color: '#dc2626', bg: 'bg-red-100 text-red-800 border-red-300' },
  mismatch: { label: 'CONFIG',    color: '#ea580c', bg: 'bg-orange-100 text-orange-800 border-orange-300' },
  none:     { label: 'NONE',      color: '#9ca3af', bg: 'bg-gray-100 text-gray-600 border-gray-300' },
}
