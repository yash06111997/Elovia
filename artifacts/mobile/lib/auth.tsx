import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
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
import { auth } from "./firebase";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if ((Platform.OS as string) === "web") {
      import("firebase/auth").then(({ getRedirectResult }) => {
        getRedirectResult(auth).catch((err) => {
          console.error("getRedirectResult error:", err);
        });
      });
    }

    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setUser(firebaseUserToUser(fbUser));
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  const login = useCallback(async () => {
    setAuthError(null);
    try {
      if (Platform.OS === "web") {
        const { signInWithPopup, signInWithRedirect } = await import("firebase/auth");
        const provider = new GoogleAuthProvider();
        provider.addScope("email");
        provider.addScope("profile");
        try {
          await signInWithPopup(auth, provider);
        } catch (popupErr: unknown) {
          const code = popupErr && typeof popupErr === "object" && "code" in popupErr
            ? (popupErr as { code: string }).code
            : "";
          if (code === "auth/popup-blocked") {
            await signInWithRedirect(auth, provider);
          } else {
            throw popupErr;
          }
        }
      } else {
        const state = Crypto.randomUUID();
        const returnUrl = Linking.createURL("auth");
        const authUrl = `${API_BASE}/api/auth/google-mobile?returnUrl=${encodeURIComponent(returnUrl)}&state=${encodeURIComponent(state)}`;

        const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);

        if (result.type === "cancel" || result.type === "dismiss") {
          setAuthError("Sign-in was cancelled.");
          return;
        }

        if (result.type === "success" && result.url) {
          const returnedStateRaw = result.url.match(/[?&]state=([^&]+)/)?.[1];
          const returnedState = returnedStateRaw ? decodeURIComponent(returnedStateRaw) : null;
          if (!returnedState || returnedState !== state) {
            const msg = "Security check failed. Please try signing in again.";
            setAuthError(msg);
            if ((Platform.OS as string) !== "web") Alert.alert("Sign-In Error", msg);
            return;
          }
          const rawToken = result.url.match(/[?&]idToken=([^&]+)/)?.[1];
          const idToken = rawToken ? decodeURIComponent(rawToken) : null;
          if (idToken) {
            const credential = GoogleAuthProvider.credential(idToken);
            await signInWithCredential(auth, credential);
          } else {
            const msg = "No authentication token received. Please try again.";
            setAuthError(msg);
            if ((Platform.OS as string) !== "web") Alert.alert("Sign-In Error", msg);
          }
        } else if (result.type !== "success") {
          setAuthError("Sign-in did not complete. Please try again.");
        }
      }
    } catch (err) {
      console.error("Login error:", err);
      const msg = getErrorMessage(err);
      setAuthError(msg);
      if ((Platform.OS as string) !== "web") {
        Alert.alert("Sign-In Error", msg);
      }
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      setUser(null);
      setAuthError(null);
    } catch (err) {
      console.error("Logout error:", err);
      const msg = getErrorMessage(err);
      setAuthError(msg);
      if ((Platform.OS as string) !== "web") {
        Alert.alert("Sign-Out Error", msg);
      }
    }
  }, []);

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
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
