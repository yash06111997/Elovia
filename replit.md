# Elovia — Fitness, food, and life in balance

## Overview
Elovia is a production-ready mobile health and fitness application built with Expo (React Native). It aims to provide users with a balanced approach to fitness, nutrition, and overall well-being. The app incorporates AI-powered features for personalized workout generation and food recognition, delivered across iOS, Android, and Web platforms. Its core vision is to offer a comprehensive and intelligent solution for users looking to achieve their health and fitness goals.

## User Preferences
- All changes must be verified with me before deployment.
- I prefer a clean, modular, and maintainable codebase.
- Detailed explanations for complex logic are appreciated.
- Prioritize user experience with smooth animations and responsive design.

## System Architecture

### UI/UX Decisions
- **Color Scheme**: Primary electric blue (`#00D4FF`) with a dark charcoal background (`#0A0A0F`). Cards are `#1A1A24` with `#2A2A3A` borders. Accents include green, orange, yellow, and red.
- **Typography**: Inter font (400/500/600/700).
- **Theming**: Supports both dark and light modes using a `useTheme` hook.
- **Platform-Specific UI**: Utilizes `expo-glass-effect` and `NativeTabs` for iOS liquid glass tab bar, `expo-blur` for tab bar blur on iOS, and `expo-symbols` for SF Symbols on iOS, while using `@expo/vector-icons` (Ionicons) for Android/Web.

### Technical Implementations
- **Framework**: Expo / React Native with Expo Router for file-based routing.
- **State Management**: React Context combined with AsyncStorage for full local persistence of user data.
- **AI Integration**: Anthropic Claude (claude-sonnet-4-6) is used for AI features via Replit AI Integrations proxy.
- **Authentication**: Firebase Auth with Google Sign-In, supporting both native mobile (server-hosted auth page via `WebBrowser.openAuthSessionAsync`) and web (Firebase JS SDK `signInWithPopup`).
- **Data Storage**: All user data is locally persisted in AsyncStorage and can be synced with Firebase Realtime Database.
- **Data Sync**: Automatic data restore on login, periodic auto-backup every 5 minutes while authenticated, and backup on app background to Firebase Realtime Database.
- **Subscription Model**: Implements a freemium model with a 15-day trial, managed by `SubscriptionContext`, and integrated with RevenueCat for in-app purchases. RevenueCat project (proj265e34c7) is fully seeded with 3 products (monthly $4.99, yearly $29.99, lifetime $79.99), entitlement "Elovia Pro", and default offering with USD/EUR/GBP pricing. User identity syncs with Firebase Auth via `Purchases.logIn/logOut`.
- **Location Tracking**: `expo-location` is used for GPS run tracking with real-time distance tracking.

### Feature Specifications
- **Onboarding**: A 7-step process covering personal info, fitness goals, workout preferences, equipment, diet, and health habits.
- **Dashboard**: Displays TDEE-based calorie tracking, macro progress, today's workout, weekly completion, and personal stats (steps, water intake).
- **Workouts**: Features AI-generated workout plans, an exercise library (154+ exercises), a custom plan builder, plan switching, exercise performance tracking with PR notifications, and workout history.
- **Diet**: Offers AI-generated personalized meal plans, a custom meal plan system, AI food photo recognition via camera (Claude Vision), a comprehensive food database, and daily macro tracking.
- **Progress**: Tracks personal records, session history, weekly calorie trends, and body stats (BMI, weight change).
- **Profile**: Allows inline editing of all profile sections, goal timeline tracking, manual macro overrides, health data sync (Apple Health, Google Fit, Step Counter, GPS Tracking), and account management with cloud backup/restore.

### System Design Choices
- **Backend API**: An Express API server handles AI features like food recognition and workout generation.
- **Database Security**: Firebase Realtime Database rules ensure that only authenticated users can read/write their own data.

## Production Deployment

### EAS Build Configuration
- **`eas.json`** at `artifacts/mobile/eas.json` — configured with development, preview, and production build profiles
- **Production build**: auto-increments version, uses `EXPO_PUBLIC_DOMAIN=health-hub-yash06111997.replit.app`
- **iOS build**: Release configuration
- **Android build**: app-bundle format for Play Store

### API Server Deployment
- **Deployment target**: autoscale (configured in `artifact.toml`)
- **Production URL**: `health-hub-yash06111997.replit.app`
- **Health check**: `/api/healthz`
- **Build**: esbuild → `dist/index.mjs`

### RevenueCat Production Apps
- **iOS App**: `app79ce9a5ade` (bundle: `app.replit.elovia`, P8 key configured, subscription key configured)
- **Android App**: `app456ae32659` (package: `app.replit.elovia`)
- **Live API Keys**: iOS = `appl_oLFdmGeTXzxRrGzqBRbIXqwBNjB`, Android = `goog_tJrCVZClURpSUPUzOOtAwimmOuF`
- **Products** (6 total — 3 per store):
  - `elovia_pro_monthly` (subscription) — iOS & Android
  - `elovia_pro_yearly` (subscription) — iOS & Android
  - `elovia_pro_lifetime` (non_consumable) — iOS & Android
- **All products attached** to entitlement "Elovia Pro" and packages ($rc_monthly, $rc_annual, $rc_lifetime)

### App Store Readiness
- **Bundle ID**: `app.replit.elovia` (matches App Store Connect)
- **Permissions declared**: Camera, Photos, Location, HealthKit (iOS), BILLING (Android)
- **Encryption**: `ITSAppUsesNonExemptEncryption = false` (no export compliance needed)
- **Splash background**: `#0A0A0F` (matches app dark theme)

## External Dependencies

- **AI Providers**: Anthropic Claude (via Replit AI Integrations proxy).
- **Authentication**: Firebase Authentication.
- **Database**: Firebase Realtime Database.
- **Analytics & Subscriptions**: RevenueCat.
- **Location Services**: `expo-location`.
- **UI Libraries**:
    - `expo-glass-effect`
    - `NativeTabs`
    - `expo-blur`
    - `expo-symbols`
    - `@expo/vector-icons`
    - `react-native-svg`
    - `react-native-reanimated`
    - `@react-native-async-storage/async-storage`
    - `expo-haptics`
    - `expo-image-picker`
    - `@expo-google-fonts/inter`