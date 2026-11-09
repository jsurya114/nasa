import { Pressable, StyleSheet, Text, View } from "react-native";

const MESSAGES = {
  offline: "No connection. What you typed is kept.",
  server: "NASA is not responding. What you typed is kept.",
};

// A slim bar over the page after a connection problem that happens once the page has loaded. The page underneath
// stays mounted, so nothing the person typed is lost. Nothing is saved or queued while the bar shows.
export default function ConnectionBanner({ kind, onRetry }) {
  return (
    <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.text}>{MESSAGES[kind] ?? MESSAGES.offline}</Text>
      <Pressable onPress={onRetry} style={styles.button} accessibilityRole="button" accessibilityLabel="Try again">
        <Text style={styles.buttonText}>Try again</Text>
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
