/**
 * The holUpp mark, drawn rather than shipped as a bitmap.
 *
 * It used to exist only as PNGs at whatever sizes somebody had exported, which is
 * why the download page once showed a 38×30 version blown up past its pixels and
 * why every new surface needed a new export. One 401×286 piece of geometry can be
 * any size, keeps its edges on a high-density screen, and never needs an asset
 * added to the bundle.
 *
 * Geometry is measured off `assets/brand/holup-mark.png`, not drawn by eye:
 *
 *   soft  centre (116.5, 126)   r 100.5   colors.primary      (#FF8788)
 *   pink  centre (274,   159)   r 110     colors.primaryDeep  (#ED59AF)
 *   hole  centre (216.5, 159.5) r  38.5   colors.bg         (#0B070C)
 *
 * The hole is a filled disc because in the real mark it is ink: it must stay ink
 * on a light background too, so it cannot be punched out of the pink circle.
 *
 * If `react-native-svg` is missing from a build, this returns null instead of
 * throwing — a missing logo is a gap, not a white screen.
 */
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

export function HolupMark({
  size = 40,
  color,
  onDark,
}: {
  /** Width in points. Height follows the mark's own 401:286 ratio. */
  size?: number;
  /** One colour for both circles, for a single-colour impression. */
  color?: string;
  /** Set false on a light surface, where the hole should be light rather than ink. */
  onDark?: boolean;
}) {
  const { colors } = useTheme();
  const height = (size * 286) / 401;
  // The palette's names for these are `primary` and `primaryDeep` (the logo
  // colours, also aliased as `gold`/`goldDeep` for older call sites).
  const soft = color ?? colors.primary;
  const pink = color ?? colors.primaryDeep;
  // The hole is ink in the mark itself, and the only ink the palette has that
  // reads as a hole on both schemes is the surface colour of a dark card.
  const hole = onDark === false ? '#FFF8F8' : colors.bg;

  return (
    <View style={{ width: size, height }} accessible accessibilityRole="image" accessibilityLabel="holUpp">
      <Svg width={size} height={height} viewBox="0 0 401 286">
        <Circle cx={116.5} cy={126} r={100.5} fill={soft} />
        <Circle cx={274} cy={159} r={110} fill={pink} />
        <Circle cx={216.5} cy={159.5} r={38.5} fill={hole} />
      </Svg>
    </View>
  );
}
