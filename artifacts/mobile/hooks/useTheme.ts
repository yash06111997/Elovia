import { Colors } from "@/constants/colors";

/**
 * The app's colour scheme.
 *
 * Elovia is dark-only, deliberately. Training apps are used in gyms, at dawn,
 * and outdoors at night, and the category (Strava, Whoop, Nike Run Club) is
 * dark-first for that reason. Supporting both schemes also doubled the design
 * and QA cost of every screen while being honoured inconsistently: twenty
 * screens hardcoded `#1A1A24` and `#0A0A0F`, so flipping to light rendered
 * dark panels on a light ground. Removing the second scheme removed that whole
 * class of bug rather than chasing each instance.
 *
 * The shape of the return value is preserved so the 200+ call sites reading
 * `theme` or `isDark` need no edit, and so reinstating a light scheme later is
 * a change here rather than another app-wide audit.
 */
export function useTheme() {
  return { isDark: true as const, theme: Colors.dark, colorScheme: "dark" as const };
}
