import { useContext } from "react";
import { useColorScheme } from "react-native";
import { Colors } from "@/constants/colors";
import { AppContext } from "@/context/AppContext";

export function useTheme() {
  const ctx = useContext(AppContext);
  const systemScheme = useColorScheme();
  const scheme = ctx?.state?.colorScheme || systemScheme || "dark";
  const isDark = scheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  return { isDark, theme, colorScheme: scheme };
}
