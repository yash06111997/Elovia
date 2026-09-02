/**
 * The palette.
 *
 * Dark-only by design - see hooks/useTheme.ts for why. There is deliberately
 * no `light` block: a second scheme that twenty screens silently ignored was
 * worse than no second scheme.
 *
 * Screens must reference these roles rather than raw hex. A literal in a screen
 * is how the app drifted into being "almost consistent" - values close to each
 * other but never quite the same.
 */
export const Colors = {
  primary: "#00D4FF",
  primaryDark: "#0099CC",
  primaryLight: "#66E5FF",
  accent: "#FF6B35",
  accentGreen: "#00E676",
  accentYellow: "#FFD600",
  accentRed: "#FF3D71",
  accentAi: "#A78BFA",

  dark: {
    background: "#0A0A0F",
    surface: "#13131A",
    card: "#1A1A24",
    cardElevated: "#222230",
    border: "#2A2A3A",
    text: "#FFFFFF",
    textSecondary: "#8A8A9E",
    textMuted: "#9B9BAF",
    tabBar: "#0D0D15",
    tabBarBorder: "#1E1E2E",
  },

};

export default Colors;
