import { useEffect } from "react";
import { useRouter } from "expo-router";

export default function AuthScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/(tabs)");
  }, [router]);

  return null;
}
