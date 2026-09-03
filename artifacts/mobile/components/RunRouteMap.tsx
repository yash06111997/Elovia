import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import MapView, {
  Marker,
  Polyline as MapPolyline,
  type LatLng,
  type Region,
} from "react-native-maps";
import Svg, { Circle, Line, Polyline as SvgPolyline } from "react-native-svg";
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

function RouteTrace({
  coordinates,
  live,
}: {
  coordinates: readonly LatLng[];
  live: boolean;
}) {
  const path = useMemo(() => {
    if (coordinates.length === 0) return "";
    const meanLatitude =
      coordinates.reduce((sum, point) => sum + point.latitude, 0) /
      coordinates.length;
    const longitudeScale = Math.max(
      0.2,
      Math.cos((meanLatitude * Math.PI) / 180),
    );
    const projected = coordinates.map((point) => ({
      x: point.longitude * longitudeScale,
      y: -point.latitude,
    }));
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(0.00001, maxX - minX);
    const spanY = Math.max(0.00001, maxY - minY);
    return projected
      .map((point) => {
        const x = 10 + ((point.x - minX) / spanX) * 80;
        const y = 10 + ((point.y - minY) / spanY) * 80;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [coordinates]);
  const pathPoints = path.split(" ");
  const start = pathPoints[0]?.split(",").map(Number);
  const finish = pathPoints[pathPoints.length - 1]?.split(",").map(Number);

  return (
    <View style={[StyleSheet.absoluteFill, styles.trace]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        {[20, 40, 60, 80].map((position) => (
          <React.Fragment key={position}>
            <Line
              x1={position}
              y1={0}
              x2={position}
              y2={100}
              stroke="#FFFFFF10"
            />
            <Line
              x1={0}
              y1={position}
              x2={100}
              y2={position}
              stroke="#FFFFFF10"
            />
          </React.Fragment>
        ))}
        {coordinates.length > 1 && (
          <SvgPolyline
            points={path}
            fill="none"
            stroke={Colors.primary}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {start && (
          <Circle
            cx={start[0]}
            cy={start[1]}
            r={2.6}
            fill={Colors.accentGreen}
          />
        )}
        {!live && finish && coordinates.length > 1 && (
          <Circle
            cx={finish[0]}
            cy={finish[1]}
            r={2.6}
            fill={Colors.accentRed}
          />
        )}
      </Svg>
      <View style={styles.traceLabel}>
        <Ionicons name="map-outline" size={15} color={Colors.primary} />
        <Text style={styles.traceLabelText}>
          {live ? "Live route" : "Route"}
        </Text>
      </View>
    </View>
  );
}

/** Apple Maps on iOS and Google Maps on Android with a live route overlay. */
export function RunRouteMap({
  points,
  live = false,
  height = 220,
}: RunRouteMapProps) {
  const { theme, isDark } = useTheme();
  const mapRef = useRef<MapView | null>(null);
  const coordinates = useMemo(
    () => points.map(({ latitude, longitude }) => ({ latitude, longitude })),
    [points],
  );
  const canUseNativeMap =
    Platform.OS !== "android" ||
    Constants.expoConfig?.extra?.hasGoogleMapsNativeKey === true;

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
      {canUseNativeMap ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={
            coordinates[0]
              ? {
                  ...coordinates[0],
                  latitudeDelta: FOLLOW_DELTA,
                  longitudeDelta: FOLLOW_DELTA,
                }
              : WORLD_REGION
          }
          mapType="standard"
          userInterfaceStyle={isDark ? "dark" : "light"}
          loadingEnabled
          showsCompass
          showsScale
          showsUserLocation={live}
          showsMyLocationButton={live}
          onMapReady={() => focusRoute(false)}
          accessibilityLabel={
            live ? "Live running route map" : "Saved running route map"
          }
        >
          {coordinates.length > 1 && (
            <MapPolyline
              coordinates={coordinates}
              strokeColor={Colors.primary}
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {coordinates[0] && (
            <Marker
              coordinate={coordinates[0]}
              pinColor={Colors.accentGreen}
              title="Start"
            />
          )}
          {!live && coordinates.length > 1 && (
            <Marker
              coordinate={coordinates[coordinates.length - 1]}
              pinColor={Colors.accentRed}
              title="Finish"
            />
          )}
        </MapView>
      ) : (
        <RouteTrace coordinates={coordinates} live={live} />
      )}

      {coordinates.length === 0 && (
        <View
          pointerEvents="none"
          style={[styles.waiting, { backgroundColor: theme.surface + "E8" }]}
        >
          <Ionicons name="navigate" size={18} color={Colors.primary} />
          <Text style={[styles.waitingText, { color: theme.text }]}>
            Waiting for an accurate GPS fix…
          </Text>
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
  trace: {
    backgroundColor: "#101820",
  },
  traceLabel: {
    position: "absolute",
    left: 12,
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "#071018D9",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  traceLabelText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
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
