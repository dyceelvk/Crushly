/**
 * Crushly design tokens.
 *
 * Dark is the signature experience ("Noir"); light ("Ivory") is a fully
 * supported alternative. Components never hard-code colors — they read the
 * active palette from `useTheme()`.
 */

export const palettes = {
  dark: {
    scheme: 'dark' as const,
    bg: '#070708',
    bgSecondary: '#101012',
    card: '#17171A',
    elevated: '#202024',
    text: '#FFFFFF',
    textSecondary: '#A6A6AD',
    textMuted: '#7C7C85',
    gold: '#D8B46A',
    goldBright: '#F0D59A',
    goldDeep: '#B8893E',
    goldSoft: 'rgba(216,180,106,0.14)',
    goldLine: 'rgba(216,180,106,0.32)',
    onGold: '#141108',
    crush: '#FF496C',
    crushDeep: '#E0284F',
    crushSoft: 'rgba(255,73,108,0.14)',
    onCrush: '#FFFFFF',
    success: '#4CD7A0',
    successSoft: 'rgba(76,215,160,0.14)',
    danger: '#FF5C67',
    dangerSoft: 'rgba(255,92,103,0.14)',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.16)',
    glass: 'rgba(20,20,23,0.78)',
    scrim: 'rgba(0,0,0,0.62)',
    photoScrim: ['rgba(7,7,8,0)', 'rgba(7,7,8,0.55)', 'rgba(7,7,8,0.94)'] as const,
    skeleton: '#1B1B1F',
    skeletonHighlight: '#26262B',
    shadow: '#000000',
  },
  light: {
    scheme: 'light' as const,
    bg: '#F6F4EF',
    bgSecondary: '#EEEBE4',
    card: '#FFFFFF',
    elevated: '#FFFFFF',
    text: '#111113',
    textSecondary: '#55555E',
    textMuted: '#7A7A84',
    gold: '#9C7A32',
    goldBright: '#B8913F',
    goldDeep: '#7D6024',
    goldSoft: 'rgba(156,122,50,0.12)',
    goldLine: 'rgba(156,122,50,0.35)',
    onGold: '#FFFFFF',
    crush: '#E3335A',
    crushDeep: '#C21F45',
    crushSoft: 'rgba(227,51,90,0.10)',
    onCrush: '#FFFFFF',
    success: '#1D9A6B',
    successSoft: 'rgba(29,154,107,0.12)',
    danger: '#D63843',
    dangerSoft: 'rgba(214,56,67,0.10)',
    border: 'rgba(17,17,19,0.08)',
    borderStrong: 'rgba(17,17,19,0.16)',
    glass: 'rgba(255,255,255,0.86)',
    scrim: 'rgba(17,17,19,0.45)',
    photoScrim: ['rgba(7,7,8,0)', 'rgba(7,7,8,0.5)', 'rgba(7,7,8,0.9)'] as const,
    skeleton: '#E9E6DF',
    skeletonHighlight: '#F3F1EC',
    shadow: '#3A2E18',
  },
};

export type Palette = (typeof palettes)['dark'] | (typeof palettes)['light'];

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 44 } as const;

export const radius = { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999 } as const;

export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_500Medium_Italic',
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extrabold: 'Manrope_800ExtraBold',
} as const;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 38, lineHeight: 44, letterSpacing: -0.6 },
  display: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.4 },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.2 },
  heading: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 25, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.extrabold, fontSize: 11, lineHeight: 14, letterSpacing: 1.4, textTransform: 'uppercase' as const },
  button: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, letterSpacing: 0.1 },
  accent: { fontFamily: fonts.displayItalic, fontSize: 17, lineHeight: 24 },
} as const;

export type TypeVariant = keyof typeof type;

/** Minimum touch target (WCAG / platform guidance). */
export const HIT = 44;

export const motion = {
  fast: 140,
  base: 220,
  slow: 360,
} as const;
