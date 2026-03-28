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
- Fitness goals (fat loss, muscle gain, strength, endurance, maintenance, general fitness)
- Workout preferences (gym/home/mixed, days per week, session duration)
- Equipment selection (12 equipment types)
- Diet & nutrition (vegetarian/vegan/non-veg/eggetarian, restrictions, dislikes)
- Health habits (sleep hours, water intake, medical notes)

### Dashboard
- TDEE-based calorie tracking ring (Mifflin-St Jeor formula)
- Macro progress bars (protein/carbs/fats)
- Today's workout card
- Weekly completion tracker
- Stats: steps, water intake (tap to add 250ml), weekly workouts, personal records
- Greeting by time of day

### Workouts Tab
- AI-generated workout plans using local exercise database OR Claude AI
- AI workout generation: daily (single optimized session) or scheduled (full weekly split)
- Push/Pull/Legs, Upper/Lower, PPL, and 4/5/6-day bro splits
- Per-exercise set logging with weight and rep inputs
- Active session timer
- PR tracking per exercise (highlighted with trophy icon)
- Regenerate plan button + AI generate button

### Diet Tab
- AI-generated meal plans (breakfast/lunch/dinner/snack)
- AI food photo recognition via camera (Claude vision → structured macros)
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
- Tap-to-edit height, weight, and target weight (NumberEditModal with stepper + keypad)
- Target weight tracking with weight delta badge
- Manual macro overrides (custom calories/protein/carbs/fats targets)
- Body stats, TDEE, daily macro targets
- Fitness & diet profile summary
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
    NutritionContext.tsx   # Meal plans, food log
  utils/
    aiEngine.ts           # Local workout & meal plan generation
    foodDatabase.ts       # 80+ foods, 11 categories with full macro data
    api.ts                # API helpers (recognizeFood, generateAIWorkout)
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
- `@fitai_plan` — workout plan
- `@fitai_sessions` — workout session history (up to 200)
- `@fitai_prs` — personal records per exercise
- `@fitai_meal_plan` — generated meal plan
- `@fitai_food_log` — food log entries (up to 500)
- `@fitai_active_session` — current in-progress workout session

## Environment Variables

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Auto-set by Replit AI Integrations
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Auto-set by Replit AI Integrations
- `EXPO_PUBLIC_DOMAIN` — Set to $REPLIT_DEV_DOMAIN for mobile API connectivity
- `SESSION_SECRET` — For session management
