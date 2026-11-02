import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";

import { createBridgeHost } from "./src/bridge/host";
import { isHttpsUrl, isTrustedOrigin, replyScript } from "./src/bridge/protocol";
import { API_ORIGIN, APP_ENV, APP_VERSION, WEB_ORIGIN } from "./src/config";
import { request } from "./src/native/api";
import { secureStorage } from "./src/native/secureStorage";
import ErrorScreen from "./src/screens/ErrorScreen";
import { createSession } from "./src/session";

const BRAND = "#4C2A85";
const NONCE_BYTES = 16;

// A new random secret for each page load. The shell injects it into the main frame only and refuses any bridge
// message that does not carry it, so a frame from another site cannot use the bridge.
const newNonce = () => Array.from(Crypto.getRandomBytes(NONCE_BYTES), (b) => b.toString(16).padStart(2, "0")).join("");
const SERVER_ERROR_STATUS = 500;

// Links the shell may hand to the phone: web pages, mail and phone numbers. Everything else is dropped.
const openOutside = async (url) => {
  if (isHttpsUrl(url) || /^(mailto|tel):/i.test(url)) await Linking.openURL(url);
};

function Shell() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef(null);
  const canGoBack = useRef(false);
  const [failure, setFailure] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const session = useMemo(() => createSession({ storage: secureStorage, request }), []);
  const nonce = useMemo(() => newNonce(), [attempt]);
  const host = useMemo(
    () =>
      createBridgeHost({
        info: { shellVersion: APP_VERSION, platform: Platform.OS },
        session,
        openExternal: openOutside,
        webOrigin: WEB_ORIGIN,
        nonce,
      }),
    [session, nonce]
  );

  // Android Back goes back inside the web app first, and leaves the app only when there is nothing to go back to
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      webViewRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const onMessage = useCallback(
    async (event) => {
      const reply = await host(event.nativeEvent.data, event.nativeEvent.url);
      if (reply) webViewRef.current?.injectJavaScript(replyScript(reply));
    },
    [host]
  );

  // Only the NASA web app may load inside the app. Frames from anywhere else are blocked, so no outside page can
  // ever sit next to the bridge. A link the person taps to another site opens outside the app.
  const onShouldStartLoadWithRequest = useCallback((req) => {
    if (isTrustedOrigin(req.url, WEB_ORIGIN)) return true;
    if (req.isTopFrame !== false) openOutside(req.url).catch(() => {});
    return false;
  }, []);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" backgroundColor={BRAND} />
      {failure ? (
        <ErrorScreen kind={failure} onRetry={retry} />
      ) : (
        <WebView
          key={attempt}
          ref={webViewRef}
          source={{ uri: WEB_ORIGIN }}
          style={styles.web}
          originWhitelist={[WEB_ORIGIN]}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onMessage={onMessage}
          onNavigationStateChange={(nav) => {
            canGoBack.current = nav.canGoBack;
          }}
          onError={() => setFailure("offline")}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode >= SERVER_ERROR_STATUS) setFailure("server");
          }}
          onRenderProcessGone={() => webViewRef.current?.reload()}
          onContentProcessDidTerminate={() => webViewRef.current?.reload()}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color="#ffffff" size="large" accessibilityLabel="Loading" />
            </View>
          )}
          injectedJavaScriptBeforeContentLoaded={`window.__NASA_BRIDGE_NONCE__ = ${JSON.stringify(nonce)}; true;`}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          injectedJavaScriptForMainFrameOnly
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          contentInsetAdjustmentBehavior="never"
          webviewDebuggingEnabled={APP_ENV === "development"}
        />
      )}
    </View>
  );
}

export default function App() {
  if (!WEB_ORIGIN || !API_ORIGIN) throw new Error("NASA_WEB_ORIGIN and NASA_API_ORIGIN must be set for this build");
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND },
  web: { flex: 1, backgroundColor: "#ffffff" },
  loading: { ...StyleSheet.absoluteFillObject, backgroundColor: BRAND, alignItems: "center", justifyContent: "center" },
});
