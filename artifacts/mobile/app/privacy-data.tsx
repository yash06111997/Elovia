import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/lib/auth";
import {
  deleteMyAccount,
  exportMyData,
  getPublicApiUrl,
  type AccountDataExport,
} from "@/utils/api";
import { trackEvent } from "@/lib/telemetry";

async function shareJson(data: AccountDataExport | Record<string, unknown>) {
  const json = JSON.stringify(data, null, 2);
  if (!FileSystem.cacheDirectory) {
    throw new Error("Temporary file storage is unavailable on this device.");
  }
  const fileUri = `${FileSystem.cacheDirectory}elovia-data-${new Date().toISOString().slice(0, 10)}.json`;
  await FileSystem.writeAsStringAsync(fileUri, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: "application/json",
      dialogTitle: "Export My Elovia Data",
      UTI: "public.json",
    });
    return;
  }

  await Share.share({ title: "My Elovia data", url: fileUri, message: json });
}

export default function PrivacyDataScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, logout } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      if (isAuthenticated) {
        await shareJson(await exportMyData());
      } else {
        const keys = await AsyncStorage.getAllKeys();
        const values = await AsyncStorage.multiGet(keys);
        await shareJson({
          exportedAt: new Date().toISOString(),
          scope: "data stored on this device",
          data: Object.fromEntries(values),
        });
      }
      void trackEvent("account_exported", {
        source: isAuthenticated ? "cloud" : "device",
      });
    } catch (error) {
      Alert.alert(
        "Export failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const permanentlyDelete = async () => {
    setIsDeleting(true);
    try {
      const deletingAccount = isAuthenticated;
      if (deletingAccount) {
        const logoutOutcome = await logout({
          operation: "account_deletion",
          async beforeSignOut() {
            const deletion = await deleteMyAccount();
            if (!deletion.deleted) {
              throw new Error("The server did not confirm account deletion.");
            }
          },
        });
        if (
          logoutOutcome.status !== "signed_out" ||
          logoutOutcome.operation !== "account_deletion"
        ) {
          throw new Error(
            logoutOutcome.status === "blocked"
              ? logoutOutcome.message
              : "Account deletion did not complete. Please try again.",
          );
        }
      }
      void trackEvent("account_deleted", {
        source: deletingAccount ? "account" : "device",
      });
      await AsyncStorage.clear();
      Alert.alert(
        "Account deleted",
        "Your Elovia account and app data have been deleted.",
      );
      router.replace("/onboarding");
    } catch (error) {
      Alert.alert(
        "Deletion failed",
        error instanceof Error
          ? error.message
          : "Your account was not deleted. Please try again.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      isAuthenticated ? "Delete My Account?" : "Delete data on this device?",
      isAuthenticated
        ? "This permanently removes your Elovia account, synced fitness and health data, social activity, coaching records and local app data. App-store subscriptions must be cancelled separately."
        : "This permanently removes all Elovia data stored on this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () =>
            Alert.alert(
              "This cannot be undone",
              "Are you absolutely sure you want to permanently delete this data?",
              [
                { text: "Keep My Data", style: "cancel" },
                {
                  text: "Permanently Delete",
                  style: "destructive",
                  onPress: permanentlyDelete,
                },
              ],
            ),
        },
      ],
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 32 },
      ]}
    >
      <View
        style={[
          styles.hero,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View style={styles.heroIcon}>
          <Ionicons name="shield-checkmark" size={28} color={Colors.primary} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>
          Privacy &amp; Data
        </Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Control what Elovia stores and understand how your fitness and health
          information is used.
        </Text>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.cardTitle, { color: theme.text }]}>
          Privacy Notice
        </Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Elovia uses account, profile, workout, nutrition, health-source,
          location, subscription and deliberately shared social data to provide
          the features you request. Health connections are optional. Elovia does
          not sell health data.
        </Text>
        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel="Read the full Privacy Notice"
          style={styles.linkRow}
          onPress={() => Linking.openURL(getPublicApiUrl("/api/legal/privacy"))}
        >
          <Text style={styles.link}>Read the full Privacy Notice</Text>
          <Ionicons name="open-outline" size={16} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.cardTitle, { color: theme.text }]}>
          Terms of Use
        </Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Elovia provides general fitness and nutrition guidance, not medical
          diagnosis or treatment. Paid subscriptions are managed through your
          app store.
        </Text>
        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel="Read the full Terms of Use"
          style={styles.linkRow}
          onPress={() => Linking.openURL(getPublicApiUrl("/api/legal/terms"))}
        >
          <Text style={styles.link}>Read the full Terms of Use</Text>
          <Ionicons name="open-outline" size={16} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Export My Data"
        style={[styles.action, { backgroundColor: Colors.primary }]}
        onPress={handleExport}
        disabled={isExporting || isDeleting}
      >
        {isExporting ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Ionicons name="download-outline" size={20} color="#000" />
        )}
        <Text style={styles.actionText}>Export My Data</Text>
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Delete My Account"
        style={[styles.action, styles.dangerAction]}
        onPress={handleDelete}
        disabled={isDeleting || isExporting}
      >
        {isDeleting ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Ionicons name="trash-outline" size={20} color="#FFF" />
        )}
        <Text style={[styles.actionText, { color: "#FFF" }]}>
          Delete My Account
        </Text>
      </TouchableOpacity>
      <Text style={[styles.footnote, { color: theme.textMuted }]}>
        Deleting Elovia does not cancel a subscription billed by Apple or
        Google. Cancel it separately in your app-store settings.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 14 },
  hero: { borderWidth: 1, borderRadius: 20, padding: 22, alignItems: "center" },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.primary + "20",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 16, padding: 18 },
  cardTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 8 },
  body: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
    textAlign: "left",
  },
  linkRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 10,
  },
  link: {
    color: Colors.primary,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  action: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  dangerAction: { backgroundColor: Colors.accentRed },
  actionText: { color: "#000", fontSize: 16, fontFamily: "Inter_700Bold" },
  footnote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 8,
  },
});
