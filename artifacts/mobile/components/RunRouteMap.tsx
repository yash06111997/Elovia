import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, type LatLng, type Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";

export interface RunRouteCoordinate extends LatLng {}

interface RunRouteMapProps {
  points: readonly RunRouteCoordinate[];
  live?: boolean;
  height?: number;
}

const WORLD_REGION: Region = {
  latitude: 20,
  longitude: 0,
  latitudeDelta: 120,
  longitudeDelta: 120,
};

const FOLLOW_DELTA = 0.008;

/** Apple Maps on iOS and Google Maps on Android with a live route overlay. */
export function RunRouteMap({ points, live = false, height = 220 }: RunRouteMapProps) {
  const { theme, isDark } = useTheme();
  const mapRef = useRef<MapView | null>(null);
  const coordinates = useMemo(
    () => points.map(({ latitude, longitude }) => ({ latitude, longitude })),
    [points],
  );

  const focusRoute = useCallback(
    (animated: boolean) => {
      const map = mapRef.current;
      const latest = coordinates[coordinates.length - 1];
      if (!map || !latest) return;

      if (live || coordinates.length === 1) {
        map.animateToRegion(
          {
            ...latest,
            latitudeDelta: FOLLOW_DELTA,
            longitudeDelta: FOLLOW_DELTA,
          },
          animated ? 450 : 0,
        );
        return;
      }

      map.fitToCoordinates(coordinates, {
        animated,
        edgePadding: { top: 52, right: 42, bottom: 52, left: 42 },
      });
    },
    [coordinates, live],
  );

  useEffect(() => {
    focusRoute(true);
  }, [focusRoute]);

  return (
    <View style={[styles.frame, { height, borderColor: theme.border }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={coordinates[0] ? { ...coordinates[0], latitudeDelta: FOLLOW_DELTA, longitudeDelta: FOLLOW_DELTA } : WORLD_REGION}
        mapType="standard"
        userInterfaceStyle={isDark ? "dark" : "light"}
        loadingEnabled
        showsCompass
        showsScale
        showsUserLocation={live}
        showsMyLocationButton={live}
        onMapReady={() => focusRoute(false)}
        accessibilityLabel={live ? "Live running route map" : "Saved running route map"}
      >
        {coordinates.length > 1 && (
          <Polyline
            coordinates={coordinates}
            strokeColor={Colors.primary}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {coordinates[0] && (
          <Marker coordinate={coordinates[0]} pinColor={Colors.accentGreen} title="Start" />
        )}
        {!live && coordinates.length > 1 && (
          <Marker
            coordinate={coordinates[coordinates.length - 1]}
            pinColor={Colors.accentRed}
            title="Finish"
          />
        )}
      </MapView>

      {coordinates.length === 0 && (
        <View pointerEvents="none" style={[styles.waiting, { backgroundColor: theme.surface + "E8" }]}>
          <Ionicons name="navigate" size={18} color={Colors.primary} />
          <Text style={[styles.waitingText, { color: theme.text }]}>Waiting for an accurate GPS fix…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  waiting: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  waitingText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
