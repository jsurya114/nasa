import { Pressable, StyleSheet, Text, View } from "react-native";

const MESSAGES = {
  offline: "No connection. Nothing new is saved until it is back.",
  server: "NASA is not responding. Nothing new is saved until it answers.",
};

// A slim bar over the page after a connection problem that happens once the page has loaded. The page underneath
// stays as it is. Reload starts the page again: only forms that keep a draft (the journey form) come back filled in,
// so the button says so instead of promising that everything typed survives. Nothing is saved or queued here.
export default function ConnectionBanner({ kind, onRetry }) {
  return (
    <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.text}>{MESSAGES[kind] ?? MESSAGES.offline}</Text>
      <Pressable onPress={onRetry} style={styles.button} accessibilityRole="button" accessibilityLabel="Reload page"
        accessibilityHint="Unsaved changes on this page may be lost">
        <Text style={styles.buttonText}>Reload</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1f1530",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  text: { flex: 1, color: "#ffffff", fontSize: 14 },
  button: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#4C2A85" },
  buttonText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
});
