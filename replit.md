# FitAI - Health & Fitness App

A production-ready mobile health and fitness app built with Expo (React Native) with AI-powered features.

## Architecture

- **Framework**: Expo / React Native with Expo Router file-based routing
- **State**: React Context + AsyncStorage for full local persistence
- **Backend**: Express API server for AI features (food recognition, workout generation)
- **AI**: Anthropic Claude (claude-sonnet-4-6) via Replit AI Integrations proxy
- **Platform**: iOS, Android, Web (all supported)

## Features

### Onboarding (6 steps)
- Personal info (name, age, gender, height, weight, target weight)
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
- **Plan/History toggle** — switch between workout plans and history views
- AI-generated workout plans using 154+ exercise database (expanded from ~40) OR Claude AI
- AI workout generation: daily (single optimized session) or scheduled (full weekly split)
- Push/Pull/Legs, Upper/Lower, PPL, and 4/5/6-day bro splits including Glutes
- **Exercise Library** — browsable full catalog with category tabs, search, difficulty/type badges, detail expansion, and equipment filter
- **Custom Plan Builder** — create named plans, add/remove workout days, pick exercises from library, set custom sets/reps/rest
- **Plan Switcher** — switch between AI-generated plan and any custom plans
- Per-exercise set logging with weight and rep inputs
- Active session timer
- PR tracking per exercise (highlighted with trophy icon)
- Regenerate plan button + AI generate button (sparkles)
- **Workout History** — grouped-by-date expandable session cards with sets/reps/weight detail, aggregate stats (total sessions, minutes, exercises, volume kg)

### Diet Tab
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
- Tap-to-edit height, weight, target weight, and **target weeks** (NumberEditModal with stepper + keypad)
- **Goal timeline tracking** — shows weekly rate, daily calorie adjustment based on weight delta and timeline
- Target weight tracking with weight delta badge
- Manual macro overrides (custom calories/protein/carbs/fats targets)
- Body stats, TDEE, daily macro targets
- Fitness & diet profile summary
- **Health Data Sync section** — Apple Health, Google Fit, Step Counter, GPS Tracking toggle cards
- **Step tracking** with progress bar toward 10,000 goal
- **GPS run tracking** — start/stop run with real-time distance tracking via expo-location, active run banner with pulse indicator
- **Run history** — last run stats (distance, duration, calories)
- Sync Now button with last-synced timestamp
- Dark/light mode toggle
- Reset all data option

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

## File Structure

```
artifacts/mobile/
  app/
    _layout.tsx           # Root layout with all providers
    (tabs)/
      _layout.tsx         # 5-tab layout with AppGuard onboarding redirect
      index.tsx           # Dashboard
      workouts.tsx        # Workout plans & logging (+ AI generation)
      diet.tsx            # Nutrition tracking (+ food search + camera scan)
      progress.tsx        # Analytics
      profile.tsx         # Profile & settings (+ editable stats + custom macros)
    onboarding/
      index.tsx           # 6-step onboarding flow (includes target weight)
  components/
    ProgressRing.tsx      # SVG circular progress
    MacroBar.tsx          # Animated macro progress bar
    StatCard.tsx          # Stat display card
    ExerciseCard.tsx      # Exercise with set logging
    MealCard.tsx          # Meal with log action
    NumberEditModal.tsx   # Tap-to-edit modal with stepper + keypad
    FoodSearch.tsx        # Food database browser with search & categories
    ErrorBoundary.tsx     # Error boundary
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
    app.ts                # Express app with CORS, JSON (20mb limit for images)
    routes/
      index.ts            # Route registry
      health.ts           # Health check
      ai/
        index.ts          # AI routes: /api/ai/recognize-food, /api/ai/generate-workout
```

## API Endpoints

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

## Environment Variables

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Auto-set by Replit AI Integrations
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Auto-set by Replit AI Integrations
- `EXPO_PUBLIC_DOMAIN` — Set to $REPLIT_DEV_DOMAIN for mobile API connectivity
- `SESSION_SECRET` — For session management
