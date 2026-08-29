/**
 * React Native autolinking overrides.
 *
 * @kingstinct/react-native-healthkit is iOS-only, but its peer dependency
 * react-native-nitro-modules ships an Android target too — so autolinking
 * pulls Nitro into the Android build, where it compiles C++ through CMake/NDK
 * for a module that has no Android consumer at all.
 *
 * That is pure cost at best and a build failure at worst, so both are excluded
 * from Android explicitly. iOS is untouched: HealthKit and the Nitro runtime it
 * needs still link there normally.
 */
module.exports = {
  dependencies: {
    "react-native-nitro-modules": {
      platforms: {
        android: null,
      },
    },
    "@kingstinct/react-native-healthkit": {
      platforms: {
        android: null,
      },
    },
  },
};
