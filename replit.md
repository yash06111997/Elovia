# Elovia — Fitness, food, and life in balance

A production-ready mobile health and fitness app built with Expo (React Native) with AI-powered features.

## Architecture

- **Framework**: Expo / React Native with Expo Router file-based routing
- **State**: React Context + AsyncStorage for full local persistence
- **Backend**: Express API server for AI features (food recognition, workout generation)
- **AI**: Anthropic Claude (claude-sonnet-4-6) via Replit AI Integrations proxy
- **Platform**: iOS, Android, Web (all supported)

## Features

### Onboarding (7 steps)
- **Welcome screen** — app branding, feature highlights, optional Google Sign-In button (can skip and sign in later from Profile)
- Personal info (name, age, gender, height, weight, target weight) — **NumberStepper values are tappable for keyboard input**
- Fitness goals (fat loss, muscle gain, strength, endurance, maintenance, general fitness) + **goal timeline** (target weeks stepper with live calorie adjustment preview)
- Workout preferences (gym/home/mixed, days per week, session duration)
- Equipment selection (12 equipment types)
- Diet & nutrition (vegetarian/vegan/non-veg/eggetarian, **diet type** selection: balanced/keto/low carb/high protein/Mediterranean/paleo, favorite foods, restrictions, dislikes, meal suggestions)
- Health habits (sleep hours, water intake, medical notes)

### Dashboard
- TDEE-based calorie tracking ring (Mifflin-St Jeor formula)
- Macro progress bars (protein/carbs/fats)
- Today's workout card
- Weekly completion tracker
- Stats: steps, water intake (tap to add 250ml), weekly workouts, personal records
- Greeting by time of day

### Workouts Tab
- **Clean empty state** — two prominent cards: "Custom Self Tracking" and "AI Powered Workout" + quick generate option
- **Plan/History toggle** — switch between workout plans and history views
- AI-generated workout plans using 154+ exercise database (expanded from ~40) OR Claude AI
- AI workout generation: daily (single optimized session) or scheduled (full weekly split)
- Push/Pull/Legs, Upper/Lower, PPL, and 4/5/6-day bro splits including Glutes
- **Exercise Library** — browsable full catalog with category tabs, search, difficulty/type badges, detail expansion, and equipment filter
- **Custom Plan Builder** — create named plans, add/remove workout days, pick exercises from library, set custom sets/reps/rest
- **Plan Switcher** — switch between AI-generated plan and any custom plans
- Per-exercise set logging with weight and rep inputs
- **Exercise performance tracking** — each exercise card shows best PR (trophy) and last session's performance with set-by-set breakdown
- **New PR notification** — animated flash banner + haptic feedback + alert when a personal record is broken during a workout
- Active session timer
- **Smart placeholders** — weight/rep inputs show last session values as placeholders
- Regenerate plan button + AI generate button (sparkles)
- **Workout History** — grouped-by-date expandable session cards with sets/reps/weight detail, aggregate stats (total sessions, minutes, exercises, volume kg)

### Diet Tab
- **Clean empty state** — defaults to "Today's Log" tab when no plan exists; plan tab shows two option cards (Custom Meal Plan, AI Meal Plan) + quick generate
- **Plan switcher** — AI vs Custom meal plan toggle (mirrors workout dual-plan system)
- **AI-generated personalized meal plans** via Claude with diet type selection (balanced, keto, low carb, high protein, Mediterranean, paleo), favorite foods input, special suggestions, and meals-per-day selector
- **Custom Meal Plan System** — full CRUD for user-created meal plans with per-meal form (name, type, macros, description, ingredients), auto-calculated plan totals, edit/delete support
- **CustomMealPlanBuilder** — full-screen modal for building meal plans with meal cards, summary row
- AI food photo recognition via camera (Claude vision → structured macros)
- Local meal plan generation fallback
- Comprehensive food database (80+ items, 11 categories) with search & category browsing
- Food logging with quick-add modal or food database search
- Daily macro progress tracking
- Today's food log with delete support
- Meal plan refresh

### Progress Tab
- Personal records leaderboard
- Session history
- Weekly calorie bar chart (7 days)
- Body stats (BMI, weight change trend)
- Tabs: Strength / Nutrition / Body

### Profile Tab
- Full profile view with all stats
- **Full inline editing** — all profile sections are tappable with edit modals:
  - Body Stats: tap-to-edit age, name/gender, height, weight, target weight, target weeks
  - Fitness Profile: edit goal, fitness level, activity level, workout preference, days/week, session length (staged save with Cancel/Save)
  - Diet Profile: edit food preference, restrictions, dislikes, medical notes (staged save)
  - Equipment: edit all equipment toggles (staged save)
  - Health Habits: edit sleep hours, water intake
- **Goal timeline tracking** — shows weekly rate, daily calorie adjustment based on weight delta and timeline
- Target weight tracking with weight delta badge
- Manual macro overrides (custom calories/protein/carbs/fats targets)
- Body stats, TDEE, daily macro targets
- **Health Data Sync section** — Apple Health, Google Fit, Step Counter, GPS Tracking toggle cards
- **Step tracking** with progress bar toward 10,000 goal
- **GPS run tracking** — start/stop run with real-time distance tracking via expo-location, active run banner with pulse indicator
- **Run history** — last run stats (distance, duration, calories)
- Sync Now button with last-synced timestamp
- **Account section** — Sign in with Google (via OIDC), user profile display, cloud backup/restore buttons
- **Data sync** — Upload/download all app data (profile, workouts, meals, health) to/from server database
- Dark/light mode toggle — uses `useTheme` hook (reads from AppContext, not system preference) across all screens
- Reset all data option

### Authentication
- Firebase Auth with Google Sign-In provider
- **Native mobile**: Server-hosted auth page approach — opens `WebBrowser.openAuthSessionAsync` to `/api/auth/google-mobile` which does `signInWithRedirect` via Firebase JS SDK, then returns the ID token to the app via deep link (`Linking.createURL`)
- **Web**: Firebase JS SDK `signInWithPopup` directly
- Server: Firebase Admin SDK (`firebase-admin`) verifies ID tokens via Bearer header
- **Cloud data storage**: Firebase Realtime Database — user data stored at `users/{uid}` path
- **Database URL**: `https://fitness-app-e0aab-default-rtdb.asia-southeast1.firebasedatabase.app`
- **Data sync**: Backup/Restore buttons on Profile tab write/read all AsyncStorage data to/from Realtime Database
- **Database security rules**: Only authenticated users can read/write their own data (`$uid === auth.uid`) — see `artifacts/mobile/database.rules.json`
- **IMPORTANT**: The Replit dev domain must be added to Firebase Console → Authentication → Settings → Authorized domains for the sign-in redirect to work

## Tech Stack

- **Expo SDK 54** with Expo Router v6
- **expo-glass-effect** + **NativeTabs** (iOS 26 liquid glass tab bar)
- **expo-blur** (tab bar blur on iOS)
- **expo-symbols** (SF Symbols on iOS)
- **@expo/vector-icons** (Ionicons on Android/Web)
- **react-native-svg** (ProgressRing component)
- **react-native-reanimated** (animated macro bars)
- **@react-native-async-storage/async-storage** (full data persistence)
- **expo-haptics** (tactile feedback throughout)
- **expo-image-picker** (camera for food photo recognition)
- **@expo-google-fonts/inter** (Inter 400/500/600/700)
- **@anthropic-ai/sdk** (AI food recognition & workout generation via backend)
- **expo-location** (GPS run tracking with foreground permissions)
- **firebase** (Firebase JS SDK — Auth with Google Sign-In)
- **firebase-admin** (server-side Firebase token verification)

## File Structure

```
artifacts/mobile/
  app/
    _layout.tsx           # Root layout with all providers (including SubscriptionProvider)
    paywall.tsx           # Paywall / pricing screen (modal)
    (tabs)/
      _layout.tsx         # 5-tab layout with AppGuard + TrialExpiredModal
      index.tsx           # Dashboard (+ subscription banner)
      workouts.tsx        # Workout plans & logging (+ AI generation, premium-gated)
      diet.tsx            # Nutrition tracking (+ food search + camera scan, premium-gated)
      progress.tsx        # Analytics
      profile.tsx         # Profile & settings (+ subscription section)
    onboarding/
      index.tsx           # 7-step onboarding flow (starts trial on completion)
  components/
    ProgressRing.tsx      # SVG circular progress
    MacroBar.tsx          # Animated macro progress bar
    StatCard.tsx          # Stat display card
    ExerciseCard.tsx      # Exercise with set logging
    MealCard.tsx          # Meal with log action
    NumberEditModal.tsx   # Tap-to-edit modal with stepper + keypad
    FoodSearch.tsx        # Food database browser with search & categories
    PremiumLock.tsx       # Wraps premium features with lock overlay + upgrade prompt
    TrialExpiredModal.tsx # Shown when 15-day trial ends
    ErrorBoundary.tsx     # Error boundary
  lib/
    firebase.ts           # Firebase app + auth + Realtime Database initialization
    auth.tsx              # AuthProvider with Firebase Google Sign-In
    firebaseSync.ts       # Realtime Database backup/restore — reads/writes all AsyncStorage data to users/{uid}
  context/
    AppContext.tsx         # Profile, health metrics, TDEE/macros, custom macros
    WorkoutContext.tsx     # Plans, sessions, PRs
    NutritionContext.tsx   # Meal plans, food log, custom meal plans
    HealthContext.tsx      # Health sync, step tracking, GPS run tracking
  screens/
    ExerciseLibraryScreen.tsx  # Browsable exercise library (modal)
    CustomPlanBuilderScreen.tsx # Custom plan creation/editing (modal)
    CustomMealPlanBuilder.tsx  # Custom meal plan creation/editing (modal)
  utils/
    aiEngine.ts           # Local workout & meal plan generation (uses expanded DB)
    foodDatabase.ts       # 80+ foods, 11 categories with full macro data
    exerciseDatabase.ts   # 154+ exercises with full metadata (category, equipment, difficulty, type)
    api.ts                # API helpers (recognizeFood, generateAIWorkout, generateAIMealPlan)
  constants/
    colors.ts             # Electric blue + dark charcoal theme

artifacts/api-server/
  src/
    app.ts                # Express app with CORS, Firebase auth middleware, JSON (20mb)
    lib/
      auth.ts             # Firebase Admin SDK init, token verification
    middlewares/
      authMiddleware.ts   # Verifies Firebase ID token from Bearer header
    routes/
      index.ts            # Route registry
      health.ts           # Health check
      auth.ts             # GET /api/auth/user + GET /api/auth/google-mobile (server-hosted Google sign-in for native)
      userData.ts         # GET/POST /api/user-data (cloud data sync)
      ai/
        index.ts          # AI routes: /api/ai/recognize-food, /api/ai/generate-workout
```

## API Endpoints

- `GET /api/auth/user` — Returns current authenticated user or `{ user: null }` (Firebase ID token via Bearer header)
- `GET /api/user-data` — Fetch user's synced app data (authenticated)
- `POST /api/user-data` — Save user's app data to database (authenticated)
- `POST /api/ai/recognize-food` — Send `{ imageBase64 }`, returns structured food analysis with macros
- `POST /api/ai/generate-workout` — Send `{ profile, planType: "daily"|"scheduled" }`, returns workout plan
- `POST /api/ai/generate-meal-plan` — Send `{ profile, dietPrefs: { dietType, favoriteFoods, mealSuggestions, mealsPerDay } }`, returns personalized meal plan with macros

## Design System

- **Primary**: Electric blue `#00D4FF`
- **Background**: Dark charcoal `#0A0A0F`
- **Cards**: `#1A1A24` with `#2A2A3A` borders
- **Accents**: Green `#00E676`, Orange `#FF6B35`, Yellow `#FFD600`, Red `#FF3D71`
- **Font**: Inter (400/500/600/700)
- Both **dark and light** modes supported

## Subscription / Freemium Model

### Architecture
- **Config**: `constants/subscription.ts` — all plan config, pricing, copy text, feature keys, trial duration
- **Context**: `context/SubscriptionContext.tsx` — trial logic, plan detection, feature gating, AsyncStorage persistence
- **Paywall**: `app/paywall.tsx` — modal screen with feature list, plan cards, FAQ, trust elements
- **Trial Expired**: `components/TrialExpiredModal.tsx` — shown automatically when trial ends
- **Premium Lock**: `components/PremiumLock.tsx` — wraps premium features with upgrade prompt overlay

### How It Works
1. **New user completes onboarding** → `startTrial()` called → 15-day premium trial begins
2. **During trial** → all features unlocked, dashboard shows "X days left in Premium" banner
3. **Trial expires** → auto-downgrade to Free, trial expired modal shown once, AI features gated
4. **Free user taps locked feature** → redirected to paywall screen
5. **User upgrades** → premium status persisted, all features unlocked

### Trial Duration Control
- Change `TRIAL_DURATION_DAYS` in `constants/subscription.ts` (default: 15)

### Feature Gating
- AI Workout: gated in `workouts.tsx` — "AI Powered Workout" button + "Quick Generate"
- AI Meal Plan: gated in `diet.tsx` — "AI Meal Plan" button + "Quick Generate"
- Features show "PREMIUM" badge when locked
- `canAccess(featureKey)` helper used throughout

### Apple & Google Subscription Setup (Future)
1. Open `constants/subscription.ts`
2. Update `PRODUCT_IDS.apple.monthly` and `.yearly` with real App Store product IDs
3. Update `PRODUCT_IDS.google.monthly` and `.yearly` with real Play Store product IDs
4. Update `PRICING` with real prices
5. Integrate RevenueCat or StoreKit/Play Billing in `SubscriptionContext.tsx`'s `upgradePlan()` and `restorePurchases()` functions
6. Replace the demo purchase logic with real IAP validation

### AsyncStorage Keys
- `@fitai_subscription` — subscription state (status, trial dates, platform, renewal)

## Local Data Persistence

All data is stored in AsyncStorage:
- `@fitai_state` — profile (including targetWeightKg), onboarding flag, health metrics, streak, total workouts, custom macros
- `@fitai_plan` — AI-generated workout plan
- `@fitai_custom_plans` — user-created custom workout plans (array)
- `@fitai_active_plan_type` — "ai" or "custom"
- `@fitai_active_custom_plan_id` — id of active custom plan (if any)
- `@fitai_sessions` — workout session history (up to 200)
- `@fitai_prs` — personal records per exercise
- `@fitai_meal_plan` — generated meal plan
- `@fitai_food_log` — food log entries (up to 500)
- `@fitai_active_session` — current in-progress workout session
- `@fitai_custom_meal_plans` — user-created custom meal plans (array)
- `@fitai_active_meal_plan_type` — "ai" or "custom"
- `@fitai_active_custom_meal_plan_id` — id of active custom meal plan
- `@fitai_health_data` — health sync status, steps, run sessions
- `@fitai_subscription` — subscription status, trial dates, plan type

## Environment Variables

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Auto-set by Replit AI Integrations
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Auto-set by Replit AI Integrations
- `EXPO_PUBLIC_DOMAIN` — Set to $REPLIT_DEV_DOMAIN for mobile API connectivity
- `EXPO_PUBLIC_FIREBASE_DATABASE_URL` — Firebase Realtime Database URL
- `SESSION_SECRET` — For session management
