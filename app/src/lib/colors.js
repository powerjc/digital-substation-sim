// Per-device colors shared by the station view, timing chart and frame list.
export const DEVICE_COLOR = {
  '21-AB': '#2563eb', // blue (as Relay A in the Line Protection Simulator)
  '52-AB': '#ea580c', // orange
  SW1: '#475569',     // slate
}
export const deviceColor = id => DEVICE_COLOR[id] ?? '#6b7280'

// Frame fate at a subscriber
export const FATE = {
  new:      { label: 'new state',  color: '#16a34a', bg: 'bg-green-100 text-green-800' },
  repeat:   { label: 'repeat',     color: '#9ca3af', bg: 'bg-gray-100 text-gray-600' },
  old:      { label: 'old',        color: '#9ca3af', bg: 'bg-gray-100 text-gray-600' },
  ignored:  { label: 'ignored',    color: '#d97706', bg: 'bg-amber-100 text-amber-800' },
  rejected: { label: 'rejected',   color: '#ea580c', bg: 'bg-orange-100 text-orange-800' },
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
}
