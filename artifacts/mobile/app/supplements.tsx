import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  Switch,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import { useApp } from "@/context/AppContext";
import { useWellness, type SupplementDefinition } from "@/context/WellnessContext";
import { analyseSupplement, createSupplement, type SupplementAnalysis } from "@/utils/api";
import { handleAiError } from "@/utils/aiErrors";

const EVIDENCE_TONE: Record<string, string> = {
  strong: Colors.accentGreen,
  moderate: Colors.primary,
  limited: Colors.accentYellow,
  insufficient: Colors.accentRed,
};

const EVIDENCE_LABEL: Record<string, string> = {
  strong: "Strong evidence",
  moderate: "Moderate evidence",
  limited: "Limited evidence",
  insufficient: "Insufficient evidence",
};

export default function SupplementsScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { state: appState } = useApp();
  const {
    supplements,
    supplementsLoading,
    refreshSupplements,
    logSupplementTaken,
    isSupplementTaken,
    todayAdherence,
  } = useWellness();

  const [addVisible, setAddVisible] = useState(false);
  const [detail, setDetail] = useState<SupplementDefinition | null>(null);

  useEffect(() => {
    void refreshSupplements();
  }, [refreshSupplements]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Supplements", headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {todayAdherence.due > 0 && (
          <View style={[styles.adherence, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.adherenceValue, { color: theme.text }]}>
                {todayAdherence.taken} of {todayAdherence.due}
              </Text>
              <Text style={[styles.adherenceLabel, { color: theme.textMuted }]}>
                taken today
              </Text>
            </View>
            <View style={[styles.adherenceRing, { borderColor: theme.border }]}>
              <Text style={[styles.adherencePct, { color: Colors.primary }]}>
                {Math.round((todayAdherence.taken / todayAdherence.due) * 100)}%
              </Text>
            </View>
          </View>
        )}

        {supplementsLoading && supplements.length === 0 && (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 30 }} />
        )}

        {!supplementsLoading && supplements.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="medkit-outline" size={40} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>Nothing tracked yet</Text>
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
              Add the supplements or medications you take to get reminders and see how they
              relate to your training.
            </Text>
          </View>
        )}

        {supplements.map((item) => {
          const slots = item.times?.length ? item.times : [undefined];
          return (
            <View
              key={item.id}
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
            >
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => setDetail(item)}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.kindIcon,
                    {
                      backgroundColor:
                        item.kind === "medication"
                          ? Colors.accentRed + "20"
                          : Colors.accentGreen + "20",
                    },
                  ]}
                >
                  <Ionicons
                    name={item.kind === "medication" ? "medical-outline" : "nutrition-outline"}
                    size={18}
                    color={item.kind === "medication" ? Colors.accentRed : Colors.accentGreen}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardName, { color: theme.text }]}>{item.name}</Text>
                  <Text style={[styles.cardMeta, { color: theme.textMuted }]}>
                    {[item.dosage, item.withFood ? "with food" : null]
                      .filter(Boolean)
                      .join(" · ") || "No dosage recorded"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </TouchableOpacity>

              <View style={styles.slotRow}>
                {slots.map((slot, index) => {
                  const taken = isSupplementTaken(item.id, slot);
                  return (
                    <TouchableOpacity
                      key={`${item.id}_${slot ?? index}`}
                      style={[
                        styles.slot,
                        {
                          backgroundColor: taken ? Colors.primary : "transparent",
                          borderColor: taken ? Colors.primary : theme.border,
                        },
                      ]}
                      onPress={() => {
                        if (taken) return;
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        logSupplementTaken(item.id, slot);
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={taken ? "checkmark" : "ellipse-outline"}
                        size={14}
                        color={taken ? "#000" : theme.textMuted}
                      />
                      <Text
                        style={[styles.slotText, { color: taken ? "#000" : theme.textSecondary }]}
                      >
                        {slot ?? "Take"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.fab,
          { backgroundColor: Colors.primary, bottom: insets.bottom + 20 },
        ]}
        onPress={() => setAddVisible(true)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={26} color="#000" />
      </TouchableOpacity>

      <AddSupplementModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onSaved={() => {
          setAddVisible(false);
          void refreshSupplements();
        }}
        theme={theme}
      />

      <DetailModal
        supplement={detail}
        onClose={() => setDetail(null)}
        theme={theme}
        isDark={isDark}
        profile={appState.profile}
      />
    </View>
  );
}

function AddSupplementModal({
  visible,
  onClose,
  onSaved,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  theme: any;
}) {
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [kind, setKind] = useState<"supplement" | "medication">("supplement");
  const [times, setTimes] = useState("08:00");
  const [withFood, setWithFood] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createSupplement({
        name: name.trim(),
        kind,
        dosage: dosage.trim() || undefined,
        frequency: "daily",
        times: times
          .split(",")
          .map((t) => t.trim())
          .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)),
        withFood,
      });

      setName("");
      setDosage("");
      setTimes("08:00");
      setWithFood(false);
      onSaved();
    } catch (e) {
      handleAiError(e, "Could not save that entry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Add entry</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.formContent}>
          <View style={styles.kindToggle}>
            {(["supplement", "medication"] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.kindOption,
                  {
                    backgroundColor: kind === option ? Colors.primary : theme.card,
                    borderColor: kind === option ? Colors.primary : theme.border,
                  },
                ]}
                onPress={() => setKind(option)}
              >
                <Text
                  style={[
                    styles.kindOptionText,
                    { color: kind === option ? "#000" : theme.textSecondary },
                  ]}
                >
                  {option === "supplement" ? "Supplement" : "Medication"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Field label="Name" theme={theme}>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Creatine monohydrate"
              placeholderTextColor={theme.textMuted}
            />
          </Field>

          <Field label="Amount" theme={theme}>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              value={dosage}
              onChangeText={setDosage}
              placeholder="e.g. 5 g"
              placeholderTextColor={theme.textMuted}
            />
          </Field>

          <Field label="Reminder times (24h, comma separated)" theme={theme}>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              value={times}
              onChangeText={setTimes}
              placeholder="08:00, 20:00"
              placeholderTextColor={theme.textMuted}
            />
          </Field>

          <View style={[styles.switchRow, { borderColor: theme.border }]}>
            <Text style={[styles.switchLabel, { color: theme.text }]}>Take with food</Text>
            <Switch
              value={withFood}
              onValueChange={setWithFood}
              trackColor={{ true: Colors.primary }}
            />
          </View>

          {kind === "medication" && (
            <View style={[styles.warnBox, { borderColor: Colors.accentYellow + "50" }]}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.accentYellow} />
              <Text style={[styles.warnText, { color: theme.textSecondary }]}>
                Elovia can remind you and explain how a medication relates to training, but it
                does not give medical advice. Always confirm dosing and interactions with your
                doctor or pharmacist.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.saveBtn,
              { backgroundColor: name.trim() ? Colors.primary : theme.border },
            ]}
            onPress={save}
            disabled={!name.trim() || saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function DetailModal({
  supplement,
  onClose,
  theme,
  isDark,
  profile,
}: {
  supplement: SupplementDefinition | null;
  onClose: () => void;
  theme: any;
  isDark: boolean;
  profile: any;
}) {
  const [analysis, setAnalysis] = useState<SupplementAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supplement) {
      setAnalysis(null);
      return;
    }

    // Server caches per substance, so re-opening is free after the first look.
    setLoading(true);
    analyseSupplement(supplement.id, profile)
      .then((r) => setAnalysis(r.analysis))
      .catch((e) => {
        onClose();
        handleAiError(e, "Could not analyse that substance.");
      })
      .finally(() => setLoading(false));
  }, [supplement, profile, onClose]);

  return (
    <Modal
      visible={supplement !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]} numberOfLines={1}>
            {supplement?.name ?? ""}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          {loading && <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />}

          {!loading && analysis && (
            <>
              {analysis.requiresProfessional && (
                <View style={[styles.proBox, { borderColor: Colors.accentYellow + "60" }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={Colors.accentYellow} />
                  <Text style={[styles.proText, { color: theme.text }]}>
                    Talk to a doctor or pharmacist about this one. The information below is
                    general context only.
                  </Text>
                </View>
              )}

              {!analysis.identified ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  This substance could not be identified confidently, so no information is
                  shown. Check the spelling, or ask a pharmacist.
                </Text>
              ) : (
                <>
                  <View
                    style={[
                      styles.evidenceBadge,
                      { backgroundColor: (EVIDENCE_TONE[analysis.evidenceLevel] ?? Colors.primary) + "20" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.evidenceText,
                        { color: EVIDENCE_TONE[analysis.evidenceLevel] ?? Colors.primary },
                      ]}
                    >
                      {EVIDENCE_LABEL[analysis.evidenceLevel] ?? "Evidence unclear"}
                    </Text>
                  </View>

                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    {analysis.summary}
                  </Text>

                  {analysis.evidenceNote ? (
                    <Text style={[styles.note, { color: theme.textMuted }]}>
                      {analysis.evidenceNote}
                    </Text>
                  ) : null}

                  <Section title="Training" items={analysis.trainingEffects} theme={theme} />
                  <Section title="Nutrition" items={analysis.nutritionNotes} theme={theme} />

                  {analysis.timingGuidance ? (
                    <View style={[styles.infoCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                      <Text style={[styles.infoTitle, { color: theme.text }]}>Timing</Text>
                      <Text style={[styles.infoBody, { color: theme.textSecondary }]}>
                        {analysis.timingGuidance}
                      </Text>
                    </View>
                  ) : null}

                  <Section
                    title="Commonly reported effects"
                    items={analysis.commonSideEffects}
                    theme={theme}
                  />
                  <Section title="Worth checking first" items={analysis.cautions} theme={theme} />
                </>
              )}

              <Text style={[styles.disclaimer, { color: theme.textMuted }]}>
                {analysis.disclaimer}
              </Text>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title, items, theme }: { title: string; items: string[]; theme: any }) {
  if (!items?.length) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <View style={[styles.bullet, { backgroundColor: Colors.primary }]} />
          <Text style={[styles.bulletText, { color: theme.textSecondary }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function Field({
  label,
  children,
  theme,
}: {
  label: string;
  children: React.ReactNode;
  theme: any;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },

  adherence: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  adherenceValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  adherenceLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  adherenceRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  adherencePct: { fontSize: 13, fontFamily: "Inter_700Bold" },

  empty: { alignItems: "center", gap: 8, paddingVertical: 50 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 24,
  },

  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  kindIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  slotRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  slot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  slotText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 20,
    paddingTop: 24,
    borderBottomWidth: 1,
  },
  modalTitle: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },

  formContent: { padding: 20, gap: 16 },
  kindToggle: { flexDirection: "row", gap: 8 },
  kindOption: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  kindOptionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular" },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },

  warnBox: { flexDirection: "row", gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  warnText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#000" },

  detailContent: { padding: 20, gap: 14 },
  proBox: { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: 12, padding: 14 },
  proText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19 },

  evidenceBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  evidenceText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, fontStyle: "italic" },

  section: { gap: 7 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  bulletRow: { flexDirection: "row", gap: 9, alignItems: "flex-start" },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  infoCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 5 },
  infoTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  infoBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  disclaimer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
    marginTop: 8,
    textAlign: "center",
  },
});
