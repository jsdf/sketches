export const colors = {
  bg: '#0b0c11',
  surface: '#14161f',
  surfaceAlt: '#1c1f2b',
  border: '#272b3a',
  text: '#eceef5',
  textDim: '#8b90a3',
  textFaint: '#5d6274',
  accent: '#ffbe4d',
  accentDim: '#4a3a16',
  root: '#ff7a59',
  good: '#57d38c',
  bad: '#ef5f6b',
  melody: '#6db8ff',
  chords: '#c79bff',
};

export const radius = {sm: 8, md: 12, lg: 16, pill: 999};
export const space = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24};

export const type = {
  title: {fontSize: 22, fontWeight: '700' as const, color: colors.text},
  heading: {fontSize: 16, fontWeight: '700' as const, color: colors.text},
  body: {fontSize: 14, color: colors.text},
  dim: {fontSize: 13, color: colors.textDim},
  tiny: {fontSize: 11, color: colors.textDim, fontWeight: '600' as const},
  mono: {fontSize: 13, color: colors.textDim, fontVariant: ['tabular-nums'] as ('tabular-nums')[]},
};
