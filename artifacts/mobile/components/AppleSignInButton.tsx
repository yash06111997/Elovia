import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";

interface AppleSignInButtonProps {
  onPress: () => void;
  disabled?: boolean;
  marginTop?: number;
}

/** Apple's required native button, rendered only after capability detection. */
export function AppleSignInButton({
  onPress,
  disabled = false,
  marginTop = 0,
}: AppleSignInButtonProps) {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (Platform.OS !== "ios") return () => undefined;

    void AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (mounted) setIsAvailable(available);
      })
      .catch(() => {
        if (mounted) setIsAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!isAvailable) return null;

  return (
    <View
      pointerEvents={disabled ? "none" : "auto"}
      style={[styles.wrapper, { marginTop }, disabled && styles.disabled]}
    >
      <AppleAuthentication.AppleAuthenticationButton
        accessibilityLabel="Continue with Apple"
        accessibilityState={{ disabled }}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        cornerRadius={16}
        onPress={onPress}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
  },
  button: {
    width: "100%",
    height: 56,
  },
  disabled: {
    opacity: 0.62,
  },
});
