export interface FoodItem {
  id: string;
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  servingSize: string;
  servingGrams: number;
  dietaryTags?: string[];
}

export const foodCategories = [
  "Proteins",
  "Grains & Cereals",
  "Fruits",
  "Vegetables",
  "Dairy",
  "Snacks & Nuts",
  "Beverages",
  "Prepared Meals",
  "Breads & Bakery",
  "Indian - North",
  "Indian - South",
  "Indian - Street Food",
  "Indian - Sweets",
  "Indian - Beverages",
  "Mexican",
  "Chinese & Asian",
  "Mediterranean",
  "Italian",
  "Japanese",
  "Middle Eastern",
  "American",
  "Supplements",
] as const;

export const foodDatabase: FoodItem[] = [
  // PROTEINS
  { id: "p1", name: "Chicken Breast (grilled)", category: "Proteins", calories: 165, protein: 31, carbs: 0, fats: 3.6, servingSize: "100g", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "p2", name: "Salmon (baked)", category: "Proteins", calories: 208, protein: 20, carbs: 0, fats: 13, servingSize: "100g", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "p3", name: "Eggs (whole, boiled)", category: "Proteins", calories: 155, protein: 13, carbs: 1.1, fats: 11, servingSize: "2 eggs", servingGrams: 100, dietaryTags: ["eggetarian", "non_vegetarian"] },
  { id: "p4", name: "Egg Whites", category: "Proteins", calories: 52, protein: 11, carbs: 0.7, fats: 0.2, servingSize: "3 whites", servingGrams: 100, dietaryTags: ["eggetarian", "non_vegetarian"] },
  { id: "p5", name: "Tuna (canned)", category: "Proteins", calories: 116, protein: 26, carbs: 0, fats: 1, servingSize: "100g", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "p6", name: "Turkey Breast", category: "Proteins", calories: 135, protein: 30, carbs: 0, fats: 1, servingSize: "100g", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "p7", name: "Shrimp", category: "Proteins", calories: 99, protein: 24, carbs: 0.2, fats: 0.3, servingSize: "100g", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "p8", name: "Beef Steak (lean)", category: "Proteins", calories: 271, protein: 26, carbs: 0, fats: 18, servingSize: "100g", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "p9", name: "Ground Beef (lean)", category: "Proteins", calories: 250, protein: 26, carbs: 0, fats: 15, servingSize: "100g", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "p10", name: "Tofu (firm)", category: "Proteins", calories: 144, protein: 17, carbs: 3, fats: 8, servingSize: "100g", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "p11", name: "Paneer", category: "Proteins", calories: 265, protein: 18, carbs: 1.2, fats: 21, servingSize: "100g", servingGrams: 100, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "p12", name: "Chickpeas (cooked)", category: "Proteins", calories: 164, protein: 9, carbs: 27, fats: 2.6, servingSize: "1 cup", servingGrams: 160, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "p13", name: "Lentils (cooked)", category: "Proteins", calories: 116, protein: 9, carbs: 20, fats: 0.4, servingSize: "1 cup", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "p14", name: "Black Beans (cooked)", category: "Proteins", calories: 132, protein: 9, carbs: 24, fats: 0.5, servingSize: "1 cup", servingGrams: 170, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "p15", name: "Whey Protein Shake", category: "Proteins", calories: 120, protein: 24, carbs: 3, fats: 1, servingSize: "1 scoop", servingGrams: 30, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // GRAINS & CEREALS
  { id: "g1", name: "White Rice (cooked)", category: "Grains & Cereals", calories: 130, protein: 2.7, carbs: 28, fats: 0.3, servingSize: "1 cup", servingGrams: 158, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g2", name: "Brown Rice (cooked)", category: "Grains & Cereals", calories: 216, protein: 5, carbs: 45, fats: 1.8, servingSize: "1 cup", servingGrams: 195, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g3", name: "Oatmeal (cooked)", category: "Grains & Cereals", calories: 154, protein: 5, carbs: 27, fats: 2.6, servingSize: "1 cup", servingGrams: 234, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g4", name: "Quinoa (cooked)", category: "Grains & Cereals", calories: 222, protein: 8, carbs: 39, fats: 3.6, servingSize: "1 cup", servingGrams: 185, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g5", name: "Pasta (cooked)", category: "Grains & Cereals", calories: 220, protein: 8, carbs: 43, fats: 1.3, servingSize: "1 cup", servingGrams: 140, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g6", name: "Sweet Potato (baked)", category: "Grains & Cereals", calories: 103, protein: 2.3, carbs: 24, fats: 0.1, servingSize: "1 medium", servingGrams: 114, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g7", name: "Potato (baked)", category: "Grains & Cereals", calories: 161, protein: 4.3, carbs: 37, fats: 0.2, servingSize: "1 medium", servingGrams: 173, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g8", name: "Corn (1 ear)", category: "Grains & Cereals", calories: 88, protein: 3.3, carbs: 19, fats: 1.4, servingSize: "1 ear", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // FRUITS
  { id: "f1", name: "Banana", category: "Fruits", calories: 105, protein: 1.3, carbs: 27, fats: 0.4, servingSize: "1 medium", servingGrams: 118, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f2", name: "Apple", category: "Fruits", calories: 95, protein: 0.5, carbs: 25, fats: 0.3, servingSize: "1 medium", servingGrams: 182, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f3", name: "Orange", category: "Fruits", calories: 62, protein: 1.2, carbs: 15, fats: 0.2, servingSize: "1 medium", servingGrams: 130, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f4", name: "Blueberries", category: "Fruits", calories: 84, protein: 1.1, carbs: 21, fats: 0.5, servingSize: "1 cup", servingGrams: 148, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f5", name: "Strawberries", category: "Fruits", calories: 49, protein: 1, carbs: 12, fats: 0.5, servingSize: "1 cup", servingGrams: 152, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f6", name: "Mango", category: "Fruits", calories: 99, protein: 1.4, carbs: 25, fats: 0.6, servingSize: "1 cup", servingGrams: 165, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f7", name: "Watermelon", category: "Fruits", calories: 46, protein: 0.9, carbs: 12, fats: 0.2, servingSize: "1 cup", servingGrams: 152, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f8", name: "Grapes", category: "Fruits", calories: 104, protein: 1.1, carbs: 27, fats: 0.2, servingSize: "1 cup", servingGrams: 151, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f9", name: "Avocado", category: "Fruits", calories: 240, protein: 3, carbs: 13, fats: 22, servingSize: "1 whole", servingGrams: 150, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f10", name: "Pineapple", category: "Fruits", calories: 82, protein: 0.9, carbs: 22, fats: 0.2, servingSize: "1 cup", servingGrams: 165, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f11", name: "Papaya", category: "Fruits", calories: 55, protein: 0.6, carbs: 14, fats: 0.1, servingSize: "1 cup", servingGrams: 145, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f12", name: "Pomegranate", category: "Fruits", calories: 83, protein: 1.7, carbs: 19, fats: 1.2, servingSize: "1 cup seeds", servingGrams: 174, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // VEGETABLES
  { id: "v1", name: "Broccoli (cooked)", category: "Vegetables", calories: 55, protein: 3.7, carbs: 11, fats: 0.6, servingSize: "1 cup", servingGrams: 156, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v2", name: "Spinach (raw)", category: "Vegetables", calories: 7, protein: 0.9, carbs: 1.1, fats: 0.1, servingSize: "1 cup", servingGrams: 30, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v3", name: "Mixed Salad", category: "Vegetables", calories: 20, protein: 1.5, carbs: 3.5, fats: 0.2, servingSize: "1 bowl", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v4", name: "Carrots", category: "Vegetables", calories: 41, protein: 0.9, carbs: 10, fats: 0.2, servingSize: "1 medium", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v5", name: "Bell Pepper", category: "Vegetables", calories: 31, protein: 1, carbs: 6, fats: 0.3, servingSize: "1 medium", servingGrams: 120, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v6", name: "Cucumber", category: "Vegetables", calories: 16, protein: 0.7, carbs: 3.6, fats: 0.1, servingSize: "1 cup", servingGrams: 104, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v7", name: "Tomato", category: "Vegetables", calories: 22, protein: 1.1, carbs: 4.8, fats: 0.2, servingSize: "1 medium", servingGrams: 123, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v8", name: "Cauliflower", category: "Vegetables", calories: 25, protein: 2, carbs: 5, fats: 0.1, servingSize: "1 cup", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v9", name: "Kale (raw)", category: "Vegetables", calories: 33, protein: 2.9, carbs: 6, fats: 0.5, servingSize: "1 cup", servingGrams: 67, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v10", name: "Zucchini", category: "Vegetables", calories: 17, protein: 1.2, carbs: 3.1, fats: 0.3, servingSize: "1 cup", servingGrams: 113, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // DAIRY
  { id: "d1", name: "Greek Yogurt (plain)", category: "Dairy", calories: 100, protein: 17, carbs: 6, fats: 0.7, servingSize: "1 cup", servingGrams: 170, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "d2", name: "Whole Milk", category: "Dairy", calories: 149, protein: 8, carbs: 12, fats: 8, servingSize: "1 cup", servingGrams: 244, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "d3", name: "Skim Milk", category: "Dairy", calories: 83, protein: 8, carbs: 12, fats: 0.2, servingSize: "1 cup", servingGrams: 245, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "d4", name: "Cottage Cheese", category: "Dairy", calories: 163, protein: 28, carbs: 6, fats: 2.3, servingSize: "1 cup", servingGrams: 226, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "d5", name: "Cheddar Cheese", category: "Dairy", calories: 113, protein: 7, carbs: 0.4, fats: 9, servingSize: "1 slice", servingGrams: 28, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "d6", name: "Mozzarella", category: "Dairy", calories: 85, protein: 6, carbs: 0.7, fats: 6, servingSize: "1 slice", servingGrams: 28, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // SNACKS & NUTS
  { id: "n1", name: "Almonds", category: "Snacks & Nuts", calories: 164, protein: 6, carbs: 6, fats: 14, servingSize: "28g (23 nuts)", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n2", name: "Peanut Butter", category: "Snacks & Nuts", calories: 188, protein: 8, carbs: 6, fats: 16, servingSize: "2 tbsp", servingGrams: 32, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n3", name: "Walnuts", category: "Snacks & Nuts", calories: 185, protein: 4.3, carbs: 3.9, fats: 18, servingSize: "28g", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n4", name: "Cashews", category: "Snacks & Nuts", calories: 157, protein: 5, carbs: 9, fats: 12, servingSize: "28g", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n5", name: "Trail Mix", category: "Snacks & Nuts", calories: 462, protein: 14, carbs: 44, fats: 29, servingSize: "100g", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n6", name: "Dark Chocolate (70%)", category: "Snacks & Nuts", calories: 170, protein: 2, carbs: 13, fats: 12, servingSize: "30g", servingGrams: 30, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n7", name: "Rice Cakes", category: "Snacks & Nuts", calories: 35, protein: 0.7, carbs: 7.3, fats: 0.3, servingSize: "1 cake", servingGrams: 9, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n8", name: "Protein Bar", category: "Snacks & Nuts", calories: 210, protein: 20, carbs: 22, fats: 7, servingSize: "1 bar", servingGrams: 60, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "n9", name: "Peanuts (roasted)", category: "Snacks & Nuts", calories: 166, protein: 7, carbs: 6, fats: 14, servingSize: "28g", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n10", name: "Pistachios", category: "Snacks & Nuts", calories: 159, protein: 6, carbs: 8, fats: 13, servingSize: "28g", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // BEVERAGES
  { id: "b1", name: "Black Coffee", category: "Beverages", calories: 2, protein: 0.3, carbs: 0, fats: 0, servingSize: "1 cup", servingGrams: 240, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "b2", name: "Green Tea", category: "Beverages", calories: 2, protein: 0, carbs: 0.5, fats: 0, servingSize: "1 cup", servingGrams: 240, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "b3", name: "Orange Juice", category: "Beverages", calories: 112, protein: 1.7, carbs: 26, fats: 0.5, servingSize: "1 cup", servingGrams: 248, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "b4", name: "Coconut Water", category: "Beverages", calories: 46, protein: 1.7, carbs: 9, fats: 0.5, servingSize: "1 cup", servingGrams: 240, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "b5", name: "Protein Shake (whey)", category: "Beverages", calories: 160, protein: 30, carbs: 5, fats: 2, servingSize: "1 shake", servingGrams: 300, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "b6", name: "Almond Milk", category: "Beverages", calories: 39, protein: 1, carbs: 3.4, fats: 2.5, servingSize: "1 cup", servingGrams: 240, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // PREPARED MEALS
  { id: "m1", name: "Grilled Chicken Salad", category: "Prepared Meals", calories: 350, protein: 35, carbs: 15, fats: 16, servingSize: "1 bowl", servingGrams: 300, dietaryTags: ["non_vegetarian"] },
  { id: "m2", name: "Chicken & Rice Bowl", category: "Prepared Meals", calories: 480, protein: 35, carbs: 55, fats: 10, servingSize: "1 bowl", servingGrams: 400, dietaryTags: ["non_vegetarian"] },
  { id: "m3", name: "Turkey Sandwich", category: "Prepared Meals", calories: 320, protein: 22, carbs: 38, fats: 8, servingSize: "1 sandwich", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "m4", name: "Burrito Bowl", category: "Prepared Meals", calories: 520, protein: 28, carbs: 60, fats: 18, servingSize: "1 bowl", servingGrams: 450, dietaryTags: ["non_vegetarian"] },
  { id: "m5", name: "Stir-fry Tofu & Veggies", category: "Prepared Meals", calories: 280, protein: 18, carbs: 25, fats: 12, servingSize: "1 plate", servingGrams: 350, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "m6", name: "Salmon & Vegetables", category: "Prepared Meals", calories: 380, protein: 32, carbs: 12, fats: 22, servingSize: "1 plate", servingGrams: 350, dietaryTags: ["non_vegetarian"] },
  { id: "m7", name: "Pasta with Meat Sauce", category: "Prepared Meals", calories: 450, protein: 22, carbs: 58, fats: 14, servingSize: "1 plate", servingGrams: 350, dietaryTags: ["non_vegetarian"] },
  { id: "m8", name: "Caesar Salad", category: "Prepared Meals", calories: 320, protein: 8, carbs: 14, fats: 26, servingSize: "1 bowl", servingGrams: 250, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // BREADS & BAKERY
  { id: "br1", name: "Whole Wheat Bread", category: "Breads & Bakery", calories: 69, protein: 3.6, carbs: 12, fats: 1.1, servingSize: "1 slice", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "br2", name: "White Bread", category: "Breads & Bakery", calories: 79, protein: 2.7, carbs: 15, fats: 1, servingSize: "1 slice", servingGrams: 30, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "br3", name: "Bagel", category: "Breads & Bakery", calories: 245, protein: 10, carbs: 48, fats: 1.5, servingSize: "1 bagel", servingGrams: 98, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "br4", name: "Tortilla (flour)", category: "Breads & Bakery", calories: 146, protein: 4, carbs: 25, fats: 3.5, servingSize: "1 tortilla", servingGrams: 49, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "br5", name: "Croissant", category: "Breads & Bakery", calories: 231, protein: 5, carbs: 26, fats: 12, servingSize: "1 piece", servingGrams: 57, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // INDIAN - NORTH
  { id: "in1", name: "Dal Tadka", category: "Indian - North", calories: 150, protein: 9, carbs: 22, fats: 3, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "in2", name: "Dal Makhani", category: "Indian - North", calories: 185, protein: 10, carbs: 25, fats: 6, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in3", name: "Roti / Chapati", category: "Indian - North", calories: 104, protein: 3, carbs: 18, fats: 3, servingSize: "1 roti", servingGrams: 40, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "in4", name: "Butter Naan", category: "Indian - North", calories: 317, protein: 9, carbs: 55, fats: 8, servingSize: "1 naan", servingGrams: 110, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in5", name: "Plain Paratha", category: "Indian - North", calories: 215, protein: 5, carbs: 28, fats: 10, servingSize: "1 paratha", servingGrams: 80, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in6", name: "Aloo Paratha", category: "Indian - North", calories: 260, protein: 6, carbs: 35, fats: 11, servingSize: "1 paratha", servingGrams: 100, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in7", name: "Butter Chicken", category: "Indian - North", calories: 240, protein: 18, carbs: 8, fats: 15, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "in8", name: "Paneer Butter Masala", category: "Indian - North", calories: 320, protein: 15, carbs: 14, fats: 24, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in9", name: "Palak Paneer", category: "Indian - North", calories: 200, protein: 12, carbs: 10, fats: 14, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in10", name: "Aloo Gobi", category: "Indian - North", calories: 150, protein: 5, carbs: 22, fats: 6, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "in11", name: "Rajma (Kidney Bean Curry)", category: "Indian - North", calories: 180, protein: 10, carbs: 28, fats: 3, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "in12", name: "Chole / Chana Masala", category: "Indian - North", calories: 210, protein: 10, carbs: 30, fats: 6, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "in13", name: "Rajma Chawal", category: "Indian - North", calories: 420, protein: 16, carbs: 72, fats: 6, servingSize: "1 plate", servingGrams: 350, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "in14", name: "Chole Bhature", category: "Indian - North", calories: 480, protein: 16, carbs: 65, fats: 18, servingSize: "1 plate", servingGrams: 350, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in15", name: "Tandoori Chicken", category: "Indian - North", calories: 195, protein: 28, carbs: 6, fats: 7, servingSize: "2 pieces", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "in16", name: "Biryani (Chicken)", category: "Indian - North", calories: 350, protein: 18, carbs: 45, fats: 10, servingSize: "1 plate", servingGrams: 300, dietaryTags: ["non_vegetarian"] },
  { id: "in17", name: "Biryani (Veg)", category: "Indian - North", calories: 290, protein: 8, carbs: 48, fats: 8, servingSize: "1 plate", servingGrams: 300, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in18", name: "Matar Paneer", category: "Indian - North", calories: 240, protein: 12, carbs: 16, fats: 15, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in19", name: "Shahi Paneer", category: "Indian - North", calories: 350, protein: 14, carbs: 15, fats: 27, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in20", name: "Kadai Chicken", category: "Indian - North", calories: 280, protein: 26, carbs: 10, fats: 16, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "in21", name: "Mutton Curry", category: "Indian - North", calories: 320, protein: 28, carbs: 8, fats: 20, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "in22", name: "Jeera Rice", category: "Indian - North", calories: 200, protein: 4, carbs: 38, fats: 5, servingSize: "1 cup", servingGrams: 175, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // INDIAN - SOUTH
  { id: "is1", name: "Idli", category: "Indian - South", calories: 39, protein: 2, carbs: 8, fats: 0.2, servingSize: "1 piece", servingGrams: 30, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "is2", name: "Dosa (Plain)", category: "Indian - South", calories: 120, protein: 3, carbs: 18, fats: 4, servingSize: "1 dosa", servingGrams: 80, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "is3", name: "Masala Dosa", category: "Indian - South", calories: 200, protein: 5, carbs: 28, fats: 8, servingSize: "1 dosa", servingGrams: 130, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "is4", name: "Rava Dosa", category: "Indian - South", calories: 175, protein: 4, carbs: 24, fats: 7, servingSize: "1 dosa", servingGrams: 100, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "is5", name: "Uttapam", category: "Indian - South", calories: 185, protein: 5, carbs: 26, fats: 7, servingSize: "1 piece", servingGrams: 110, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "is6", name: "Sambar", category: "Indian - South", calories: 90, protein: 5, carbs: 14, fats: 2, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "is7", name: "Rasam", category: "Indian - South", calories: 50, protein: 2, carbs: 8, fats: 1.5, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "is8", name: "Upma", category: "Indian - South", calories: 180, protein: 4, carbs: 28, fats: 6, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "is9", name: "Pongal (Ven Pongal)", category: "Indian - South", calories: 210, protein: 6, carbs: 34, fats: 7, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "is10", name: "Appam", category: "Indian - South", calories: 80, protein: 2, carbs: 15, fats: 2, servingSize: "1 piece", servingGrams: 60, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "is11", name: "Puttu", category: "Indian - South", calories: 160, protein: 3, carbs: 32, fats: 2, servingSize: "1 serving", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "is12", name: "Avial", category: "Indian - South", calories: 130, protein: 3, carbs: 15, fats: 7, servingSize: "1 serving", servingGrams: 180, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "is13", name: "Vada (Medu Vada)", category: "Indian - South", calories: 110, protein: 4, carbs: 14, fats: 5, servingSize: "1 piece", servingGrams: 50, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "is14", name: "Coconut Chutney", category: "Indian - South", calories: 60, protein: 1.5, carbs: 4, fats: 5, servingSize: "2 tbsp", servingGrams: 40, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "is15", name: "Kerala Fish Curry", category: "Indian - South", calories: 200, protein: 20, carbs: 6, fats: 11, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "is16", name: "Pesarattu", category: "Indian - South", calories: 140, protein: 7, carbs: 20, fats: 4, servingSize: "1 piece", servingGrams: 80, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // INDIAN - STREET FOOD
  { id: "isf1", name: "Samosa", category: "Indian - Street Food", calories: 260, protein: 5, carbs: 32, fats: 13, servingSize: "1 piece", servingGrams: 100, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf2", name: "Pav Bhaji", category: "Indian - Street Food", calories: 380, protein: 10, carbs: 52, fats: 16, servingSize: "1 plate", servingGrams: 280, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf3", name: "Vada Pav", category: "Indian - Street Food", calories: 290, protein: 7, carbs: 42, fats: 11, servingSize: "1 piece", servingGrams: 150, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf4", name: "Bhel Puri", category: "Indian - Street Food", calories: 200, protein: 5, carbs: 38, fats: 4, servingSize: "1 bowl", servingGrams: 180, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "isf5", name: "Sev Puri", category: "Indian - Street Food", calories: 230, protein: 5, carbs: 32, fats: 10, servingSize: "4 pieces", servingGrams: 140, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf6", name: "Pani Puri / Golgappa", category: "Indian - Street Food", calories: 170, protein: 3, carbs: 28, fats: 6, servingSize: "6 pieces", servingGrams: 130, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "isf7", name: "Kachori", category: "Indian - Street Food", calories: 240, protein: 6, carbs: 28, fats: 12, servingSize: "1 piece", servingGrams: 90, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf8", name: "Dhokla", category: "Indian - Street Food", calories: 130, protein: 6, carbs: 22, fats: 3, servingSize: "4 pieces", servingGrams: 120, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "isf9", name: "Aloo Tikki", category: "Indian - Street Food", calories: 190, protein: 4, carbs: 28, fats: 8, servingSize: "2 pieces", servingGrams: 130, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf10", name: "Dahi Vada", category: "Indian - Street Food", calories: 200, protein: 8, carbs: 26, fats: 7, servingSize: "2 pieces", servingGrams: 180, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf11", name: "Poha", category: "Indian - Street Food", calories: 160, protein: 3, carbs: 30, fats: 4, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf12", name: "Kanda Poha", category: "Indian - Street Food", calories: 180, protein: 4, carbs: 32, fats: 5, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // INDIAN - SWEETS & DESSERTS
  { id: "isd1", name: "Gulab Jamun", category: "Indian - Sweets", calories: 150, protein: 3, carbs: 26, fats: 5, servingSize: "2 pieces", servingGrams: 80, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd2", name: "Rasgulla", category: "Indian - Sweets", calories: 110, protein: 4, carbs: 22, fats: 1.5, servingSize: "2 pieces", servingGrams: 90, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd3", name: "Kheer (Rice Pudding)", category: "Indian - Sweets", calories: 180, protein: 5, carbs: 32, fats: 5, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd4", name: "Gajar Halwa", category: "Indian - Sweets", calories: 250, protein: 5, carbs: 38, fats: 10, servingSize: "1 serving", servingGrams: 150, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd5", name: "Besan Ladoo", category: "Indian - Sweets", calories: 130, protein: 3, carbs: 18, fats: 6, servingSize: "1 piece", servingGrams: 45, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd6", name: "Motichoor Ladoo", category: "Indian - Sweets", calories: 120, protein: 2, carbs: 20, fats: 5, servingSize: "1 piece", servingGrams: 40, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd7", name: "Jalebi", category: "Indian - Sweets", calories: 150, protein: 1, carbs: 30, fats: 5, servingSize: "2 pieces", servingGrams: 60, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd8", name: "Barfi (Milk Burfi)", category: "Indian - Sweets", calories: 135, protein: 4, carbs: 20, fats: 5, servingSize: "1 piece", servingGrams: 45, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd9", name: "Ras Malai", category: "Indian - Sweets", calories: 160, protein: 6, carbs: 24, fats: 5, servingSize: "2 pieces", servingGrams: 120, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd10", name: "Shrikhand", category: "Indian - Sweets", calories: 170, protein: 7, carbs: 28, fats: 4, servingSize: "1 bowl", servingGrams: 150, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // INDIAN - BEVERAGES
  { id: "ibv1", name: "Masala Chai", category: "Indian - Beverages", calories: 60, protein: 2, carbs: 10, fats: 2, servingSize: "1 cup", servingGrams: 180, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "ibv2", name: "Sweet Lassi", category: "Indian - Beverages", calories: 180, protein: 7, carbs: 32, fats: 3, servingSize: "1 glass", servingGrams: 250, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "ibv3", name: "Salted Lassi", category: "Indian - Beverages", calories: 100, protein: 7, carbs: 10, fats: 3, servingSize: "1 glass", servingGrams: 250, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "ibv4", name: "Mango Lassi", category: "Indian - Beverages", calories: 210, protein: 7, carbs: 40, fats: 3, servingSize: "1 glass", servingGrams: 300, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "ibv5", name: "Buttermilk / Chaas", category: "Indian - Beverages", calories: 40, protein: 3, carbs: 4, fats: 1, servingSize: "1 glass", servingGrams: 240, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "ibv6", name: "Rose Milk", category: "Indian - Beverages", calories: 130, protein: 4, carbs: 24, fats: 3, servingSize: "1 glass", servingGrams: 250, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "ibv7", name: "Jal Jeera", category: "Indian - Beverages", calories: 25, protein: 0.5, carbs: 6, fats: 0.2, servingSize: "1 glass", servingGrams: 250, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MEXICAN
  { id: "mx1", name: "Chicken Tacos", category: "Mexican", calories: 340, protein: 22, carbs: 32, fats: 12, servingSize: "2 tacos", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "mx2", name: "Bean & Cheese Burrito", category: "Mexican", calories: 450, protein: 18, carbs: 60, fats: 14, servingSize: "1 burrito", servingGrams: 310, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "mx3", name: "Guacamole", category: "Mexican", calories: 120, protein: 1.5, carbs: 7, fats: 11, servingSize: "1/4 cup", servingGrams: 60, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "mx4", name: "Salsa (fresh)", category: "Mexican", calories: 20, protein: 1, carbs: 4, fats: 0.2, servingSize: "1/4 cup", servingGrams: 60, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "mx5", name: "Nachos with Cheese", category: "Mexican", calories: 480, protein: 12, carbs: 50, fats: 28, servingSize: "1 plate", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "mx6", name: "Beef Burrito Bowl", category: "Mexican", calories: 550, protein: 32, carbs: 55, fats: 22, servingSize: "1 bowl", servingGrams: 420, dietaryTags: ["non_vegetarian"] },
  { id: "mx7", name: "Quesadilla (cheese)", category: "Mexican", calories: 380, protein: 15, carbs: 38, fats: 20, servingSize: "1 piece", servingGrams: 180, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "mx8", name: "Chicken Enchiladas", category: "Mexican", calories: 420, protein: 26, carbs: 42, fats: 16, servingSize: "2 pieces", servingGrams: 300, dietaryTags: ["non_vegetarian"] },
  { id: "mx9", name: "Black Bean Soup", category: "Mexican", calories: 220, protein: 12, carbs: 36, fats: 3, servingSize: "1 bowl", servingGrams: 280, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "mx10", name: "Corn Tortilla Chips", category: "Mexican", calories: 140, protein: 2, carbs: 19, fats: 7, servingSize: "28g", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "mx11", name: "Elote (Mexican Street Corn)", category: "Mexican", calories: 230, protein: 5, carbs: 30, fats: 11, servingSize: "1 ear", servingGrams: 160, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "mx12", name: "Carnitas Bowl", category: "Mexican", calories: 490, protein: 30, carbs: 48, fats: 18, servingSize: "1 bowl", servingGrams: 380, dietaryTags: ["non_vegetarian"] },

  // CHINESE & ASIAN
  { id: "ca1", name: "Fried Rice (egg)", category: "Chinese & Asian", calories: 360, protein: 12, carbs: 58, fats: 10, servingSize: "1 cup", servingGrams: 250, dietaryTags: ["eggetarian", "non_vegetarian"] },
  { id: "ca2", name: "Vegetable Fried Rice", category: "Chinese & Asian", calories: 280, protein: 7, carbs: 52, fats: 7, servingSize: "1 cup", servingGrams: 250, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "ca3", name: "Chow Mein", category: "Chinese & Asian", calories: 400, protein: 16, carbs: 60, fats: 12, servingSize: "1 plate", servingGrams: 300, dietaryTags: ["non_vegetarian"] },
  { id: "ca4", name: "Kung Pao Chicken", category: "Chinese & Asian", calories: 370, protein: 28, carbs: 22, fats: 18, servingSize: "1 serving", servingGrams: 280, dietaryTags: ["non_vegetarian"] },
  { id: "ca5", name: "Mapo Tofu", category: "Chinese & Asian", calories: 280, protein: 18, carbs: 10, fats: 18, servingSize: "1 serving", servingGrams: 250, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "ca6", name: "Spring Rolls (vegetable)", category: "Chinese & Asian", calories: 100, protein: 3, carbs: 14, fats: 4, servingSize: "1 roll", servingGrams: 50, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "ca7", name: "Dim Sum (steamed)", category: "Chinese & Asian", calories: 210, protein: 12, carbs: 22, fats: 8, servingSize: "3 pieces", servingGrams: 120, dietaryTags: ["non_vegetarian"] },
  { id: "ca8", name: "Pad Thai (chicken)", category: "Chinese & Asian", calories: 430, protein: 28, carbs: 52, fats: 12, servingSize: "1 plate", servingGrams: 350, dietaryTags: ["non_vegetarian"] },
  { id: "ca9", name: "Pad Thai (tofu)", category: "Chinese & Asian", calories: 380, protein: 18, carbs: 52, fats: 12, servingSize: "1 plate", servingGrams: 350, dietaryTags: ["vegetarian", "vegan", "eggetarian"] },
  { id: "ca10", name: "Tom Yum Soup", category: "Chinese & Asian", calories: 100, protein: 9, carbs: 8, fats: 3, servingSize: "1 bowl", servingGrams: 300, dietaryTags: ["non_vegetarian"] },
  { id: "ca11", name: "Green Curry with Chicken", category: "Chinese & Asian", calories: 350, protein: 26, carbs: 12, fats: 22, servingSize: "1 serving", servingGrams: 280, dietaryTags: ["non_vegetarian"] },
  { id: "ca12", name: "Bibimbap", category: "Chinese & Asian", calories: 490, protein: 22, carbs: 68, fats: 14, servingSize: "1 bowl", servingGrams: 380, dietaryTags: ["eggetarian", "non_vegetarian"] },

  // MEDITERRANEAN
  { id: "med1", name: "Hummus", category: "Mediterranean", calories: 140, protein: 6, carbs: 14, fats: 8, servingSize: "1/4 cup", servingGrams: 60, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "med2", name: "Falafel", category: "Mediterranean", calories: 330, protein: 13, carbs: 32, fats: 18, servingSize: "4 pieces", servingGrams: 150, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "med3", name: "Greek Salad", category: "Mediterranean", calories: 180, protein: 6, carbs: 10, fats: 14, servingSize: "1 bowl", servingGrams: 250, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "med4", name: "Shawarma (chicken)", category: "Mediterranean", calories: 420, protein: 30, carbs: 35, fats: 16, servingSize: "1 wrap", servingGrams: 280, dietaryTags: ["non_vegetarian"] },
  { id: "med5", name: "Tabbouleh", category: "Mediterranean", calories: 130, protein: 4, carbs: 20, fats: 5, servingSize: "1 cup", servingGrams: 180, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "med6", name: "Tzatziki", category: "Mediterranean", calories: 90, protein: 5, carbs: 6, fats: 5, servingSize: "1/4 cup", servingGrams: 70, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "med7", name: "Grilled Fish with Lemon", category: "Mediterranean", calories: 240, protein: 36, carbs: 2, fats: 10, servingSize: "1 fillet", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "med8", name: "Pita Bread", category: "Mediterranean", calories: 165, protein: 6, carbs: 33, fats: 1, servingSize: "1 pita", servingGrams: 60, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "med9", name: "Lentil Soup (Lebanese)", category: "Mediterranean", calories: 180, protein: 10, carbs: 28, fats: 4, servingSize: "1 bowl", servingGrams: 280, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "med10", name: "Baba Ganoush", category: "Mediterranean", calories: 100, protein: 3, carbs: 8, fats: 6, servingSize: "1/4 cup", servingGrams: 70, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "med11", name: "Moussaka", category: "Mediterranean", calories: 380, protein: 18, carbs: 30, fats: 22, servingSize: "1 serving", servingGrams: 280, dietaryTags: ["non_vegetarian"] },

  // ITALIAN
  { id: "it1", name: "Margherita Pizza (2 slices)", category: "Italian", calories: 480, protein: 20, carbs: 62, fats: 16, servingSize: "2 slices", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "it2", name: "Spaghetti Bolognese", category: "Italian", calories: 520, protein: 26, carbs: 58, fats: 18, servingSize: "1 plate", servingGrams: 360, dietaryTags: ["non_vegetarian"] },
  { id: "it3", name: "Pasta Aglio e Olio", category: "Italian", calories: 380, protein: 11, carbs: 55, fats: 14, servingSize: "1 plate", servingGrams: 280, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "it4", name: "Risotto (mushroom)", category: "Italian", calories: 350, protein: 10, carbs: 52, fats: 12, servingSize: "1 bowl", servingGrams: 300, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "it5", name: "Lasagne (meat)", category: "Italian", calories: 430, protein: 22, carbs: 38, fats: 22, servingSize: "1 serving", servingGrams: 280, dietaryTags: ["non_vegetarian"] },
  { id: "it6", name: "Caprese Salad", category: "Italian", calories: 220, protein: 12, carbs: 6, fats: 16, servingSize: "1 plate", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "it7", name: "Tiramisu", category: "Italian", calories: 280, protein: 6, carbs: 30, fats: 15, servingSize: "1 slice", servingGrams: 120, dietaryTags: ["eggetarian"] },
  { id: "it8", name: "Focaccia Bread", category: "Italian", calories: 200, protein: 5, carbs: 30, fats: 7, servingSize: "1 slice", servingGrams: 80, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "it9", name: "Penne Arrabbiata", category: "Italian", calories: 340, protein: 11, carbs: 60, fats: 7, servingSize: "1 plate", servingGrams: 300, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "it10", name: "Chicken Parmigiana", category: "Italian", calories: 490, protein: 40, carbs: 25, fats: 24, servingSize: "1 serving", servingGrams: 320, dietaryTags: ["non_vegetarian"] },
  { id: "it11", name: "Minestrone Soup", category: "Italian", calories: 130, protein: 6, carbs: 22, fats: 3, servingSize: "1 bowl", servingGrams: 280, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // JAPANESE
  { id: "jp1", name: "Salmon Sushi (6 pcs)", category: "Japanese", calories: 280, protein: 18, carbs: 40, fats: 6, servingSize: "6 pieces", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "jp2", name: "Vegetable Sushi Roll", category: "Japanese", calories: 200, protein: 5, carbs: 42, fats: 2, servingSize: "6 pieces", servingGrams: 180, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "jp3", name: "Miso Soup", category: "Japanese", calories: 40, protein: 3, carbs: 5, fats: 1.5, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "jp4", name: "Chicken Teriyaki", category: "Japanese", calories: 310, protein: 28, carbs: 22, fats: 10, servingSize: "1 serving", servingGrams: 230, dietaryTags: ["non_vegetarian"] },
  { id: "jp5", name: "Ramen (chicken broth)", category: "Japanese", calories: 430, protein: 22, carbs: 58, fats: 12, servingSize: "1 bowl", servingGrams: 450, dietaryTags: ["non_vegetarian"] },
  { id: "jp6", name: "Edamame", category: "Japanese", calories: 120, protein: 11, carbs: 10, fats: 5, servingSize: "1 cup", servingGrams: 155, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "jp7", name: "Onigiri (tuna)", category: "Japanese", calories: 180, protein: 8, carbs: 32, fats: 2.5, servingSize: "1 piece", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "jp8", name: "Tofu Miso Soup", category: "Japanese", calories: 70, protein: 5, carbs: 5, fats: 3, servingSize: "1 bowl", servingGrams: 220, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "jp9", name: "Yakitori (chicken skewer)", category: "Japanese", calories: 180, protein: 18, carbs: 8, fats: 8, servingSize: "2 skewers", servingGrams: 120, dietaryTags: ["non_vegetarian"] },
  { id: "jp10", name: "Gyoza (pork dumplings)", category: "Japanese", calories: 210, protein: 12, carbs: 22, fats: 8, servingSize: "6 pieces", servingGrams: 150, dietaryTags: ["non_vegetarian"] },
  { id: "jp11", name: "Tempura Vegetables", category: "Japanese", calories: 260, protein: 4, carbs: 32, fats: 13, servingSize: "1 serving", servingGrams: 180, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MIDDLE EASTERN
  { id: "me1", name: "Kebab (chicken)", category: "Middle Eastern", calories: 240, protein: 30, carbs: 4, fats: 12, servingSize: "1 skewer", servingGrams: 150, dietaryTags: ["non_vegetarian"] },
  { id: "me2", name: "Lamb Kofta", category: "Middle Eastern", calories: 290, protein: 22, carbs: 6, fats: 20, servingSize: "2 pieces", servingGrams: 150, dietaryTags: ["non_vegetarian"] },
  { id: "me3", name: "Fattoush Salad", category: "Middle Eastern", calories: 160, protein: 4, carbs: 22, fats: 7, servingSize: "1 bowl", servingGrams: 220, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "me4", name: "Dolma (stuffed grape leaves)", category: "Middle Eastern", calories: 180, protein: 5, carbs: 28, fats: 6, servingSize: "4 pieces", servingGrams: 160, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "me5", name: "Shakshuka", category: "Middle Eastern", calories: 220, protein: 14, carbs: 16, fats: 12, servingSize: "1 serving", servingGrams: 250, dietaryTags: ["eggetarian", "non_vegetarian"] },
  { id: "me6", name: "Couscous with Veggies", category: "Middle Eastern", calories: 290, protein: 9, carbs: 52, fats: 6, servingSize: "1 plate", servingGrams: 280, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "me7", name: "Lentil Kibbeh", category: "Middle Eastern", calories: 230, protein: 10, carbs: 38, fats: 6, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "me8", name: "Manakish (za'atar bread)", category: "Middle Eastern", calories: 280, protein: 7, carbs: 38, fats: 12, servingSize: "1 piece", servingGrams: 120, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "me9", name: "Mutton Biryani (Arabic style)", category: "Middle Eastern", calories: 420, protein: 24, carbs: 50, fats: 15, servingSize: "1 plate", servingGrams: 350, dietaryTags: ["non_vegetarian"] },
  { id: "me10", name: "Halloumi Salad", category: "Middle Eastern", calories: 310, protein: 15, carbs: 10, fats: 24, servingSize: "1 bowl", servingGrams: 250, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "me11", name: "Lupin Bean Snack", category: "Middle Eastern", calories: 100, protein: 12, carbs: 8, fats: 2, servingSize: "1/4 cup", servingGrams: 60, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // AMERICAN
  { id: "am1", name: "Classic Burger", category: "American", calories: 540, protein: 28, carbs: 42, fats: 28, servingSize: "1 burger", servingGrams: 250, dietaryTags: ["non_vegetarian"] },
  { id: "am2", name: "Veggie Burger", category: "American", calories: 400, protein: 16, carbs: 48, fats: 16, servingSize: "1 burger", servingGrams: 220, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "am3", name: "Mac & Cheese", category: "American", calories: 380, protein: 14, carbs: 50, fats: 14, servingSize: "1 cup", servingGrams: 230, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "am4", name: "BBQ Ribs", category: "American", calories: 580, protein: 40, carbs: 20, fats: 38, servingSize: "1 rack (small)", servingGrams: 280, dietaryTags: ["non_vegetarian"] },
  { id: "am5", name: "Pancakes (3 medium)", category: "American", calories: 360, protein: 10, carbs: 60, fats: 9, servingSize: "3 pancakes", servingGrams: 210, dietaryTags: ["eggetarian", "non_vegetarian"] },
  { id: "am6", name: "French Fries", category: "American", calories: 365, protein: 4, carbs: 48, fats: 17, servingSize: "medium serving", servingGrams: 154, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "am7", name: "Clam Chowder", category: "American", calories: 280, protein: 12, carbs: 26, fats: 14, servingSize: "1 bowl", servingGrams: 280, dietaryTags: ["non_vegetarian"] },
  { id: "am8", name: "BLT Sandwich", category: "American", calories: 390, protein: 18, carbs: 36, fats: 20, servingSize: "1 sandwich", servingGrams: 220, dietaryTags: ["non_vegetarian"] },
  { id: "am9", name: "Buffalo Wings", category: "American", calories: 420, protein: 30, carbs: 8, fats: 30, servingSize: "6 wings", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "am10", name: "Coleslaw", category: "American", calories: 150, protein: 1.5, carbs: 18, fats: 8, servingSize: "1 cup", servingGrams: 150, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "am11", name: "Corn Dog", category: "American", calories: 260, protein: 8, carbs: 28, fats: 13, servingSize: "1 piece", servingGrams: 110, dietaryTags: ["non_vegetarian"] },
  { id: "am12", name: "Grilled Cheese Sandwich", category: "American", calories: 340, protein: 12, carbs: 30, fats: 20, servingSize: "1 sandwich", servingGrams: 165, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MORE PROTEINS
  { id: "p16", name: "Sardines (canned)", category: "Proteins", calories: 191, protein: 23, carbs: 0, fats: 11, servingSize: "100g", servingGrams: 100, dietaryTags: ["non_vegetarian"] },
  { id: "p17", name: "Tempeh", category: "Proteins", calories: 193, protein: 19, carbs: 10, fats: 11, servingSize: "100g", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "p18", name: "Soya Chunks (cooked)", category: "Proteins", calories: 150, protein: 25, carbs: 10, fats: 2, servingSize: "100g", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "p19", name: "Moong Dal (cooked)", category: "Proteins", calories: 100, protein: 7, carbs: 18, fats: 0.4, servingSize: "1 cup", servingGrams: 200, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "p20", name: "Kidney Beans (cooked)", category: "Proteins", calories: 140, protein: 9, carbs: 24, fats: 0.5, servingSize: "1 cup", servingGrams: 170, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE GRAINS & CEREALS
  { id: "g9", name: "Barley (cooked)", category: "Grains & Cereals", calories: 193, protein: 3.5, carbs: 44, fats: 0.7, servingSize: "1 cup", servingGrams: 157, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g10", name: "Bulgur Wheat (cooked)", category: "Grains & Cereals", calories: 151, protein: 5.6, carbs: 34, fats: 0.4, servingSize: "1 cup", servingGrams: 182, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g11", name: "Bajra Roti", category: "Grains & Cereals", calories: 120, protein: 3.5, carbs: 22, fats: 2.5, servingSize: "1 roti", servingGrams: 50, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "g12", name: "Jowar Roti", category: "Grains & Cereals", calories: 110, protein: 3, carbs: 21, fats: 2, servingSize: "1 roti", servingGrams: 50, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE VEGETABLES
  { id: "v11", name: "Beetroot", category: "Vegetables", calories: 43, protein: 1.6, carbs: 10, fats: 0.2, servingSize: "1 medium", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v12", name: "Bitter Gourd (Karela)", category: "Vegetables", calories: 17, protein: 1, carbs: 3.5, fats: 0.2, servingSize: "1 cup", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v13", name: "Bottle Gourd (Lauki)", category: "Vegetables", calories: 14, protein: 0.6, carbs: 3, fats: 0.1, servingSize: "1 cup", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v14", name: "Drumstick (Moringa)", category: "Vegetables", calories: 37, protein: 2.1, carbs: 8, fats: 0.2, servingSize: "3 pods", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "v15", name: "Green Beans", category: "Vegetables", calories: 31, protein: 1.8, carbs: 7, fats: 0.1, servingSize: "1 cup", servingGrams: 110, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE DAIRY
  { id: "d7", name: "Buttermilk (low-fat)", category: "Dairy", calories: 98, protein: 8, carbs: 12, fats: 2.2, servingSize: "1 cup", servingGrams: 245, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "d8", name: "Dahi (Curd)", category: "Dairy", calories: 98, protein: 5, carbs: 7, fats: 5, servingSize: "1 cup", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "d9", name: "Paneer (low-fat)", category: "Dairy", calories: 180, protein: 20, carbs: 4, fats: 10, servingSize: "100g", servingGrams: 100, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MORE FRUITS
  { id: "f13", name: "Guava", category: "Fruits", calories: 68, protein: 2.6, carbs: 14, fats: 1, servingSize: "1 medium", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f14", name: "Lychee", category: "Fruits", calories: 66, protein: 0.8, carbs: 17, fats: 0.4, servingSize: "1 cup", servingGrams: 190, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f15", name: "Chikoo (Sapodilla)", category: "Fruits", calories: 83, protein: 0.4, carbs: 20, fats: 1, servingSize: "1 medium", servingGrams: 100, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f16", name: "Dates (dried)", category: "Fruits", calories: 277, protein: 1.8, carbs: 75, fats: 0.2, servingSize: "3 dates", servingGrams: 45, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "f17", name: "Jackfruit (raw)", category: "Fruits", calories: 95, protein: 1.7, carbs: 24, fats: 0.6, servingSize: "1 cup", servingGrams: 165, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE BEVERAGES
  { id: "b7", name: "Turmeric Milk (Haldi Doodh)", category: "Beverages", calories: 120, protein: 6, carbs: 14, fats: 4, servingSize: "1 cup", servingGrams: 240, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "b8", name: "Soy Milk", category: "Beverages", calories: 80, protein: 7, carbs: 4, fats: 4, servingSize: "1 cup", servingGrams: 240, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "b9", name: "Lemonade (fresh)", category: "Beverages", calories: 40, protein: 0.2, carbs: 11, fats: 0, servingSize: "1 glass", servingGrams: 250, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE PREPARED MEALS
  { id: "m9", name: "Egg Bhurji (scrambled eggs)", category: "Prepared Meals", calories: 260, protein: 18, carbs: 5, fats: 18, servingSize: "1 serving", servingGrams: 180, dietaryTags: ["eggetarian", "non_vegetarian"] },
  { id: "m10", name: "Veggie Stir Fry", category: "Prepared Meals", calories: 180, protein: 5, carbs: 22, fats: 8, servingSize: "1 plate", servingGrams: 300, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "m11", name: "Paneer Bhurji", category: "Prepared Meals", calories: 290, protein: 18, carbs: 8, fats: 20, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MORE BREADS & BAKERY
  { id: "br6", name: "Pita Bread", category: "Breads & Bakery", calories: 165, protein: 6, carbs: 33, fats: 1, servingSize: "1 pita", servingGrams: 60, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "br7", name: "Sourdough Bread", category: "Breads & Bakery", calories: 93, protein: 3.6, carbs: 18, fats: 0.6, servingSize: "1 slice", servingGrams: 40, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "br8", name: "Puri / Poori", category: "Breads & Bakery", calories: 150, protein: 3, carbs: 18, fats: 8, servingSize: "1 piece", servingGrams: 40, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MORE SNACKS
  { id: "n11", name: "Granola Bar", category: "Snacks & Nuts", calories: 190, protein: 4, carbs: 30, fats: 7, servingSize: "1 bar", servingGrams: 47, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "n12", name: "Popcorn (plain)", category: "Snacks & Nuts", calories: 110, protein: 3, carbs: 22, fats: 1.5, servingSize: "3 cups", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n13", name: "Chana Chaat", category: "Snacks & Nuts", calories: 180, protein: 9, carbs: 28, fats: 4, servingSize: "1 bowl", servingGrams: 180, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n14", name: "Fox Nuts (Makhana, roasted)", category: "Snacks & Nuts", calories: 97, protein: 4, carbs: 18, fats: 0.5, servingSize: "30g", servingGrams: 30, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n15", name: "Sunflower Seeds", category: "Snacks & Nuts", calories: 165, protein: 5.5, carbs: 7, fats: 14, servingSize: "28g", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n16", name: "Pumpkin Seeds", category: "Snacks & Nuts", calories: 151, protein: 7, carbs: 5, fats: 13, servingSize: "28g", servingGrams: 28, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "n17", name: "Roasted Chana (Bengal gram)", category: "Snacks & Nuts", calories: 170, protein: 10, carbs: 26, fats: 2.5, servingSize: "40g", servingGrams: 40, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE MEXICAN
  { id: "mx13", name: "Tamales (chicken)", category: "Mexican", calories: 280, protein: 14, carbs: 32, fats: 12, servingSize: "2 tamales", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "mx14", name: "Horchata", category: "Mexican", calories: 140, protein: 1, carbs: 28, fats: 3, servingSize: "1 glass", servingGrams: 240, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "mx15", name: "Refried Beans", category: "Mexican", calories: 180, protein: 10, carbs: 30, fats: 3, servingSize: "1/2 cup", servingGrams: 130, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE CHINESE & ASIAN
  { id: "ca13", name: "Hot & Sour Soup", category: "Chinese & Asian", calories: 90, protein: 5, carbs: 14, fats: 2.5, servingSize: "1 bowl", servingGrams: 280, dietaryTags: ["eggetarian", "non_vegetarian"] },
  { id: "ca14", name: "Sweet & Sour Pork", category: "Chinese & Asian", calories: 380, protein: 22, carbs: 36, fats: 16, servingSize: "1 serving", servingGrams: 250, dietaryTags: ["non_vegetarian"] },
  { id: "ca15", name: "Nasi Goreng", category: "Chinese & Asian", calories: 420, protein: 18, carbs: 58, fats: 14, servingSize: "1 plate", servingGrams: 330, dietaryTags: ["eggetarian", "non_vegetarian"] },

  // MORE MEDITERRANEAN
  { id: "med12", name: "Spanakopita", category: "Mediterranean", calories: 300, protein: 10, carbs: 28, fats: 18, servingSize: "1 slice", servingGrams: 130, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "med13", name: "Stuffed Peppers (rice & herbs)", category: "Mediterranean", calories: 220, protein: 6, carbs: 40, fats: 6, servingSize: "2 peppers", servingGrams: 280, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "med14", name: "Panzanella Salad", category: "Mediterranean", calories: 190, protein: 4, carbs: 26, fats: 8, servingSize: "1 bowl", servingGrams: 220, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE ITALIAN
  { id: "it12", name: "Bruschetta", category: "Italian", calories: 180, protein: 5, carbs: 26, fats: 7, servingSize: "2 pieces", servingGrams: 110, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "it13", name: "Gnocchi (potato)", category: "Italian", calories: 300, protein: 7, carbs: 60, fats: 4, servingSize: "1 cup", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "it14", name: "Pesto Pasta", category: "Italian", calories: 410, protein: 13, carbs: 52, fats: 18, servingSize: "1 plate", servingGrams: 280, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MORE JAPANESE
  { id: "jp12", name: "Tonkatsu", category: "Japanese", calories: 390, protein: 28, carbs: 22, fats: 20, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "jp13", name: "Matcha Latte", category: "Japanese", calories: 120, protein: 5, carbs: 16, fats: 4, servingSize: "1 cup", servingGrams: 240, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "jp14", name: "Soba Noodles (cold)", category: "Japanese", calories: 310, protein: 12, carbs: 58, fats: 3, servingSize: "1 serving", servingGrams: 250, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },

  // MORE MIDDLE EASTERN
  { id: "me12", name: "Ful Medames", category: "Middle Eastern", calories: 180, protein: 12, carbs: 28, fats: 3, servingSize: "1 bowl", servingGrams: 230, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "me13", name: "Kunafa (small piece)", category: "Middle Eastern", calories: 250, protein: 6, carbs: 34, fats: 12, servingSize: "1 serving", servingGrams: 120, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "me14", name: "Chicken Mandi", category: "Middle Eastern", calories: 460, protein: 30, carbs: 52, fats: 16, servingSize: "1 plate", servingGrams: 380, dietaryTags: ["non_vegetarian"] },

  // MORE AMERICAN
  { id: "am13", name: "Chicken Pot Pie", category: "American", calories: 490, protein: 22, carbs: 46, fats: 24, servingSize: "1 slice", servingGrams: 300, dietaryTags: ["non_vegetarian"] },
  { id: "am14", name: "New England Lobster Roll", category: "American", calories: 390, protein: 22, carbs: 34, fats: 18, servingSize: "1 roll", servingGrams: 220, dietaryTags: ["non_vegetarian"] },
  { id: "am15", name: "Biscuits & Gravy", category: "American", calories: 450, protein: 12, carbs: 52, fats: 22, servingSize: "1 plate", servingGrams: 280, dietaryTags: ["non_vegetarian"] },

  // MORE INDIAN - NORTH
  { id: "in23", name: "Saag (greens curry)", category: "Indian - North", calories: 160, protein: 8, carbs: 14, fats: 10, servingSize: "1 bowl", servingGrams: 200, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "in24", name: "Dahi Chicken", category: "Indian - North", calories: 270, protein: 25, carbs: 8, fats: 15, servingSize: "1 serving", servingGrams: 200, dietaryTags: ["non_vegetarian"] },
  { id: "in25", name: "Chicken Tikka", category: "Indian - North", calories: 180, protein: 24, carbs: 6, fats: 8, servingSize: "6 pieces", servingGrams: 150, dietaryTags: ["non_vegetarian"] },

  // MORE INDIAN - SOUTH
  { id: "is17", name: "Curd Rice", category: "Indian - South", calories: 200, protein: 6, carbs: 36, fats: 5, servingSize: "1 bowl", servingGrams: 220, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "is18", name: "Chicken Chettinad", category: "Indian - South", calories: 310, protein: 28, carbs: 8, fats: 19, servingSize: "1 serving", servingGrams: 220, dietaryTags: ["non_vegetarian"] },
  { id: "is19", name: "Bisi Bele Bath", category: "Indian - South", calories: 280, protein: 10, carbs: 46, fats: 8, servingSize: "1 bowl", servingGrams: 250, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MORE INDIAN - STREET FOOD
  { id: "isf13", name: "Ragda Pattice", category: "Indian - Street Food", calories: 320, protein: 10, carbs: 48, fats: 10, servingSize: "1 plate", servingGrams: 250, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf14", name: "Misal Pav", category: "Indian - Street Food", calories: 360, protein: 14, carbs: 52, fats: 12, servingSize: "1 plate", servingGrams: 280, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isf15", name: "Dabeli", category: "Indian - Street Food", calories: 250, protein: 6, carbs: 38, fats: 9, servingSize: "1 piece", servingGrams: 140, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MORE INDIAN - SWEETS
  { id: "isd11", name: "Mysore Pak", category: "Indian - Sweets", calories: 170, protein: 4, carbs: 22, fats: 8, servingSize: "1 piece", servingGrams: 50, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "isd12", name: "Balushahi", category: "Indian - Sweets", calories: 155, protein: 2, carbs: 22, fats: 7, servingSize: "1 piece", servingGrams: 50, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // MORE INDIAN - BEVERAGES
  { id: "ibv8", name: "Aam Panna (raw mango drink)", category: "Indian - Beverages", calories: 50, protein: 0.5, carbs: 13, fats: 0.1, servingSize: "1 glass", servingGrams: 250, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "ibv9", name: "Filter Coffee (South Indian)", category: "Indian - Beverages", calories: 60, protein: 2, carbs: 8, fats: 2, servingSize: "1 cup", servingGrams: 150, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },

  // SUPPLEMENTS
  { id: "s1", name: "Whey Protein (1 scoop)", category: "Supplements", calories: 120, protein: 24, carbs: 3, fats: 1, servingSize: "1 scoop (30g)", servingGrams: 30, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "s2", name: "Casein Protein (1 scoop)", category: "Supplements", calories: 110, protein: 24, carbs: 3, fats: 0.5, servingSize: "1 scoop (33g)", servingGrams: 33, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "s3", name: "Mass Gainer (1 scoop)", category: "Supplements", calories: 650, protein: 32, carbs: 110, fats: 8, servingSize: "1 scoop (165g)", servingGrams: 165, dietaryTags: ["vegetarian", "eggetarian", "non_vegetarian"] },
  { id: "s4", name: "BCAA (1 serving)", category: "Supplements", calories: 10, protein: 5, carbs: 0, fats: 0, servingSize: "1 scoop (7g)", servingGrams: 7, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
  { id: "s5", name: "Creatine (1 serving)", category: "Supplements", calories: 0, protein: 0, carbs: 0, fats: 0, servingSize: "5g", servingGrams: 5, dietaryTags: ["vegetarian", "vegan", "eggetarian", "non_vegetarian"] },
];

export function matchesDietaryPreference(food: FoodItem, preference?: string): boolean {
  if (!preference) return true;
  if (!food.dietaryTags || food.dietaryTags.length === 0) return true;
  return food.dietaryTags.includes(preference);
}

export function searchFoods(query: string, dietaryPreference?: string): FoodItem[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase();
  return foodDatabase
    .filter(
      (f) =>
        (f.name.toLowerCase().includes(lower) || f.category.toLowerCase().includes(lower)) &&
        matchesDietaryPreference(f, dietaryPreference)
    )
    .slice(0, 20);
}

export function getFoodsByCategory(category: string, dietaryPreference?: string): FoodItem[] {
  return foodDatabase.filter(
    (f) => f.category === category && matchesDietaryPreference(f, dietaryPreference)
  );
}
