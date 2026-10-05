import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors } from "@/constants/colors";
import { AppleSignInButton } from "@/components/AppleSignInButton";
import { useAuth } from "@/lib/auth";

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    authError,
    isAuthenticated,
    isLoading,
    login,
    loginWithApple,
  } = useAuth();
  const [signingInProvider, setSigningInProvider] = useState<
    "apple" | "google" | null
  >(null);
  const mounted = useRef(true);
  const attempt = useRef(0);
  const signInInFlight = useRef(false);
  const redirected = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current += 1;
      signInInFlight.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || redirected.current) return;
    redirected.current = true;
    router.replace("/(tabs)");
  }, [isAuthenticated, router]);

  const handleLogin = useCallback(
    async (provider: "apple" | "google") => {
      if (signInInFlight.current || signingInProvider || isAuthenticated)
        return;
      signInInFlight.current = true;
      const currentAttempt = attempt.current + 1;
      attempt.current = currentAttempt;
      setSigningInProvider(provider);
      try {
        await (provider === "apple" ? loginWithApple() : login());
      } finally {
        if (mounted.current && attempt.current === currentAttempt) {
          signInInFlight.current = false;
          setSigningInProvider(null);
        }
      }
    },
    [isAuthenticated, login, loginWithApple, signingInProvider],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  const busy = isLoading || signingInProvider !== null;

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        disabled={busy}
        hitSlop={8}
        onPress={handleBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Ionicons name="arrow-back" color={Colors.dark.text} size={22} />
      </Pressable>

      <View style={styles.content}>
        <View
          accessibilityRole="image"
          accessibilityLabel="Elovia"
          style={styles.mark}
        >
          <Text style={styles.markText}>E</Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          Welcome back to Elovia
        </Text>
        <Text style={styles.explanation}>
          Sign in to securely reconnect your training, nutrition, progress, and
          preferences across your devices.
        </Text>

        {authError ? (
          <View accessibilityLiveRegion="polite" style={styles.errorCard}>
            <Ionicons name="alert-circle" color={Colors.accentRed} size={20} />
            <Text accessibilityRole="alert" style={styles.errorText}>
              {authError}
            </Text>
          </View>
        ) : null}

        <View style={styles.providerStack}>
          <AppleSignInButton
            disabled={busy}
            onPress={() => void handleLogin("apple")}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={() => void handleLogin("google")}
            style={({ pressed }) => [
              styles.googleButton,
              busy && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {signingInProvider === "google" ? (
              <ActivityIndicator color={Colors.dark.background} />
            ) : (
              <View style={styles.googleGlyph}>
                <Text style={styles.googleGlyphText}>G</Text>
              </View>
            )}
            <Text style={styles.googleButtonText}>
              {signingInProvider === "google"
                ? "Connecting securely…"
                : "Continue with Google"}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.privacyNote}>
          Elovia uses the account provider you choose only to verify your
          identity. Your health and fitness data is never shared with Apple or
          Google.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    backgroundColor: Colors.dark.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  markText: {
    color: Colors.dark.background,
    fontFamily: "Inter_700Bold",
    fontSize: 36,
  },
  title: {
    color: Colors.dark.text,
    fontFamily: "Inter_700Bold",
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    textAlign: "center",
    marginTop: 28,
  },
  explanation: {
    color: Colors.dark.textMuted,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    marginTop: 12,
    maxWidth: 380,
  },
  errorCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#5C2538",
    backgroundColor: "#24141C",
    marginTop: 24,
  },
  errorText: {
    flex: 1,
    color: "#FF9DB7",
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
  },
  googleButton: {
    minHeight: 56,
    width: "100%",
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 20,
    backgroundColor: Colors.primary,
  },
  providerStack: {
    width: "100%",
    gap: 12,
    marginTop: 24,
  },
  googleGlyph: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  googleGlyphText: {
    color: "#1A73E8",
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
  googleButtonText: {
    color: Colors.dark.background,
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  privacyNote: {
    color: Colors.dark.textSecondary,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 360,
    marginTop: 18,
  },
  disabled: { opacity: 0.62 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});
