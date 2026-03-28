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
  "Indian",
  "Supplements",
] as const;

export const foodDatabase: FoodItem[] = [
  // PROTEINS
  { id: "p1", name: "Chicken Breast (grilled)", category: "Proteins", calories: 165, protein: 31, carbs: 0, fats: 3.6, servingSize: "100g", servingGrams: 100 },
  { id: "p2", name: "Salmon (baked)", category: "Proteins", calories: 208, protein: 20, carbs: 0, fats: 13, servingSize: "100g", servingGrams: 100 },
  { id: "p3", name: "Eggs (whole, boiled)", category: "Proteins", calories: 155, protein: 13, carbs: 1.1, fats: 11, servingSize: "2 eggs", servingGrams: 100 },
  { id: "p4", name: "Egg Whites", category: "Proteins", calories: 52, protein: 11, carbs: 0.7, fats: 0.2, servingSize: "3 whites", servingGrams: 100 },
  { id: "p5", name: "Tuna (canned)", category: "Proteins", calories: 116, protein: 26, carbs: 0, fats: 1, servingSize: "100g", servingGrams: 100 },
  { id: "p6", name: "Turkey Breast", category: "Proteins", calories: 135, protein: 30, carbs: 0, fats: 1, servingSize: "100g", servingGrams: 100 },
  { id: "p7", name: "Shrimp", category: "Proteins", calories: 99, protein: 24, carbs: 0.2, fats: 0.3, servingSize: "100g", servingGrams: 100 },
  { id: "p8", name: "Beef Steak (lean)", category: "Proteins", calories: 271, protein: 26, carbs: 0, fats: 18, servingSize: "100g", servingGrams: 100 },
  { id: "p9", name: "Ground Beef (lean)", category: "Proteins", calories: 250, protein: 26, carbs: 0, fats: 15, servingSize: "100g", servingGrams: 100 },
  { id: "p10", name: "Tofu (firm)", category: "Proteins", calories: 144, protein: 17, carbs: 3, fats: 8, servingSize: "100g", servingGrams: 100 },
  { id: "p11", name: "Paneer", category: "Proteins", calories: 265, protein: 18, carbs: 1.2, fats: 21, servingSize: "100g", servingGrams: 100 },
  { id: "p12", name: "Chickpeas (cooked)", category: "Proteins", calories: 164, protein: 9, carbs: 27, fats: 2.6, servingSize: "1 cup", servingGrams: 160 },
  { id: "p13", name: "Lentils (cooked)", category: "Proteins", calories: 116, protein: 9, carbs: 20, fats: 0.4, servingSize: "1 cup", servingGrams: 200 },
  { id: "p14", name: "Black Beans (cooked)", category: "Proteins", calories: 132, protein: 9, carbs: 24, fats: 0.5, servingSize: "1 cup", servingGrams: 170 },
  { id: "p15", name: "Whey Protein Shake", category: "Proteins", calories: 120, protein: 24, carbs: 3, fats: 1, servingSize: "1 scoop", servingGrams: 30 },

  // GRAINS & CEREALS
  { id: "g1", name: "White Rice (cooked)", category: "Grains & Cereals", calories: 130, protein: 2.7, carbs: 28, fats: 0.3, servingSize: "1 cup", servingGrams: 158 },
  { id: "g2", name: "Brown Rice (cooked)", category: "Grains & Cereals", calories: 216, protein: 5, carbs: 45, fats: 1.8, servingSize: "1 cup", servingGrams: 195 },
  { id: "g3", name: "Oatmeal (cooked)", category: "Grains & Cereals", calories: 154, protein: 5, carbs: 27, fats: 2.6, servingSize: "1 cup", servingGrams: 234 },
  { id: "g4", name: "Quinoa (cooked)", category: "Grains & Cereals", calories: 222, protein: 8, carbs: 39, fats: 3.6, servingSize: "1 cup", servingGrams: 185 },
  { id: "g5", name: "Pasta (cooked)", category: "Grains & Cereals", calories: 220, protein: 8, carbs: 43, fats: 1.3, servingSize: "1 cup", servingGrams: 140 },
  { id: "g6", name: "Sweet Potato (baked)", category: "Grains & Cereals", calories: 103, protein: 2.3, carbs: 24, fats: 0.1, servingSize: "1 medium", servingGrams: 114 },
  { id: "g7", name: "Potato (baked)", category: "Grains & Cereals", calories: 161, protein: 4.3, carbs: 37, fats: 0.2, servingSize: "1 medium", servingGrams: 173 },
  { id: "g8", name: "Corn (1 ear)", category: "Grains & Cereals", calories: 88, protein: 3.3, carbs: 19, fats: 1.4, servingSize: "1 ear", servingGrams: 100 },

  // FRUITS
  { id: "f1", name: "Banana", category: "Fruits", calories: 105, protein: 1.3, carbs: 27, fats: 0.4, servingSize: "1 medium", servingGrams: 118 },
  { id: "f2", name: "Apple", category: "Fruits", calories: 95, protein: 0.5, carbs: 25, fats: 0.3, servingSize: "1 medium", servingGrams: 182 },
  { id: "f3", name: "Orange", category: "Fruits", calories: 62, protein: 1.2, carbs: 15, fats: 0.2, servingSize: "1 medium", servingGrams: 130 },
  { id: "f4", name: "Blueberries", category: "Fruits", calories: 84, protein: 1.1, carbs: 21, fats: 0.5, servingSize: "1 cup", servingGrams: 148 },
  { id: "f5", name: "Strawberries", category: "Fruits", calories: 49, protein: 1, carbs: 12, fats: 0.5, servingSize: "1 cup", servingGrams: 152 },
  { id: "f6", name: "Mango", category: "Fruits", calories: 99, protein: 1.4, carbs: 25, fats: 0.6, servingSize: "1 cup", servingGrams: 165 },
  { id: "f7", name: "Watermelon", category: "Fruits", calories: 46, protein: 0.9, carbs: 12, fats: 0.2, servingSize: "1 cup", servingGrams: 152 },
  { id: "f8", name: "Grapes", category: "Fruits", calories: 104, protein: 1.1, carbs: 27, fats: 0.2, servingSize: "1 cup", servingGrams: 151 },
  { id: "f9", name: "Avocado", category: "Fruits", calories: 240, protein: 3, carbs: 13, fats: 22, servingSize: "1 whole", servingGrams: 150 },
  { id: "f10", name: "Pineapple", category: "Fruits", calories: 82, protein: 0.9, carbs: 22, fats: 0.2, servingSize: "1 cup", servingGrams: 165 },

  // VEGETABLES
  { id: "v1", name: "Broccoli (cooked)", category: "Vegetables", calories: 55, protein: 3.7, carbs: 11, fats: 0.6, servingSize: "1 cup", servingGrams: 156 },
  { id: "v2", name: "Spinach (raw)", category: "Vegetables", calories: 7, protein: 0.9, carbs: 1.1, fats: 0.1, servingSize: "1 cup", servingGrams: 30 },
  { id: "v3", name: "Mixed Salad", category: "Vegetables", calories: 20, protein: 1.5, carbs: 3.5, fats: 0.2, servingSize: "1 bowl", servingGrams: 100 },
  { id: "v4", name: "Carrots", category: "Vegetables", calories: 41, protein: 0.9, carbs: 10, fats: 0.2, servingSize: "1 medium", servingGrams: 100 },
  { id: "v5", name: "Bell Pepper", category: "Vegetables", calories: 31, protein: 1, carbs: 6, fats: 0.3, servingSize: "1 medium", servingGrams: 120 },
  { id: "v6", name: "Cucumber", category: "Vegetables", calories: 16, protein: 0.7, carbs: 3.6, fats: 0.1, servingSize: "1 cup", servingGrams: 104 },
  { id: "v7", name: "Tomato", category: "Vegetables", calories: 22, protein: 1.1, carbs: 4.8, fats: 0.2, servingSize: "1 medium", servingGrams: 123 },

  // DAIRY
  { id: "d1", name: "Greek Yogurt (plain)", category: "Dairy", calories: 100, protein: 17, carbs: 6, fats: 0.7, servingSize: "1 cup", servingGrams: 170 },
  { id: "d2", name: "Whole Milk", category: "Dairy", calories: 149, protein: 8, carbs: 12, fats: 8, servingSize: "1 cup", servingGrams: 244 },
  { id: "d3", name: "Skim Milk", category: "Dairy", calories: 83, protein: 8, carbs: 12, fats: 0.2, servingSize: "1 cup", servingGrams: 245 },
  { id: "d4", name: "Cottage Cheese", category: "Dairy", calories: 163, protein: 28, carbs: 6, fats: 2.3, servingSize: "1 cup", servingGrams: 226 },
  { id: "d5", name: "Cheddar Cheese", category: "Dairy", calories: 113, protein: 7, carbs: 0.4, fats: 9, servingSize: "1 slice", servingGrams: 28 },
  { id: "d6", name: "Mozzarella", category: "Dairy", calories: 85, protein: 6, carbs: 0.7, fats: 6, servingSize: "1 slice", servingGrams: 28 },

  // SNACKS & NUTS
  { id: "n1", name: "Almonds", category: "Snacks & Nuts", calories: 164, protein: 6, carbs: 6, fats: 14, servingSize: "28g (23 nuts)", servingGrams: 28 },
  { id: "n2", name: "Peanut Butter", category: "Snacks & Nuts", calories: 188, protein: 8, carbs: 6, fats: 16, servingSize: "2 tbsp", servingGrams: 32 },
  { id: "n3", name: "Walnuts", category: "Snacks & Nuts", calories: 185, protein: 4.3, carbs: 3.9, fats: 18, servingSize: "28g", servingGrams: 28 },
  { id: "n4", name: "Cashews", category: "Snacks & Nuts", calories: 157, protein: 5, carbs: 9, fats: 12, servingSize: "28g", servingGrams: 28 },
  { id: "n5", name: "Trail Mix", category: "Snacks & Nuts", calories: 462, protein: 14, carbs: 44, fats: 29, servingSize: "100g", servingGrams: 100 },
  { id: "n6", name: "Dark Chocolate (70%)", category: "Snacks & Nuts", calories: 170, protein: 2, carbs: 13, fats: 12, servingSize: "30g", servingGrams: 30 },
  { id: "n7", name: "Rice Cakes", category: "Snacks & Nuts", calories: 35, protein: 0.7, carbs: 7.3, fats: 0.3, servingSize: "1 cake", servingGrams: 9 },
  { id: "n8", name: "Protein Bar", category: "Snacks & Nuts", calories: 210, protein: 20, carbs: 22, fats: 7, servingSize: "1 bar", servingGrams: 60 },

  // BEVERAGES
  { id: "b1", name: "Black Coffee", category: "Beverages", calories: 2, protein: 0.3, carbs: 0, fats: 0, servingSize: "1 cup", servingGrams: 240 },
  { id: "b2", name: "Green Tea", category: "Beverages", calories: 2, protein: 0, carbs: 0.5, fats: 0, servingSize: "1 cup", servingGrams: 240 },
  { id: "b3", name: "Orange Juice", category: "Beverages", calories: 112, protein: 1.7, carbs: 26, fats: 0.5, servingSize: "1 cup", servingGrams: 248 },
  { id: "b4", name: "Coconut Water", category: "Beverages", calories: 46, protein: 1.7, carbs: 9, fats: 0.5, servingSize: "1 cup", servingGrams: 240 },
  { id: "b5", name: "Protein Shake (whey)", category: "Beverages", calories: 160, protein: 30, carbs: 5, fats: 2, servingSize: "1 shake", servingGrams: 300 },
  { id: "b6", name: "Almond Milk", category: "Beverages", calories: 39, protein: 1, carbs: 3.4, fats: 2.5, servingSize: "1 cup", servingGrams: 240 },

  // PREPARED MEALS
  { id: "m1", name: "Grilled Chicken Salad", category: "Prepared Meals", calories: 350, protein: 35, carbs: 15, fats: 16, servingSize: "1 bowl", servingGrams: 300 },
  { id: "m2", name: "Chicken & Rice Bowl", category: "Prepared Meals", calories: 480, protein: 35, carbs: 55, fats: 10, servingSize: "1 bowl", servingGrams: 400 },
  { id: "m3", name: "Turkey Sandwich", category: "Prepared Meals", calories: 320, protein: 22, carbs: 38, fats: 8, servingSize: "1 sandwich", servingGrams: 200 },
  { id: "m4", name: "Burrito Bowl", category: "Prepared Meals", calories: 520, protein: 28, carbs: 60, fats: 18, servingSize: "1 bowl", servingGrams: 450 },
  { id: "m5", name: "Stir-fry Tofu & Veggies", category: "Prepared Meals", calories: 280, protein: 18, carbs: 25, fats: 12, servingSize: "1 plate", servingGrams: 350 },
  { id: "m6", name: "Salmon & Vegetables", category: "Prepared Meals", calories: 380, protein: 32, carbs: 12, fats: 22, servingSize: "1 plate", servingGrams: 350 },
  { id: "m7", name: "Pasta with Meat Sauce", category: "Prepared Meals", calories: 450, protein: 22, carbs: 58, fats: 14, servingSize: "1 plate", servingGrams: 350 },
  { id: "m8", name: "Caesar Salad", category: "Prepared Meals", calories: 320, protein: 8, carbs: 14, fats: 26, servingSize: "1 bowl", servingGrams: 250 },

  // BREADS & BAKERY
  { id: "br1", name: "Whole Wheat Bread", category: "Breads & Bakery", calories: 69, protein: 3.6, carbs: 12, fats: 1.1, servingSize: "1 slice", servingGrams: 28 },
  { id: "br2", name: "White Bread", category: "Breads & Bakery", calories: 79, protein: 2.7, carbs: 15, fats: 1, servingSize: "1 slice", servingGrams: 30 },
  { id: "br3", name: "Bagel", category: "Breads & Bakery", calories: 245, protein: 10, carbs: 48, fats: 1.5, servingSize: "1 bagel", servingGrams: 98 },
  { id: "br4", name: "Tortilla (flour)", category: "Breads & Bakery", calories: 146, protein: 4, carbs: 25, fats: 3.5, servingSize: "1 tortilla", servingGrams: 49 },
  { id: "br5", name: "Croissant", category: "Breads & Bakery", calories: 231, protein: 5, carbs: 26, fats: 12, servingSize: "1 piece", servingGrams: 57 },

  // INDIAN
  { id: "i1", name: "Dal Tadka", category: "Indian", calories: 150, protein: 9, carbs: 22, fats: 3, servingSize: "1 bowl", servingGrams: 200 },
  { id: "i2", name: "Roti / Chapati", category: "Indian", calories: 104, protein: 3, carbs: 18, fats: 3, servingSize: "1 roti", servingGrams: 40 },
  { id: "i3", name: "Butter Chicken", category: "Indian", calories: 240, protein: 18, carbs: 8, fats: 15, servingSize: "1 serving", servingGrams: 200 },
  { id: "i4", name: "Palak Paneer", category: "Indian", calories: 200, protein: 12, carbs: 10, fats: 14, servingSize: "1 serving", servingGrams: 200 },
  { id: "i5", name: "Biryani (chicken)", category: "Indian", calories: 350, protein: 18, carbs: 45, fats: 10, servingSize: "1 plate", servingGrams: 300 },
  { id: "i6", name: "Idli", category: "Indian", calories: 39, protein: 2, carbs: 8, fats: 0.2, servingSize: "1 piece", servingGrams: 30 },
  { id: "i7", name: "Dosa (plain)", category: "Indian", calories: 120, protein: 3, carbs: 18, fats: 4, servingSize: "1 dosa", servingGrams: 80 },
  { id: "i8", name: "Chole / Chana Masala", category: "Indian", calories: 210, protein: 10, carbs: 30, fats: 6, servingSize: "1 serving", servingGrams: 200 },
  { id: "i9", name: "Rajma (kidney bean curry)", category: "Indian", calories: 180, protein: 10, carbs: 28, fats: 3, servingSize: "1 serving", servingGrams: 200 },
  { id: "i10", name: "Upma", category: "Indian", calories: 180, protein: 4, carbs: 28, fats: 6, servingSize: "1 bowl", servingGrams: 200 },
  { id: "i11", name: "Poha", category: "Indian", calories: 160, protein: 3, carbs: 30, fats: 4, servingSize: "1 bowl", servingGrams: 200 },
  { id: "i12", name: "Samosa", category: "Indian", calories: 260, protein: 5, carbs: 32, fats: 13, servingSize: "1 piece", servingGrams: 100 },

  // SUPPLEMENTS
  { id: "s1", name: "Whey Protein (1 scoop)", category: "Supplements", calories: 120, protein: 24, carbs: 3, fats: 1, servingSize: "1 scoop (30g)", servingGrams: 30 },
  { id: "s2", name: "Casein Protein (1 scoop)", category: "Supplements", calories: 110, protein: 24, carbs: 3, fats: 0.5, servingSize: "1 scoop (33g)", servingGrams: 33 },
  { id: "s3", name: "Mass Gainer (1 scoop)", category: "Supplements", calories: 650, protein: 32, carbs: 110, fats: 8, servingSize: "1 scoop (165g)", servingGrams: 165 },
  { id: "s4", name: "BCAA (1 serving)", category: "Supplements", calories: 10, protein: 5, carbs: 0, fats: 0, servingSize: "1 scoop (7g)", servingGrams: 7 },
  { id: "s5", name: "Creatine (1 serving)", category: "Supplements", calories: 0, protein: 0, carbs: 0, fats: 0, servingSize: "5g", servingGrams: 5 },
];

export function searchFoods(query: string): FoodItem[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase();
  return foodDatabase
    .filter((f) => f.name.toLowerCase().includes(lower) || f.category.toLowerCase().includes(lower))
    .slice(0, 20);
}

export function getFoodsByCategory(category: string): FoodItem[] {
  return foodDatabase.filter((f) => f.category === category);
}
