import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";

import { createBridgeHost } from "./src/bridge/host";
import { eventScript, isHttpsUrl, isTrustedOrigin, replyScript } from "./src/bridge/protocol";
import { API_ORIGIN, APP_ENV, APP_VERSION, PUSH_PROJECT_ID, WEB_ORIGIN } from "./src/config";
import { request } from "./src/native/api";
import { secureStorage } from "./src/native/secureStorage";
import ConnectionBanner from "./src/screens/ConnectionBanner";
import ErrorScreen from "./src/screens/ErrorScreen";
import { createPush } from "./src/push";
import { createSession } from "./src/session";

const BRAND = "#4C2A85";
const NONCE_BYTES = 16;

// A new random secret for each page load. The shell injects it into the main frame only and refuses any bridge
// message that does not carry it, so a frame from another site cannot use the bridge.
const newNonce = () => Array.from(Crypto.getRandomBytes(NONCE_BYTES), (b) => b.toString(16).padStart(2, "0")).join("");
const SERVER_ERROR_STATUS = 500;

// A notification that arrives while the app is open still shows as a banner, without sound or badge
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

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
  // Once the web app has loaded, a connection problem shows a bar over it instead of replacing it, so a form
  // the person is filling in is not lost
  const [hasLoaded, setHasLoaded] = useState(false);

  const session = useMemo(() => createSession({ storage: secureStorage, request }), []);
  const push = useMemo(
    () =>
      createPush({
        notifications: Notifications,
        isDevice: Device.isDevice,
        projectId: PUSH_PROJECT_ID,
        platform: Platform.OS,
        openSettings: () => Linking.openSettings(),
      }),
    []
  );
  const nonce = useMemo(() => newNonce(), [attempt]);
  const host = useMemo(
    () =>
      createBridgeHost({
        info: { shellVersion: APP_VERSION, platform: Platform.OS },
        session,
        openExternal: openOutside,
        webOrigin: WEB_ORIGIN,
        nonce,
        push,
      }),
    [session, nonce, push]
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

  // A tapped notification names a screen from a fixed list. The shell keeps it and nudges the page, which collects it
  // through the checked bridge. A tap that opened the app from closed is collected by the page when it starts.
  useEffect(() => {
    const handleTap = (response) => {
      if (push.recordTap(response)) webViewRef.current?.injectJavaScript(eventScript("notification.tap"));
    };
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          push.recordTap(response);
          Notifications.clearLastNotificationResponse();
        }
      })
      .catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(handleTap);
    return () => subscription.remove();
  }, [push]);

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
    if (hasLoaded) webViewRef.current?.reload();
    else setAttempt((n) => n + 1);
  }, [hasLoaded]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" backgroundColor={BRAND} />
      {failure && !hasLoaded ? (
        <ErrorScreen kind={failure} onRetry={retry} />
      ) : (
        <>
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
          onLoad={() => {
            setHasLoaded(true);
            setFailure(null);
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
          mediaCapturePermissionGrantType="deny"
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          contentInsetAdjustmentBehavior="never"
          webviewDebuggingEnabled={APP_ENV === "development"}
        />
        {failure ? <ConnectionBanner kind={failure} onRetry={retry} /> : null}
        </>
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
