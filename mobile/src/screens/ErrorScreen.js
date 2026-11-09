import { Pressable, StyleSheet, Text, View } from "react-native";

const MESSAGES = {
  offline: { title: "No connection", body: "NASA needs an internet connection. Check your signal and try again." },
  server: { title: "Server unavailable", body: "NASA could not be reached right now. Please try again in a moment." },
};

// Shown instead of the web app when it cannot load. Nothing is saved or queued while it is showing.
export default function ErrorScreen({ kind, onRetry }) {
  const { title, body } = MESSAGES[kind] ?? MESSAGES.offline;
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again">
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", padding: 32 },
  title: { fontSize: 22, fontWeight: "600", color: "#1f1530", marginBottom: 8, textAlign: "center" },
  body: { fontSize: 16, color: "#5b516b", textAlign: "center", marginBottom: 24 },
  button: { minHeight: 48, minWidth: 160, borderRadius: 12, backgroundColor: "#4C2A85", alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
