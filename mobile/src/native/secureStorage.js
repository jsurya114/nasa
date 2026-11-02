import * as SecureStore from "expo-secure-store";

// The phone's secure storage (iOS Keychain, Android Keystore). On iOS the value is readable after the first
// unlock and is not copied to other devices or to backups.
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const secureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, options),
};
