import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { Platform, Alert } from "react-native";
import {
  GoogleAuthProvider,
  signInWithCredential,
  onAuthStateChanged,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import { getFirebaseAuth } from "./firebase";
import {
  getAccountStorageScopeKey,
  setAccountStorageAuthScope,
} from "./accountSyncStorage";
import { unregisterFromPush } from "./push";
import { cancelAllReminders } from "./notifications";
import { stopAllGeofences } from "./geofence";

function generateUUID(): string {
  return Crypto.randomUUID();
}

async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  authError: null,
  login: async () => {},
  logout: async () => {},
  getIdToken: async () => null,
});

function firebaseUserToUser(fbUser: FirebaseUser): User {
  const displayName = fbUser.displayName || "";
  const nameParts = displayName.split(" ");
  return {
    id: fbUser.uid,
    email: fbUser.email,
    firstName: nameParts[0] || null,
    lastName: nameParts.slice(1).join(" ") || null,
    profileImageUrl: fbUser.photoURL,
  };
}

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

function getErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: string }).code;
    switch (code) {
      case "auth/popup-blocked":
        return "Sign-in popup was blocked. Please allow popups and try again.";
      case "auth/popup-closed-by-user":
        return "Sign-in was cancelled.";
      case "auth/network-request-failed":
        return "Network error. Please check your connection and try again.";
      case "auth/invalid-credential":
        return "Invalid credentials. Please try signing in again.";
      case "auth/user-disabled":
        return "This account has been disabled. Please contact support.";
      case "auth/cancelled-popup-request":
        return "Another sign-in is already in progress.";
      default:
        break;
    }
  }
  if (err instanceof Error) return err.message;
  return "Sign-in failed. Please try again.";
}

async function handleIdTokenFirebase(
  idToken: string,
): Promise<FirebaseUser | null> {
  const firebaseAuth = await getFirebaseAuth();
  if (!firebaseAuth) return null;
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(firebaseAuth, credential);
  return result.user;
}

function loginWithPopupWindow(authUrl: string, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const expectedOrigin = API_BASE
      ? new URL(API_BASE).origin
      : window.location.origin;
    const popup = window.open(
      authUrl,
      "elovia-auth",
      "width=500,height=600,menubar=no,toolbar=no",
    );
    if (!popup) {
      reject(
        new Error("Popup was blocked. Please allow popups and try again."),
      );
      return;
    }

    const handler = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return;
      if (
        (event.data?.type === "elovia-auth" ||
          event.data?.type === "fitai-auth") &&
        event.data?.state === state
      ) {
        window.removeEventListener("message", handler);
        clearInterval(checkClosed);
        if (event.data.idToken) {
          resolve(event.data.idToken);
        } else {
          reject(new Error(event.data.error || "Sign-in failed."));
        }
      }
    };
    window.addEventListener("message", handler);

    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        window.removeEventListener("message", handler);
        reject(new Error("Sign-in was cancelled."));
      }
    }, 500);
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let mounted = true;
    getFirebaseAuth()
      .then((firebaseAuth) => {
        if (!mounted) return;
        unsubscribe = onAuthStateChanged(firebaseAuth, (fbUser) => {
          if (!mounted) return;
          const nextUser = fbUser ? firebaseUserToUser(fbUser) : null;
          setAccountStorageAuthScope(nextUser?.id ?? null, false);
          setUser(nextUser);
          setIsLoading(false);
        });
      })
      .catch(() => {
        if (mounted) {
          setAccountStorageAuthScope(null, false);
          setIsLoading(false);
        }
      });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    const firebaseAuth = await getFirebaseAuth();
    if (!firebaseAuth.currentUser) return null;
    return firebaseAuth.currentUser.getIdToken();
  }, []);

  const login = useCallback(async () => {
    setAuthError(null);
    try {
      const state = generateUUID();

      if (Platform.OS === "web") {
        const authUrl = `${API_BASE}/api/auth/google-mobile?mode=popup&state=${encodeURIComponent(state)}`;
        const idToken = await loginWithPopupWindow(authUrl, state);
        await handleIdTokenFirebase(idToken);
      } else {
        const returnUrl = Linking.createURL("auth");
        const authUrl = `${API_BASE}/api/auth/google-mobile?returnUrl=${encodeURIComponent(returnUrl)}&state=${encodeURIComponent(state)}`;

        const result = await WebBrowser.openAuthSessionAsync(
          authUrl,
          returnUrl,
        );

        if (result.type === "cancel" || result.type === "dismiss") {
          setAuthError("Sign-in was cancelled.");
          return;
        }

        if (result.type === "success" && result.url) {
          const returnedStateRaw = result.url.match(/[?&#]state=([^&]+)/)?.[1];
          const returnedState = returnedStateRaw
            ? decodeURIComponent(returnedStateRaw)
            : null;
          if (!returnedState || returnedState !== state) {
            const msg = "Security check failed. Please try signing in again.";
            setAuthError(msg);
            Alert.alert("Sign-In Error", msg);
            return;
          }
          const rawToken = result.url.match(/[?&#]idToken=([^&]+)/)?.[1];
          const idToken = rawToken ? decodeURIComponent(rawToken) : null;
          if (idToken) {
            await handleIdTokenFirebase(idToken);
          } else {
            const msg = "No authentication token received. Please try again.";
            setAuthError(msg);
            Alert.alert("Sign-In Error", msg);
          }
        } else if (result.type !== "success") {
          setAuthError("Sign-in did not complete. Please try again.");
        }
      }
    } catch (err) {
      console.error("Login error:", err);
      const msg = getErrorMessage(err);
      setAuthError(msg);
      if (Platform.OS !== "web") {
        Alert.alert("Sign-In Error", msg);
      }
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const firebaseAuth = await getFirebaseAuth();
      let pushCleanupComplete = true;
      if (firebaseAuth.currentUser?.uid) {
        pushCleanupComplete = await settleWithin(
          unregisterFromPush(firebaseAuth.currentUser.uid),
          10_000,
          false,
        );
      }
      await settleWithin<unknown>(
        Promise.allSettled([cancelAllReminders(), stopAllGeofences()]),
        2_500,
        null,
      );
      await signOut(firebaseAuth);
      setAccountStorageAuthScope(null, false);
      setUser(null);
      const cleanupMessage = pushCleanupComplete
        ? null
        : "Signed out. Notification cleanup will retry when this account reconnects.";
      setAuthError(cleanupMessage);
      if (cleanupMessage && Platform.OS !== "web") {
        Alert.alert("Signed out safely", cleanupMessage);
      }
    } catch (err) {
      console.error("Logout error:", err);
      const msg = getErrorMessage(err);
      setAuthError(msg);
      if (Platform.OS !== "web") {
        Alert.alert("Sign-Out Error", msg);
      }
    }
  }, []);

  const accountScopeKey = getAccountStorageScopeKey();

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        authError,
        login,
        logout,
        getIdToken,
      }}
    >
      <React.Fragment key={accountScopeKey}>
        {isLoading ? null : children}
      </React.Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
