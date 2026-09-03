const staticConfig = require("./app.json");

/**
 * Google Maps SDK keys belong in EAS environment variables, never source.
 * iOS continues to use Apple Maps and needs no key.
 */
module.exports = ({ config }) => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const expo = { ...staticConfig.expo, ...config };
  return {
    ...expo,
    extra: {
      ...expo.extra,
      hasGoogleMapsNativeKey: Boolean(googleMapsApiKey),
    },
    android: {
      ...expo.android,
      ...(googleMapsApiKey
        ? {
            config: {
              ...(expo.android.config ?? {}),
              googleMaps: { apiKey: googleMapsApiKey },
            },
          }
        : {}),
    },
  };
};
