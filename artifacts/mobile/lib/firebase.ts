import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { Platform } from "react-native";
import type { Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let auth: Auth | null = null;

async function getFirebaseAuth(): Promise<Auth> {
  if (auth) return auth;

  if (Platform.OS === "web") {
    const { getAuth } = await import("firebase/auth");
    auth = getAuth(app);
  } else {
    const { initializeAuth, getReactNativePersistence } = await import("firebase/auth");
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

const db = getDatabase(app);

export { app, auth, db, getFirebaseAuth };
