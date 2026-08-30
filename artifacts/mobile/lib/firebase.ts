import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { Platform } from "react-native";
import type { Auth, Persistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/**
 * True only when every value the SDK actually needs is present.
 *
 * Env vars are injected at BUILD time, so a profile that forgets them ships an
 * app whose config is entirely undefined. Detecting that explicitly lets the
 * app say so instead of dying on an opaque SDK error.
 */
export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let auth: Auth | null = null;

async function getFirebaseAuth(): Promise<Auth> {
  if (auth) return auth;

  if (Platform.OS === "web") {
    const { getAuth } = await import("firebase/auth");
    auth = getAuth(app);
  } else {
    // getReactNativePersistence exists at runtime in firebase/auth but is not
    // present in the published type definitions for this entry point (it is
    // declared under the react-native subpath). Cast rather than switching
    // import paths, which breaks Metro resolution in this monorepo.
    const authModule = await import("firebase/auth");
    const { initializeAuth } = authModule;
    const { getReactNativePersistence } = authModule as unknown as {
      getReactNativePersistence: (storage: unknown) => Persistence;
    };
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    try {
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch (e: any) {
      if (e?.code === "auth/already-initialized") {
        const { getAuth } = await import("firebase/auth");
        auth = getAuth(app);
      } else {
        throw e;
      }
    }
  }

  return auth;
}

/**
 * Realtime Database handle, created lazily.
 *
 * This used to be `const db = getDatabase(app)` at module scope. With no
 * databaseURL — which is what happens when a build profile omits the env vars —
 * getDatabase throws "Can't determine Firebase Database URL" during module
 * evaluation. Because this file is reached from the root layout, that threw
 * before React mounted, so the app closed instantly with no error screen and
 * nothing in the UI to explain it.
 *
 * Only the legacy Realtime Database migration path needs this now, so it is
 * created on demand and returns null rather than throwing.
 */
let database: ReturnType<typeof getDatabase> | null = null;
let databaseAttempted = false;

function getFirebaseDb(): ReturnType<typeof getDatabase> | null {
  if (databaseAttempted) return database;
  databaseAttempted = true;

  if (!firebaseConfig.databaseURL) return null;

  try {
    database = getDatabase(app);
  } catch {
    database = null;
  }
  return database;
}

export { app, auth, getFirebaseAuth, getFirebaseDb };
