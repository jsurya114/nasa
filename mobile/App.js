import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

// Placeholder. The WebView container, session handling and bridge host arrive in the next pull request.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>NASA Logistics</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#4C2A85", alignItems: "center", justifyContent: "center" },
  title: { color: "#ffffff", fontSize: 24, fontWeight: "600" },
});
