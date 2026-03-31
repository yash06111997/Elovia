export const TRIAL_DURATION_DAYS = 15;

export type PlanType = "free" | "trial" | "premium";
export type SubscriptionStatus = "free" | "in_trial" | "active" | "expired" | "cancelled";
export type SubscriptionPlatform = "apple" | "google" | "none";

export const PRODUCT_IDS = {
  apple: {
    monthly: "com.elovia.premium.monthly",
    yearly: "com.elovia.premium.yearly",
  },
  google: {
    monthly: "elovia_premium_monthly",
    yearly: "elovia_premium_yearly",
  },
};

export const PRICING = {
  monthly: {
    price: 299,
    currency: "₹",
    label: "₹299/month",
    period: "month",
  },
  yearly: {
    price: 1499,
    currency: "₹",
    label: "₹1,499/year",
    period: "year",
    monthlyEquivalent: "₹125/month",
    savingsPercent: 58,
  },
};

export const FREE_FEATURES = [
  "Basic workout tracking",
  "Basic meal logging",
  "Simple progress view",
  "Limited recommendations",
];

export const PREMIUM_FEATURES = [
  {
    icon: "barbell-outline" as const,
    title: "AI Workout Plans",
    description: "Tailored to your goals, equipment, and progress",
  },
  {
    icon: "restaurant-outline" as const,
    title: "Smart Meal Plans",
    description: "Personalized nutrition that fits your lifestyle",
  },
  {
    icon: "analytics-outline" as const,
    title: "Advanced Progress Tracking",
    description: "See exactly how far you've come with detailed analytics",
  },
  {
    icon: "trophy-outline" as const,
    title: "Personal Record Alerts",
    description: "Real-time PR tracking that celebrates your wins",
  },
  {
    icon: "heart-outline" as const,
    title: "Health Insights",
    description: "Activity, movement, and recovery trends in one place",
  },
  {
    icon: "sparkles-outline" as const,
    title: "Adaptive Plans",
    description: "Recommendations that get smarter with every session",
  },
];

export const PREMIUM_FEATURE_KEYS = [
  "ai_workout",
  "ai_meal_plan",
  "advanced_analytics",
  "advanced_progress",
  "health_insights",
  "custom_macros",
  "unlimited_plans",
] as const;

export type PremiumFeatureKey = (typeof PREMIUM_FEATURE_KEYS)[number];

export const FEATURE_LOCK_MESSAGES: Record<PremiumFeatureKey, string> = {
  ai_workout: "AI-powered workout plans are a Premium feature",
  ai_meal_plan: "AI meal planning is a Premium feature",
  advanced_analytics: "Advanced analytics are a Premium feature",
  advanced_progress: "Detailed progress tracking is a Premium feature",
  health_insights: "Health insights are a Premium feature",
  custom_macros: "Custom macro targets are a Premium feature",
  unlimited_plans: "Unlimited plan generation is a Premium feature",
};

export const PAYWALL_COPY = {
  headline: "Try Everything Free for 15 Days",
  subheadline: "Unlock the tools that turn consistency into real results.",
  trialNote: "No payment now. Full Premium access for 15 days.",
  ctaPrimary: "Start Free Trial",
  ctaSecondary: "Continue with Free",
  ctaRestore: "Restore Purchases",
  trustItems: [
    "No payment required during trial",
    "Cancel anytime",
    "Your progress stays saved",
    "Built for your goals",
  ],
};

export const TRIAL_EXPIRED_COPY = {
  headline: "Your Premium Trial Has Ended",
  body: "Keep your momentum going with unlimited workouts, nutrition guidance, and advanced progress insights.",
  subtext: "You can continue on the Free plan or upgrade anytime.",
  ctaUpgrade: "Upgrade to Premium",
  ctaFree: "Continue with Free",
};

export const FAQ_ITEMS = [
  {
    question: "Can I cancel anytime?",
    answer: "Yes. You can cancel your subscription at any time from your device's app store settings. You'll keep access until the end of your billing period.",
  },
  {
    question: "What happens after the 15-day trial?",
    answer: "After your trial, you'll move to the Free plan. You can upgrade to Premium anytime to unlock all features again.",
  },
  {
    question: "Will I lose my progress if I stay on Free?",
    answer: "No. All your workout history, meal logs, and progress data stay saved. You just won't have access to premium features like AI plans and advanced analytics.",
  },
  {
    question: "How do I restore purchases?",
    answer: "Go to Profile > Subscription and tap 'Restore Purchases'. This will sync any active subscription from your Apple or Google account.",
  },
];
