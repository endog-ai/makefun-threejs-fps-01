// WHITEOUT palette: polar night — deep navy sky, white snow, ice blue,
// green aurora bands, and one warm amber accent for station windows.
// Every colour in the game comes from these names. No other colours.
export const PALETTE = {
  canvas: '#0b0f16',
  surface: '#141a24',
  hairline: '#232c3a',
  ink: '#e9eef5',
  muted: '#8fa3b8',
  accent: '#f0a830',
  snow: '#c9d6e3',
  ice: '#9fc4e8',
  concrete: '#6b7686',
  aurora: '#58d68d',
  ct: '#3f8cff',
  t: '#e0533d',
  site: '#58b368',
  danger: '#d43d2a',
};

export function shade(name) {
  return PALETTE[name];
}
