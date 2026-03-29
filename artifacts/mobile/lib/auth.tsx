import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { Platform } from "react-native";
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
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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
    try {
      if (Platform.OS === "web") {
        const { signInWithPopup } = await import("firebase/auth");
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      } else {
        const state = Crypto.randomUUID();
        const returnUrl = Linking.createURL("auth");
        const authUrl = `${API_BASE}/api/auth/google-mobile?returnUrl=${encodeURIComponent(returnUrl)}&state=${encodeURIComponent(state)}`;

        const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);

        if (result.type === "success" && result.url) {
          const returnedState = result.url.match(/[?&]state=([^&]+)/)?.[1];
          if (returnedState && decodeURIComponent(returnedState) !== state) {
            console.error("Auth state mismatch");
            return;
          }
          const rawToken = result.url.match(/[?&]idToken=([^&]+)/)?.[1];
          const idToken = rawToken ? decodeURIComponent(rawToken) : null;
          if (idToken) {
            const credential = GoogleAuthProvider.credential(idToken);
            await signInWithCredential(auth, credential);
          }
        }
      }
    } catch (err) {
      console.error("Login error:", err);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (err) {
      console.error("Logout error:", err);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
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
