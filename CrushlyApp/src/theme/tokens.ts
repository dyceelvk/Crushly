/**
 * Holup design tokens.
 *
 * Dark and light share the official Holup palette: deep plum surfaces, coral
 * and pink accents, and an off-white reading colour. Components
 * read the active palette from `useTheme()` so transitions never reveal a
 * mismatched page behind them.
 */

export const palettes = {
  dark: {
    scheme: 'dark' as const,
    bg: '#2A0F2B',
    bgSecondary: '#35143A',
    card: '#35143A',
    elevated: '#461A48',
    text: '#FFF8F8',
    textSecondary: '#E0CBD4',
    textMuted: '#AD8D9D',
    primary: '#FF8788',
    primaryDeep: '#ED59AF',
    primarySoft: 'rgba(255,135,136,0.16)',
    primaryLine: 'rgba(255,135,136,0.40)',
    onPrimary: '#2A0F2B',
    // Backward-compatible aliases — all existing `colors.gold` references now use the logo palette
    gold: '#FF8788',
    goldBright: '#FF8788',
    goldDeep: '#ED59AF',
    goldSoft: 'rgba(255,135,136,0.16)',
    goldLine: 'rgba(255,135,136,0.40)',
    onGold: '#2A0F2B',
    cyan: '#FF8788',
    cyanDeep: '#E56F78',
    purple: '#B76EEA',
    magenta: '#ED59AF',
    crush: '#ED59AF',
    crushDeep: '#C93D8A',
    crushSoft: 'rgba(237,89,175,0.16)',
    crushLine: 'rgba(237,89,175,0.42)',
    onCrush: '#2A0F2B',
    success: '#4CD7A0',
    successSoft: 'rgba(76,215,160,0.14)',
    danger: '#FF5C67',
    dangerSoft: 'rgba(255,92,103,0.14)',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.16)',
    glass: 'rgba(42,15,43,0.82)',
    scrim: 'rgba(24,8,28,0.66)',
    photoScrim: ['rgba(42,15,43,0)', 'rgba(42,15,43,0.55)', 'rgba(42,15,43,0.94)'] as const,
    skeleton: '#421A45',
    skeletonHighlight: '#572259',
    shadow: '#18081C',
  },
  light: {
    scheme: 'light' as const,
    bg: '#FFF8F8',
    bgSecondary: '#FCEFF1',
    card: '#FFF8F8',
    elevated: '#F8E5EA',
    text: '#2A0F2B',
    textSecondary: '#60435D',
    textMuted: '#8D7180',
    primary: '#FF8788',
    primaryDeep: '#ED59AF',
    primarySoft: 'rgba(255,135,136,0.13)',
    primaryLine: 'rgba(255,135,136,0.38)',
    onPrimary: '#2A0F2B',
    // Backward-compatible aliases — all existing `colors.gold` references now use the logo palette
    gold: '#FF8788',
    goldBright: '#FF8788',
    goldDeep: '#ED59AF',
    goldSoft: 'rgba(255,135,136,0.13)',
    goldLine: 'rgba(255,135,136,0.38)',
    onGold: '#2A0F2B',
    cyan: '#FF8788',
    cyanDeep: '#E56F78',
    purple: '#B76EEA',
    magenta: '#ED59AF',
    crush: '#ED59AF',
    crushDeep: '#C93D8A',
    crushSoft: 'rgba(237,89,175,0.12)',
    crushLine: 'rgba(237,89,175,0.38)',
    onCrush: '#2A0F2B',
    success: '#227B63',
    successSoft: 'rgba(34,123,99,0.12)',
    danger: '#C13E64',
    dangerSoft: 'rgba(193,62,100,0.10)',
    border: 'rgba(42,15,43,0.10)',
    borderStrong: 'rgba(42,15,43,0.18)',
    glass: 'rgba(255,248,248,0.90)',
    scrim: 'rgba(42,15,43,0.45)',
    photoScrim: ['rgba(42,15,43,0)', 'rgba(42,15,43,0.50)', 'rgba(42,15,43,0.90)'] as const,
    skeleton: '#F1DDE4',
    skeletonHighlight: '#FAEEF1',
    shadow: '#2A0F2B',
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

/**
 * The type scale, at 85%.
 *
 * Every size here was a step larger than the screen wanted: a Flow's body sat at
 * 15/22 and most of the screens were read at arm's length on a phone, so a post
 * filled the display and a Space ran out of room before its own tabs. The whole
 * scale is scaled by the same 0.85 rather than retuned a size at a time, because
 * the problem was the scale, not any one step — the relationships between hero,
 * display and body are the design, and they survive a multiplier.
 *
 * Line heights move with the sizes so the vertical rhythm keeps its proportions.
 */
export const type = {
  hero: { fontFamily: fonts.display, fontSize: 32, lineHeight: 37, letterSpacing: -0.5 },
  display: { fontFamily: fonts.display, fontSize: 27, lineHeight: 32, letterSpacing: -0.3 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, letterSpacing: -0.2 },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 19 },
  body: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  bodyStrong: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 19 },
  small: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15 },
  smallStrong: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15 },
  caption: { fontFamily: fonts.semibold, fontSize: 10, lineHeight: 14 },
  label: { fontFamily: fonts.extrabold, fontSize: 9.5, lineHeight: 12, letterSpacing: 1.2, textTransform: 'uppercase' as const },
  button: { fontFamily: fonts.bold, fontSize: 13.5, lineHeight: 17, letterSpacing: 0.1 },
  accent: { fontFamily: fonts.displayItalic, fontSize: 14.5, lineHeight: 20 },
} as const;

/**
 * Numbers that sit under each other — counts in a rail, timers, prices — need
 * tabular figures or they jitter as the value changes. It is a real variant, so
 * `variant="numeric"` works anywhere text does; kept separate from `caption` so
 * callers have to ask for it deliberately.
 */
export type TypeVariant = keyof typeof type | 'numeric';

/** Same shape as a `type` entry, with tabular figures. */
export const numeric = {
  fontFamily: fonts.semibold,
  fontSize: 12,
  lineHeight: 16,
  fontVariant: ['tabular-nums'] as const,
} as const;

/** Minimum touch target (WCAG / platform guidance). */
export const HIT = 44;

/* ---------------------------------------------------------------------------
 * Elevation
 *
 * The palette already answers "what colour is a surface" (bg, card, elevated).
 * It never answered "how far off the page is this thing", so shadows were being
 * invented screen by screen — some 0.2 opacity, some 0.5, most skipping Android
 * entirely because a `shadowColor` alone does nothing there.
 *
 * Four levels, and that is the whole vocabulary. `none` exists so a caller can
 * say "on the page" explicitly instead of passing undefined and hoping.
 * ------------------------------------------------------------------------- */

export const elevation = {
  none: {},
  /** Cards resting on the page. Barely there on purpose. */
  soft: {
    shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  /** Raised chrome: sticky headers, floating rails, the compose bar. */
  raised: {
    shadowColor: '#000000', shadowOpacity: 0.26, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  /** Things that float over content and want to be unmistakably above it. */
  float: {
    shadowColor: '#000000', shadowOpacity: 0.38, shadowRadius: 32, shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  /** Sheets and dialogs. The heaviest thing in the product. */
  sheet: {
    shadowColor: '#000000', shadowOpacity: 0.5, shadowRadius: 48, shadowOffset: { width: 0, height: -8 },
    elevation: 20,
  },
} as const;

/** Border widths, so a hairline is never a guess between 0.5 and 1. */
export const stroke = { hairline: 1, thick: 1.5 } as const;

/**
 * The vertical rhythm of a screen.
 *
 * `space` answers "how far apart are these two things". This answers "how far
 * apart are these two groups of things", which is the question that actually
 * makes a layout look deliberate rather than evenly spaced everywhere.
 */
export const rhythm = {
  /** Inside a group: a label and its field. */
  tight: space.xs,
  /** Between related groups. */
  group: space.md,
  /** Between sections of a screen. */
  section: space.xxl,
  /** Between the page and the first thing on it. */
  page: space.xl,
} as const;

/** Opacity steps, so a scrim is the same scrim everywhere. */
export const alpha = {
  disabled: 0.42,
  muted: 0.64,
  veil: 0.82,
  solid: 1,
} as const;

export const motion = {
  fast: 140,
  base: 220,
  slow: 360,
} as const;
