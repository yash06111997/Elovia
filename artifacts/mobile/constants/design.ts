import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * Design tokens.
 *
 * Every screen previously hardcoded its own font sizes, paddings, and radii,
 * which is why the app reads as "almost consistent" - the values are close but
 * never quite the same. These tokens make the rhythm explicit.
 *
 * Brand colour stays #00D4FF: it is already established across the app icon,
 * splash screen, and store listing, and changing it would be churn rather than
 * craft.
 */

/** 4pt base scale (Material / Apple both build on this). */
export const Space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

/** One radius scale, so cards, sheets, and buttons agree. */
export const Radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 24,
  pill: 999,
} as const;

/**
 * Type scale.
 *
 * Body sits at 15-16px: below 16 iOS auto-zooms text inputs, and below 14
 * readability drops sharply for body copy on a phone held at arm's length.
 */
export const Type = {
  display: { fontSize: 40, lineHeight: 44, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  title1: { fontSize: 28, lineHeight: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  title2: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  title3: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_600SemiBold" },
  headline: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
  callout: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  subhead: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  footnote: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  caption: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium" },
  overline: {
    fontSize: 10,
    lineHeight: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
} as const satisfies Record<string, TextStyle>;

/**
 * Tabular figures.
 *
 * Essential for anything that counts: a run timer, a rep counter, a calorie
 * total. Without it, proportional digits have different widths and the number
 * visibly jitters as it ticks.
 */
export const tabularNumbers: TextStyle = {
  fontVariant: ["tabular-nums"],
};

/**
 * Motion tokens.
 *
 * One rhythm across the whole app. Exits run shorter than entrances because a
 * slow dismissal feels unresponsive, while a slow entrance feels considered.
 */
export const Motion = {
  instant: 100,
  fast: 150,
  normal: 220,
  slow: 320,
  /** Exit at ~65% of enter duration. */
  exit: 140,
  /** Per-item delay when staggering a list. */
  stagger: 40,
  spring: { damping: 18, stiffness: 220, mass: 0.9 },
  springBouncy: { damping: 12, stiffness: 260, mass: 0.8 },
} as const;

/** Scale applied while a card or button is held. */
export const PRESS_SCALE = 0.97;

/**
 * Elevation.
 *
 * Android reads `elevation`; iOS reads the shadow properties. Both are set so
 * a card looks the same on either platform.
 */
export function elevation(level: 0 | 1 | 2 | 3): ViewStyle {
  if (level === 0) return {};

  const config = {
    1: { opacity: 0.08, radius: 6, offset: 2, elevation: 2 },
    2: { opacity: 0.12, radius: 14, offset: 5, elevation: 5 },
    3: { opacity: 0.18, radius: 26, offset: 10, elevation: 10 },
  }[level];

  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#000",
      shadowOpacity: config.opacity,
      shadowRadius: config.radius,
      shadowOffset: { width: 0, height: config.offset },
    },
    android: { elevation: config.elevation },
    default: {
      shadowColor: "#000",
      shadowOpacity: config.opacity,
      shadowRadius: config.radius,
      shadowOffset: { width: 0, height: config.offset },
    },
  })!;
}

/**
 * Minimum touch target.
 *
 * 44pt is Apple's floor, 48dp is Material's. Taking the larger keeps one
 * number and satisfies both.
 */
export const MIN_TOUCH = 48;

/** Standard hitSlop for small icon buttons that cannot be physically larger. */
export const iconHitSlop = { top: 12, bottom: 12, left: 12, right: 12 };

/** Opacity for disabled controls (Material specifies 0.38). */
export const DISABLED_OPACITY = 0.38;

/**
 * Semantic colour roles.
 *
 * Screens should reference a ROLE rather than a raw hex, so a future palette
 * change is one edit instead of a hundred.
 */
export const Semantic = {
  success: "#00E676",
  warning: "#FFD600",
  danger: "#FF3D71",
  info: "#00D4FF",

  /**
   * User-authored content, as opposed to AI-generated.
   *
   * Diet screens distinguish a plan the user built from one the model wrote,
   * and that distinction was previously carried by a hardcoded violet
   * (#A78BFA) appearing thirteen times with no token behind it. The role is
   * real and worth keeping; the violet was not - it sat outside the palette
   * and read as the stock "AI app" accent.
   *
   * Paired against `Colors.accent` (#FF6B35, the AI path). The two differ in
   * lightness as well as hue, so they stay separable for the ~8% of men with
   * red-green colour deficiency, who cannot rely on hue alone.
   */
  manual: "#66E5FF",
  /** Macro colours, kept stable so charts stay legible across screens. */
  protein: "#00D4FF",
  carbs: "#FF6B35",
  fats: "#00E676",
  calories: "#FFD600",
  water: "#00A3FF",
} as const;
