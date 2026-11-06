import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { readEvent, shouldLoad } from "./policy";

const BRAND = "#4C2A85";

// Everee's own screens in a window of their own (issue #242). This WebView is deliberately NOT the NASA one: no bridge, no nonce, no session token, no
// injected script, and it can only show Everee addresses. It reports back how it ended: "finished" (Everee said so, or the person closed it), "error".
// Android Back and the Close button both close it. The link is single-use and is never logged or kept: it lives in `uri` only while the window is open.
export default function EvereeModal({ uri, onEnd }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={Boolean(uri)} animationType="slide" onRequestClose={() => onEnd("closed")} presentationStyle="fullScreen">
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <Text style={styles.title} accessibilityRole="header">Everee</Text>
          <Pressable onPress={() => onEnd("closed")} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        {uri ? (
          <WebView
            source={{ uri }}
            style={styles.web}
            originWhitelist={["https://*"]}
            onShouldStartLoadWithRequest={(req) => shouldLoad(req.url)}
            onMessage={(event) => {
              const meaning = readEvent(event.nativeEvent.data);
              if (meaning === "finished") onEnd("finished");
              else if (meaning === "error") onEnd("error");
            }}
            onError={() => onEnd("error")}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color={BRAND} size="large" accessibilityLabel="Loading" />
              </View>
            )}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode="never"
            mediaCapturePermissionGrantType="deny"
            thirdPartyCookiesEnabled={false}
            sharedCookiesEnabled={false}
            incognito
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: BRAND, paddingHorizontal: 16, minHeight: 52 },
  title: { color: "#ffffff", fontSize: 17, fontWeight: "700" },
  close: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  web: { flex: 1, backgroundColor: "#ffffff" },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
});
