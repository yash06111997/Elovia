# FitAI - Health & Fitness App

A production-ready mobile health and fitness app built with Expo (React Native).

## Architecture

- **Framework**: Expo / React Native with Expo Router file-based routing
- **State**: React Context + AsyncStorage for full local persistence (no backend needed)
- **Platform**: iOS, Android, Web (all supported)

## Features

### Onboarding (6 steps)
- Personal info (name, age, gender, height, weight)
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
- AI-generated workout plans using local exercise database
- Push/Pull/Legs, Upper/Lower, PPL, and 4/5/6-day bro splits
- Per-exercise set logging with weight and rep inputs
- Active session timer
- PR tracking per exercise (highlighted with trophy icon)
- Regenerate plan button

### Diet Tab
- AI-generated meal plans (breakfast/lunch/dinner/snack)
- Food logging with quick-add modal
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
- **@expo-google-fonts/inter** (Inter 400/500/600/700)

## File Structure

```
artifacts/mobile/
  app/
    _layout.tsx           # Root layout with all providers
    (tabs)/
      _layout.tsx         # 5-tab layout with AppGuard onboarding redirect
      index.tsx           # Dashboard
      workouts.tsx        # Workout plans & logging
      diet.tsx            # Nutrition tracking
      progress.tsx        # Analytics
      profile.tsx         # Profile & settings
    onboarding/
      index.tsx           # 6-step onboarding flow
  components/
    ProgressRing.tsx      # SVG circular progress
    MacroBar.tsx          # Animated macro progress bar
    StatCard.tsx          # Stat display card
    ExerciseCard.tsx      # Exercise with set logging
    MealCard.tsx          # Meal with log action
    ErrorBoundary.tsx     # Error boundary
  context/
    AppContext.tsx         # Profile, health metrics, TDEE/macros
    WorkoutContext.tsx     # Plans, sessions, PRs
    NutritionContext.tsx   # Meal plans, food log
  utils/
    aiEngine.ts           # Local workout & meal plan generation
  constants/
    colors.ts             # Electric blue + dark charcoal theme
```

## Design System

- **Primary**: Electric blue `#00D4FF`
- **Background**: Dark charcoal `#0A0A0F`
- **Cards**: `#1A1A24` with `#2A2A3A` borders
- **Accents**: Green `#00E676`, Orange `#FF6B35`, Yellow `#FFD600`, Red `#FF3D71`
- **Font**: Inter (400/500/600/700)
- Both **dark and light** modes supported

## Local Data Persistence

All data is stored in AsyncStorage:
- `@fitai_state` — profile, onboarding flag, health metrics, streak, total workouts
- `@fitai_plan` — workout plan
- `@fitai_sessions` — workout session history (up to 200)
- `@fitai_prs` — personal records per exercise
- `@fitai_meal_plan` — generated meal plan
- `@fitai_food_log` — food log entries (up to 500)
- `@fitai_active_session` — current in-progress workout session
