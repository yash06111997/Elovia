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
  "Oils & Condiments",
  "Frozen & Convenience",
  "Breakfast",
] as const;

const V = ["vegetarian", "vegan", "eggetarian", "non_vegetarian"];
const VE = ["vegetarian", "eggetarian", "non_vegetarian"];
const NV = ["non_vegetarian"];
const EG = ["eggetarian", "non_vegetarian"];

export const foodDatabase: FoodItem[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // PROTEINS (~40 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "p1", name: "Chicken Breast (grilled)", category: "Proteins", calories: 165, protein: 31, carbs: 0, fats: 3.6, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p2", name: "Salmon (baked)", category: "Proteins", calories: 208, protein: 20, carbs: 0, fats: 13, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p3", name: "Eggs (whole, boiled)", category: "Proteins", calories: 155, protein: 13, carbs: 1.1, fats: 11, servingSize: "2 eggs", servingGrams: 100, dietaryTags: EG },
  { id: "p4", name: "Egg Whites", category: "Proteins", calories: 52, protein: 11, carbs: 0.7, fats: 0.2, servingSize: "3 whites", servingGrams: 100, dietaryTags: EG },
  { id: "p5", name: "Tuna (canned)", category: "Proteins", calories: 116, protein: 26, carbs: 0, fats: 1, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p6", name: "Turkey Breast", category: "Proteins", calories: 135, protein: 30, carbs: 0, fats: 1, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p7", name: "Shrimp", category: "Proteins", calories: 99, protein: 24, carbs: 0.2, fats: 0.3, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p8", name: "Beef Steak (lean)", category: "Proteins", calories: 271, protein: 26, carbs: 0, fats: 18, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p9", name: "Ground Beef (lean)", category: "Proteins", calories: 250, protein: 26, carbs: 0, fats: 15, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p10", name: "Tofu (firm)", category: "Proteins", calories: 144, protein: 17, carbs: 3, fats: 8, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "p11", name: "Paneer", category: "Proteins", calories: 265, protein: 18, carbs: 1.2, fats: 21, servingSize: "100g", servingGrams: 100, dietaryTags: VE },
  { id: "p12", name: "Chickpeas (cooked)", category: "Proteins", calories: 164, protein: 9, carbs: 27, fats: 2.6, servingSize: "1 cup", servingGrams: 160, dietaryTags: V },
  { id: "p13", name: "Lentils (cooked)", category: "Proteins", calories: 116, protein: 9, carbs: 20, fats: 0.4, servingSize: "1 cup", servingGrams: 200, dietaryTags: V },
  { id: "p14", name: "Black Beans (cooked)", category: "Proteins", calories: 132, protein: 9, carbs: 24, fats: 0.5, servingSize: "1 cup", servingGrams: 170, dietaryTags: V },
  { id: "p15", name: "Whey Protein Shake", category: "Proteins", calories: 120, protein: 24, carbs: 3, fats: 1, servingSize: "1 scoop", servingGrams: 30, dietaryTags: VE },
  { id: "p16", name: "Lamb Chop (grilled)", category: "Proteins", calories: 282, protein: 25, carbs: 0, fats: 20, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p17", name: "Pork Tenderloin", category: "Proteins", calories: 143, protein: 26, carbs: 0, fats: 3.5, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p18", name: "Chicken Thigh (skinless)", category: "Proteins", calories: 209, protein: 26, carbs: 0, fats: 11, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p19", name: "Tempeh", category: "Proteins", calories: 192, protein: 20, carbs: 8, fats: 11, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "p20", name: "Edamame", category: "Proteins", calories: 121, protein: 12, carbs: 9, fats: 5, servingSize: "1 cup", servingGrams: 155, dietaryTags: V },
  { id: "p21", name: "Seitan", category: "Proteins", calories: 370, protein: 75, carbs: 14, fats: 2, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "p22", name: "Cod (baked)", category: "Proteins", calories: 105, protein: 23, carbs: 0, fats: 1, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p23", name: "Tilapia (baked)", category: "Proteins", calories: 128, protein: 26, carbs: 0, fats: 3, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p24", name: "Sardines (canned)", category: "Proteins", calories: 208, protein: 25, carbs: 0, fats: 11, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p25", name: "Bison (ground)", category: "Proteins", calories: 146, protein: 20, carbs: 0, fats: 7, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p26", name: "Duck Breast", category: "Proteins", calories: 201, protein: 23, carbs: 0, fats: 11, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p27", name: "Crab Meat", category: "Proteins", calories: 97, protein: 19, carbs: 0, fats: 2, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p28", name: "Scallops", category: "Proteins", calories: 111, protein: 21, carbs: 5, fats: 1, servingSize: "100g", servingGrams: 100, dietaryTags: NV },
  { id: "p29", name: "Kidney Beans (cooked)", category: "Proteins", calories: 127, protein: 9, carbs: 22, fats: 0.5, servingSize: "1 cup", servingGrams: 177, dietaryTags: V },
  { id: "p30", name: "Soy Chunks (cooked)", category: "Proteins", calories: 345, protein: 52, carbs: 33, fats: 0.5, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "p31", name: "Egg Omelette (2 eggs)", category: "Proteins", calories: 188, protein: 14, carbs: 1.5, fats: 14, servingSize: "1 omelette", servingGrams: 120, dietaryTags: EG },
  { id: "p32", name: "Chicken Sausage", category: "Proteins", calories: 130, protein: 14, carbs: 3, fats: 7, servingSize: "1 link", servingGrams: 68, dietaryTags: NV },
  { id: "p33", name: "Smoked Salmon", category: "Proteins", calories: 117, protein: 18, carbs: 0, fats: 4.3, servingSize: "56g", servingGrams: 56, dietaryTags: NV },
  { id: "p34", name: "Mung Beans (sprouted)", category: "Proteins", calories: 31, protein: 3.2, carbs: 6, fats: 0.2, servingSize: "1 cup", servingGrams: 104, dietaryTags: V },
  { id: "p35", name: "Black-Eyed Peas (cooked)", category: "Proteins", calories: 160, protein: 8, carbs: 28, fats: 0.6, servingSize: "1 cup", servingGrams: 172, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // GRAINS & CEREALS (~20 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "g1", name: "White Rice (cooked)", category: "Grains & Cereals", calories: 130, protein: 2.7, carbs: 28, fats: 0.3, servingSize: "1 cup", servingGrams: 158, dietaryTags: V },
  { id: "g2", name: "Brown Rice (cooked)", category: "Grains & Cereals", calories: 216, protein: 5, carbs: 45, fats: 1.8, servingSize: "1 cup", servingGrams: 195, dietaryTags: V },
  { id: "g3", name: "Oatmeal (cooked)", category: "Grains & Cereals", calories: 154, protein: 5, carbs: 27, fats: 2.6, servingSize: "1 cup", servingGrams: 234, dietaryTags: V },
  { id: "g4", name: "Quinoa (cooked)", category: "Grains & Cereals", calories: 222, protein: 8, carbs: 39, fats: 3.6, servingSize: "1 cup", servingGrams: 185, dietaryTags: V },
  { id: "g5", name: "Pasta (cooked)", category: "Grains & Cereals", calories: 220, protein: 8, carbs: 43, fats: 1.3, servingSize: "1 cup", servingGrams: 140, dietaryTags: V },
  { id: "g6", name: "Sweet Potato (baked)", category: "Grains & Cereals", calories: 103, protein: 2.3, carbs: 24, fats: 0.1, servingSize: "1 medium", servingGrams: 114, dietaryTags: V },
  { id: "g7", name: "Potato (baked)", category: "Grains & Cereals", calories: 161, protein: 4.3, carbs: 37, fats: 0.2, servingSize: "1 medium", servingGrams: 173, dietaryTags: V },
  { id: "g8", name: "Corn (1 ear)", category: "Grains & Cereals", calories: 88, protein: 3.3, carbs: 19, fats: 1.4, servingSize: "1 ear", servingGrams: 100, dietaryTags: V },
  { id: "g9", name: "Couscous (cooked)", category: "Grains & Cereals", calories: 176, protein: 6, carbs: 36, fats: 0.3, servingSize: "1 cup", servingGrams: 157, dietaryTags: V },
  { id: "g10", name: "Bulgur Wheat (cooked)", category: "Grains & Cereals", calories: 151, protein: 5.6, carbs: 34, fats: 0.4, servingSize: "1 cup", servingGrams: 182, dietaryTags: V },
  { id: "g11", name: "Buckwheat (cooked)", category: "Grains & Cereals", calories: 155, protein: 5.7, carbs: 34, fats: 1, servingSize: "1 cup", servingGrams: 168, dietaryTags: V },
  { id: "g12", name: "Millet (cooked)", category: "Grains & Cereals", calories: 207, protein: 6, carbs: 41, fats: 1.7, servingSize: "1 cup", servingGrams: 174, dietaryTags: V },
  { id: "g13", name: "Polenta (cooked)", category: "Grains & Cereals", calories: 145, protein: 3.5, carbs: 31, fats: 0.7, servingSize: "1 cup", servingGrams: 200, dietaryTags: V },
  { id: "g14", name: "Basmati Rice (cooked)", category: "Grains & Cereals", calories: 150, protein: 3.5, carbs: 33, fats: 0.4, servingSize: "1 cup", servingGrams: 160, dietaryTags: V },
  { id: "g15", name: "Barley (cooked)", category: "Grains & Cereals", calories: 193, protein: 3.6, carbs: 44, fats: 0.7, servingSize: "1 cup", servingGrams: 157, dietaryTags: V },
  { id: "g16", name: "Vermicelli (cooked)", category: "Grains & Cereals", calories: 220, protein: 7, carbs: 44, fats: 0.6, servingSize: "1 cup", servingGrams: 140, dietaryTags: V },
  { id: "g17", name: "Wild Rice (cooked)", category: "Grains & Cereals", calories: 166, protein: 6.5, carbs: 35, fats: 0.6, servingSize: "1 cup", servingGrams: 164, dietaryTags: V },
  { id: "g18", name: "Poha (flattened rice)", category: "Grains & Cereals", calories: 264, protein: 4.7, carbs: 60, fats: 0.8, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "g19", name: "Ragi / Finger Millet", category: "Grains & Cereals", calories: 328, protein: 7.3, carbs: 72, fats: 1.3, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "g20", name: "Amaranth (cooked)", category: "Grains & Cereals", calories: 251, protein: 9.3, carbs: 46, fats: 3.9, servingSize: "1 cup", servingGrams: 246, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // FRUITS (~25 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "f1", name: "Banana", category: "Fruits", calories: 105, protein: 1.3, carbs: 27, fats: 0.4, servingSize: "1 medium", servingGrams: 118, dietaryTags: V },
  { id: "f2", name: "Apple", category: "Fruits", calories: 95, protein: 0.5, carbs: 25, fats: 0.3, servingSize: "1 medium", servingGrams: 182, dietaryTags: V },
  { id: "f3", name: "Orange", category: "Fruits", calories: 62, protein: 1.2, carbs: 15, fats: 0.2, servingSize: "1 medium", servingGrams: 130, dietaryTags: V },
  { id: "f4", name: "Blueberries", category: "Fruits", calories: 84, protein: 1.1, carbs: 21, fats: 0.5, servingSize: "1 cup", servingGrams: 148, dietaryTags: V },
  { id: "f5", name: "Strawberries", category: "Fruits", calories: 49, protein: 1, carbs: 12, fats: 0.5, servingSize: "1 cup", servingGrams: 152, dietaryTags: V },
  { id: "f6", name: "Mango", category: "Fruits", calories: 99, protein: 1.4, carbs: 25, fats: 0.6, servingSize: "1 cup", servingGrams: 165, dietaryTags: V },
  { id: "f7", name: "Watermelon", category: "Fruits", calories: 46, protein: 0.9, carbs: 12, fats: 0.2, servingSize: "1 cup", servingGrams: 152, dietaryTags: V },
  { id: "f8", name: "Grapes", category: "Fruits", calories: 104, protein: 1.1, carbs: 27, fats: 0.2, servingSize: "1 cup", servingGrams: 151, dietaryTags: V },
  { id: "f9", name: "Avocado", category: "Fruits", calories: 240, protein: 3, carbs: 13, fats: 22, servingSize: "1 whole", servingGrams: 150, dietaryTags: V },
  { id: "f10", name: "Pineapple", category: "Fruits", calories: 82, protein: 0.9, carbs: 22, fats: 0.2, servingSize: "1 cup", servingGrams: 165, dietaryTags: V },
  { id: "f11", name: "Papaya", category: "Fruits", calories: 55, protein: 0.6, carbs: 14, fats: 0.1, servingSize: "1 cup", servingGrams: 145, dietaryTags: V },
  { id: "f12", name: "Pomegranate", category: "Fruits", calories: 83, protein: 1.7, carbs: 19, fats: 1.2, servingSize: "1 cup seeds", servingGrams: 174, dietaryTags: V },
  { id: "f13", name: "Kiwi", category: "Fruits", calories: 42, protein: 0.8, carbs: 10, fats: 0.4, servingSize: "1 medium", servingGrams: 69, dietaryTags: V },
  { id: "f14", name: "Peach", category: "Fruits", calories: 59, protein: 1.4, carbs: 14, fats: 0.4, servingSize: "1 medium", servingGrams: 150, dietaryTags: V },
  { id: "f15", name: "Pear", category: "Fruits", calories: 102, protein: 0.7, carbs: 27, fats: 0.2, servingSize: "1 medium", servingGrams: 178, dietaryTags: V },
  { id: "f16", name: "Cherries", category: "Fruits", calories: 87, protein: 1.5, carbs: 22, fats: 0.3, servingSize: "1 cup", servingGrams: 138, dietaryTags: V },
  { id: "f17", name: "Raspberries", category: "Fruits", calories: 64, protein: 1.5, carbs: 15, fats: 0.8, servingSize: "1 cup", servingGrams: 123, dietaryTags: V },
  { id: "f18", name: "Grapefruit", category: "Fruits", calories: 52, protein: 0.9, carbs: 13, fats: 0.2, servingSize: "½ fruit", servingGrams: 123, dietaryTags: V },
  { id: "f19", name: "Lychee", category: "Fruits", calories: 66, protein: 0.8, carbs: 17, fats: 0.4, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "f20", name: "Guava", category: "Fruits", calories: 68, protein: 2.6, carbs: 14, fats: 1, servingSize: "1 medium", servingGrams: 100, dietaryTags: V },
  { id: "f21", name: "Dragon Fruit", category: "Fruits", calories: 60, protein: 1.2, carbs: 13, fats: 0.4, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "f22", name: "Cantaloupe", category: "Fruits", calories: 53, protein: 1.3, carbs: 13, fats: 0.3, servingSize: "1 cup", servingGrams: 156, dietaryTags: V },
  { id: "f23", name: "Dates (dried)", category: "Fruits", calories: 277, protein: 1.8, carbs: 75, fats: 0.2, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "f24", name: "Coconut (fresh)", category: "Fruits", calories: 354, protein: 3.3, carbs: 15, fats: 33, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "f25", name: "Jackfruit (raw)", category: "Fruits", calories: 95, protein: 1.7, carbs: 23, fats: 0.6, servingSize: "1 cup", servingGrams: 151, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // VEGETABLES (~20 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "v1", name: "Broccoli (cooked)", category: "Vegetables", calories: 55, protein: 3.7, carbs: 11, fats: 0.6, servingSize: "1 cup", servingGrams: 156, dietaryTags: V },
  { id: "v2", name: "Spinach (raw)", category: "Vegetables", calories: 7, protein: 0.9, carbs: 1.1, fats: 0.1, servingSize: "1 cup", servingGrams: 30, dietaryTags: V },
  { id: "v3", name: "Mixed Salad", category: "Vegetables", calories: 20, protein: 1.5, carbs: 3.5, fats: 0.2, servingSize: "1 bowl", servingGrams: 100, dietaryTags: V },
  { id: "v4", name: "Carrots", category: "Vegetables", calories: 41, protein: 0.9, carbs: 10, fats: 0.2, servingSize: "1 medium", servingGrams: 100, dietaryTags: V },
  { id: "v5", name: "Bell Pepper", category: "Vegetables", calories: 31, protein: 1, carbs: 6, fats: 0.3, servingSize: "1 medium", servingGrams: 120, dietaryTags: V },
  { id: "v6", name: "Cucumber", category: "Vegetables", calories: 16, protein: 0.7, carbs: 3.6, fats: 0.1, servingSize: "1 cup", servingGrams: 104, dietaryTags: V },
  { id: "v7", name: "Tomato", category: "Vegetables", calories: 22, protein: 1.1, carbs: 4.8, fats: 0.2, servingSize: "1 medium", servingGrams: 123, dietaryTags: V },
  { id: "v8", name: "Cauliflower", category: "Vegetables", calories: 25, protein: 2, carbs: 5, fats: 0.1, servingSize: "1 cup", servingGrams: 100, dietaryTags: V },
  { id: "v9", name: "Kale (raw)", category: "Vegetables", calories: 33, protein: 2.9, carbs: 6, fats: 0.5, servingSize: "1 cup", servingGrams: 67, dietaryTags: V },
  { id: "v10", name: "Zucchini", category: "Vegetables", calories: 17, protein: 1.2, carbs: 3.1, fats: 0.3, servingSize: "1 cup", servingGrams: 113, dietaryTags: V },
  { id: "v11", name: "Asparagus", category: "Vegetables", calories: 27, protein: 3, carbs: 5, fats: 0.2, servingSize: "6 spears", servingGrams: 90, dietaryTags: V },
  { id: "v12", name: "Green Beans", category: "Vegetables", calories: 31, protein: 1.8, carbs: 7, fats: 0.1, servingSize: "1 cup", servingGrams: 125, dietaryTags: V },
  { id: "v13", name: "Brussels Sprouts", category: "Vegetables", calories: 56, protein: 4, carbs: 12, fats: 0.4, servingSize: "1 cup", servingGrams: 156, dietaryTags: V },
  { id: "v14", name: "Mushrooms (white)", category: "Vegetables", calories: 15, protein: 2.2, carbs: 2.3, fats: 0.2, servingSize: "1 cup", servingGrams: 70, dietaryTags: V },
  { id: "v15", name: "Eggplant / Brinjal", category: "Vegetables", calories: 25, protein: 1, carbs: 6, fats: 0.2, servingSize: "1 cup", servingGrams: 99, dietaryTags: V },
  { id: "v16", name: "Beetroot", category: "Vegetables", calories: 58, protein: 2.2, carbs: 13, fats: 0.2, servingSize: "1 medium", servingGrams: 136, dietaryTags: V },
  { id: "v17", name: "Cabbage (shredded)", category: "Vegetables", calories: 22, protein: 1.3, carbs: 5, fats: 0.1, servingSize: "1 cup", servingGrams: 89, dietaryTags: V },
  { id: "v18", name: "Okra / Bhindi", category: "Vegetables", calories: 33, protein: 2, carbs: 7, fats: 0.2, servingSize: "1 cup", servingGrams: 100, dietaryTags: V },
  { id: "v19", name: "Celery", category: "Vegetables", calories: 6, protein: 0.3, carbs: 1.2, fats: 0.1, servingSize: "1 stalk", servingGrams: 40, dietaryTags: V },
  { id: "v20", name: "Peas (green, cooked)", category: "Vegetables", calories: 118, protein: 8, carbs: 21, fats: 0.4, servingSize: "1 cup", servingGrams: 160, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // DAIRY (~15 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "d1", name: "Greek Yogurt (plain)", category: "Dairy", calories: 100, protein: 17, carbs: 6, fats: 0.7, servingSize: "1 cup", servingGrams: 170, dietaryTags: VE },
  { id: "d2", name: "Whole Milk", category: "Dairy", calories: 149, protein: 8, carbs: 12, fats: 8, servingSize: "1 cup", servingGrams: 244, dietaryTags: VE },
  { id: "d3", name: "Skim Milk", category: "Dairy", calories: 83, protein: 8, carbs: 12, fats: 0.2, servingSize: "1 cup", servingGrams: 245, dietaryTags: VE },
  { id: "d4", name: "Cottage Cheese", category: "Dairy", calories: 163, protein: 28, carbs: 6, fats: 2.3, servingSize: "1 cup", servingGrams: 226, dietaryTags: VE },
  { id: "d5", name: "Cheddar Cheese", category: "Dairy", calories: 113, protein: 7, carbs: 0.4, fats: 9, servingSize: "1 slice", servingGrams: 28, dietaryTags: VE },
  { id: "d6", name: "Mozzarella", category: "Dairy", calories: 85, protein: 6, carbs: 0.7, fats: 6, servingSize: "1 slice", servingGrams: 28, dietaryTags: VE },
  { id: "d7", name: "Parmesan Cheese", category: "Dairy", calories: 110, protein: 10, carbs: 1, fats: 7, servingSize: "28g", servingGrams: 28, dietaryTags: VE },
  { id: "d8", name: "Cream Cheese", category: "Dairy", calories: 99, protein: 2, carbs: 1.6, fats: 10, servingSize: "28g", servingGrams: 28, dietaryTags: VE },
  { id: "d9", name: "Butter", category: "Dairy", calories: 102, protein: 0.1, carbs: 0, fats: 12, servingSize: "1 tbsp", servingGrams: 14, dietaryTags: VE },
  { id: "d10", name: "Yogurt (flavored)", category: "Dairy", calories: 150, protein: 8, carbs: 24, fats: 3, servingSize: "1 cup", servingGrams: 170, dietaryTags: VE },
  { id: "d11", name: "Dahi / Curd", category: "Dairy", calories: 98, protein: 11, carbs: 4, fats: 4.3, servingSize: "1 cup", servingGrams: 200, dietaryTags: VE },
  { id: "d12", name: "Skyr (Icelandic Yogurt)", category: "Dairy", calories: 110, protein: 19, carbs: 7, fats: 0.5, servingSize: "170g", servingGrams: 170, dietaryTags: VE },
  { id: "d13", name: "Ricotta Cheese", category: "Dairy", calories: 174, protein: 11, carbs: 6, fats: 12, servingSize: "½ cup", servingGrams: 124, dietaryTags: VE },
  { id: "d14", name: "Feta Cheese", category: "Dairy", calories: 75, protein: 4, carbs: 1, fats: 6, servingSize: "28g", servingGrams: 28, dietaryTags: VE },
  { id: "d15", name: "Buttermilk / Chaas", category: "Dairy", calories: 40, protein: 3, carbs: 5, fats: 1, servingSize: "1 cup", servingGrams: 245, dietaryTags: VE },

  // ═══════════════════════════════════════════════════════════════════════════
  // SNACKS & NUTS (~20 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "n1", name: "Almonds", category: "Snacks & Nuts", calories: 164, protein: 6, carbs: 6, fats: 14, servingSize: "28g (23 nuts)", servingGrams: 28, dietaryTags: V },
  { id: "n2", name: "Peanut Butter", category: "Snacks & Nuts", calories: 188, protein: 8, carbs: 6, fats: 16, servingSize: "2 tbsp", servingGrams: 32, dietaryTags: V },
  { id: "n3", name: "Walnuts", category: "Snacks & Nuts", calories: 185, protein: 4.3, carbs: 3.9, fats: 18, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n4", name: "Cashews", category: "Snacks & Nuts", calories: 157, protein: 5, carbs: 9, fats: 12, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n5", name: "Trail Mix", category: "Snacks & Nuts", calories: 462, protein: 14, carbs: 44, fats: 29, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "n6", name: "Dark Chocolate (70%)", category: "Snacks & Nuts", calories: 170, protein: 2, carbs: 13, fats: 12, servingSize: "30g", servingGrams: 30, dietaryTags: V },
  { id: "n7", name: "Rice Cakes", category: "Snacks & Nuts", calories: 35, protein: 0.7, carbs: 7.3, fats: 0.3, servingSize: "1 cake", servingGrams: 9, dietaryTags: V },
  { id: "n8", name: "Protein Bar", category: "Snacks & Nuts", calories: 210, protein: 20, carbs: 22, fats: 7, servingSize: "1 bar", servingGrams: 60, dietaryTags: VE },
  { id: "n9", name: "Peanuts (roasted)", category: "Snacks & Nuts", calories: 166, protein: 7, carbs: 6, fats: 14, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n10", name: "Pistachios", category: "Snacks & Nuts", calories: 159, protein: 6, carbs: 8, fats: 13, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n11", name: "Macadamia Nuts", category: "Snacks & Nuts", calories: 204, protein: 2.2, carbs: 4, fats: 21, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n12", name: "Pecans", category: "Snacks & Nuts", calories: 196, protein: 2.6, carbs: 4, fats: 20, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n13", name: "Sunflower Seeds", category: "Snacks & Nuts", calories: 165, protein: 5.5, carbs: 7, fats: 14, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n14", name: "Pumpkin Seeds", category: "Snacks & Nuts", calories: 151, protein: 7, carbs: 5, fats: 13, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n15", name: "Chia Seeds", category: "Snacks & Nuts", calories: 138, protein: 4.7, carbs: 12, fats: 8.7, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n16", name: "Flax Seeds", category: "Snacks & Nuts", calories: 150, protein: 5, carbs: 8, fats: 12, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n17", name: "Hemp Seeds", category: "Snacks & Nuts", calories: 166, protein: 9, carbs: 2.6, fats: 14.6, servingSize: "28g", servingGrams: 28, dietaryTags: V },
  { id: "n18", name: "Granola Bar", category: "Snacks & Nuts", calories: 190, protein: 3, carbs: 29, fats: 7, servingSize: "1 bar", servingGrams: 42, dietaryTags: VE },
  { id: "n19", name: "Makhana / Fox Nuts", category: "Snacks & Nuts", calories: 347, protein: 9.7, carbs: 77, fats: 0.1, servingSize: "100g", servingGrams: 100, dietaryTags: V },
  { id: "n20", name: "Almond Butter", category: "Snacks & Nuts", calories: 196, protein: 7, carbs: 6, fats: 18, servingSize: "2 tbsp", servingGrams: 32, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // BEVERAGES (~12 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "b1", name: "Black Coffee", category: "Beverages", calories: 2, protein: 0.3, carbs: 0, fats: 0, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },
  { id: "b2", name: "Green Tea", category: "Beverages", calories: 2, protein: 0, carbs: 0.5, fats: 0, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },
  { id: "b3", name: "Orange Juice", category: "Beverages", calories: 112, protein: 1.7, carbs: 26, fats: 0.5, servingSize: "1 cup", servingGrams: 248, dietaryTags: V },
  { id: "b4", name: "Coconut Water", category: "Beverages", calories: 46, protein: 1.7, carbs: 9, fats: 0.5, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },
  { id: "b5", name: "Protein Shake (whey)", category: "Beverages", calories: 160, protein: 30, carbs: 5, fats: 2, servingSize: "1 shake", servingGrams: 300, dietaryTags: VE },
  { id: "b6", name: "Almond Milk", category: "Beverages", calories: 39, protein: 1, carbs: 3.4, fats: 2.5, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },
  { id: "b7", name: "Oat Milk", category: "Beverages", calories: 120, protein: 3, carbs: 16, fats: 5, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },
  { id: "b8", name: "Soy Milk", category: "Beverages", calories: 105, protein: 6, carbs: 12, fats: 3.6, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },
  { id: "b9", name: "Smoothie (mixed berry)", category: "Beverages", calories: 150, protein: 3, carbs: 35, fats: 1, servingSize: "1 cup", servingGrams: 250, dietaryTags: V },
  { id: "b10", name: "Latte (whole milk)", category: "Beverages", calories: 190, protein: 10, carbs: 18, fats: 7, servingSize: "12 oz", servingGrams: 360, dietaryTags: VE },
  { id: "b11", name: "Apple Cider Vinegar Drink", category: "Beverages", calories: 5, protein: 0, carbs: 1, fats: 0, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },
  { id: "b12", name: "Kombucha", category: "Beverages", calories: 30, protein: 0, carbs: 7, fats: 0, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // PREPARED MEALS (~20 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "m1", name: "Grilled Chicken Salad", category: "Prepared Meals", calories: 350, protein: 35, carbs: 15, fats: 16, servingSize: "1 bowl", servingGrams: 300, dietaryTags: NV },
  { id: "m2", name: "Chicken & Rice Bowl", category: "Prepared Meals", calories: 480, protein: 35, carbs: 55, fats: 10, servingSize: "1 bowl", servingGrams: 400, dietaryTags: NV },
  { id: "m3", name: "Turkey Sandwich", category: "Prepared Meals", calories: 320, protein: 22, carbs: 38, fats: 8, servingSize: "1 sandwich", servingGrams: 200, dietaryTags: NV },
  { id: "m4", name: "Burrito Bowl", category: "Prepared Meals", calories: 520, protein: 28, carbs: 60, fats: 18, servingSize: "1 bowl", servingGrams: 450, dietaryTags: NV },
  { id: "m5", name: "Stir-fry Tofu & Veggies", category: "Prepared Meals", calories: 280, protein: 18, carbs: 25, fats: 12, servingSize: "1 plate", servingGrams: 350, dietaryTags: V },
  { id: "m6", name: "Salmon & Vegetables", category: "Prepared Meals", calories: 380, protein: 32, carbs: 12, fats: 22, servingSize: "1 plate", servingGrams: 350, dietaryTags: NV },
  { id: "m7", name: "Pasta with Meat Sauce", category: "Prepared Meals", calories: 450, protein: 22, carbs: 58, fats: 14, servingSize: "1 plate", servingGrams: 350, dietaryTags: NV },
  { id: "m8", name: "Caesar Salad", category: "Prepared Meals", calories: 320, protein: 8, carbs: 14, fats: 26, servingSize: "1 bowl", servingGrams: 250, dietaryTags: VE },
  { id: "m9", name: "Poke Bowl", category: "Prepared Meals", calories: 460, protein: 30, carbs: 48, fats: 16, servingSize: "1 bowl", servingGrams: 400, dietaryTags: NV },
  { id: "m10", name: "Veggie Wrap", category: "Prepared Meals", calories: 340, protein: 12, carbs: 42, fats: 14, servingSize: "1 wrap", servingGrams: 250, dietaryTags: V },
  { id: "m11", name: "Grilled Fish Tacos", category: "Prepared Meals", calories: 420, protein: 25, carbs: 38, fats: 18, servingSize: "2 tacos", servingGrams: 280, dietaryTags: NV },
  { id: "m12", name: "Buddha Bowl", category: "Prepared Meals", calories: 380, protein: 16, carbs: 50, fats: 14, servingSize: "1 bowl", servingGrams: 400, dietaryTags: V },
  { id: "m13", name: "Protein Pancakes", category: "Prepared Meals", calories: 350, protein: 28, carbs: 38, fats: 10, servingSize: "3 pancakes", servingGrams: 200, dietaryTags: VE },
  { id: "m14", name: "Beef Stir-Fry", category: "Prepared Meals", calories: 430, protein: 30, carbs: 28, fats: 22, servingSize: "1 plate", servingGrams: 350, dietaryTags: NV },
  { id: "m15", name: "Overnight Oats", category: "Prepared Meals", calories: 310, protein: 12, carbs: 48, fats: 8, servingSize: "1 jar", servingGrams: 300, dietaryTags: VE },
  { id: "m16", name: "Quinoa Power Bowl", category: "Prepared Meals", calories: 400, protein: 18, carbs: 52, fats: 14, servingSize: "1 bowl", servingGrams: 380, dietaryTags: V },
  { id: "m17", name: "Acai Bowl", category: "Prepared Meals", calories: 350, protein: 6, carbs: 60, fats: 10, servingSize: "1 bowl", servingGrams: 300, dietaryTags: V },
  { id: "m18", name: "Egg Fried Rice", category: "Prepared Meals", calories: 370, protein: 12, carbs: 52, fats: 13, servingSize: "1 plate", servingGrams: 300, dietaryTags: EG },
  { id: "m19", name: "Chicken Caesar Wrap", category: "Prepared Meals", calories: 440, protein: 30, carbs: 35, fats: 20, servingSize: "1 wrap", servingGrams: 280, dietaryTags: NV },
  { id: "m20", name: "Lentil Soup", category: "Prepared Meals", calories: 230, protein: 14, carbs: 38, fats: 3, servingSize: "1 bowl", servingGrams: 350, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // BREADS & BAKERY (~12 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "br1", name: "Whole Wheat Bread", category: "Breads & Bakery", calories: 69, protein: 3.6, carbs: 12, fats: 1.1, servingSize: "1 slice", servingGrams: 28, dietaryTags: V },
  { id: "br2", name: "White Bread", category: "Breads & Bakery", calories: 79, protein: 2.7, carbs: 15, fats: 1, servingSize: "1 slice", servingGrams: 30, dietaryTags: V },
  { id: "br3", name: "Bagel", category: "Breads & Bakery", calories: 245, protein: 10, carbs: 48, fats: 1.5, servingSize: "1 bagel", servingGrams: 98, dietaryTags: V },
  { id: "br4", name: "Tortilla (flour)", category: "Breads & Bakery", calories: 146, protein: 4, carbs: 25, fats: 3.5, servingSize: "1 tortilla", servingGrams: 49, dietaryTags: V },
  { id: "br5", name: "Croissant", category: "Breads & Bakery", calories: 231, protein: 5, carbs: 26, fats: 12, servingSize: "1 piece", servingGrams: 57, dietaryTags: VE },
  { id: "br6", name: "Pita Bread", category: "Breads & Bakery", calories: 165, protein: 5.5, carbs: 33, fats: 0.7, servingSize: "1 pita", servingGrams: 57, dietaryTags: V },
  { id: "br7", name: "Sourdough Bread", category: "Breads & Bakery", calories: 93, protein: 4, carbs: 18, fats: 0.6, servingSize: "1 slice", servingGrams: 36, dietaryTags: V },
  { id: "br8", name: "English Muffin", category: "Breads & Bakery", calories: 132, protein: 5, carbs: 26, fats: 1, servingSize: "1 muffin", servingGrams: 57, dietaryTags: V },
  { id: "br9", name: "Naan (plain)", category: "Breads & Bakery", calories: 262, protein: 9, carbs: 45, fats: 5, servingSize: "1 naan", servingGrams: 90, dietaryTags: VE },
  { id: "br10", name: "Corn Tortilla", category: "Breads & Bakery", calories: 52, protein: 1.4, carbs: 11, fats: 0.7, servingSize: "1 tortilla", servingGrams: 26, dietaryTags: V },
  { id: "br11", name: "Ciabatta Roll", category: "Breads & Bakery", calories: 240, protein: 8, carbs: 46, fats: 3, servingSize: "1 roll", servingGrams: 85, dietaryTags: V },
  { id: "br12", name: "Multigrain Bread", category: "Breads & Bakery", calories: 75, protein: 4, carbs: 13, fats: 1.2, servingSize: "1 slice", servingGrams: 32, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // INDIAN - NORTH (~25 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "in1", name: "Dal Tadka", category: "Indian - North", calories: 150, protein: 9, carbs: 22, fats: 3, servingSize: "1 bowl", servingGrams: 200, dietaryTags: V },
  { id: "in2", name: "Dal Makhani", category: "Indian - North", calories: 185, protein: 10, carbs: 25, fats: 6, servingSize: "1 bowl", servingGrams: 200, dietaryTags: VE },
  { id: "in3", name: "Roti / Chapati", category: "Indian - North", calories: 104, protein: 3, carbs: 18, fats: 3, servingSize: "1 roti", servingGrams: 40, dietaryTags: V },
  { id: "in4", name: "Butter Naan", category: "Indian - North", calories: 317, protein: 9, carbs: 55, fats: 8, servingSize: "1 naan", servingGrams: 110, dietaryTags: VE },
  { id: "in5", name: "Plain Paratha", category: "Indian - North", calories: 215, protein: 5, carbs: 28, fats: 10, servingSize: "1 paratha", servingGrams: 80, dietaryTags: VE },
  { id: "in6", name: "Aloo Paratha", category: "Indian - North", calories: 260, protein: 6, carbs: 35, fats: 11, servingSize: "1 paratha", servingGrams: 100, dietaryTags: VE },
  { id: "in7", name: "Butter Chicken", category: "Indian - North", calories: 240, protein: 18, carbs: 8, fats: 15, servingSize: "1 serving", servingGrams: 200, dietaryTags: NV },
  { id: "in8", name: "Paneer Butter Masala", category: "Indian - North", calories: 320, protein: 15, carbs: 14, fats: 24, servingSize: "1 serving", servingGrams: 200, dietaryTags: VE },
  { id: "in9", name: "Palak Paneer", category: "Indian - North", calories: 200, protein: 12, carbs: 10, fats: 14, servingSize: "1 serving", servingGrams: 200, dietaryTags: VE },
  { id: "in10", name: "Aloo Gobi", category: "Indian - North", calories: 150, protein: 5, carbs: 22, fats: 6, servingSize: "1 serving", servingGrams: 200, dietaryTags: V },
  { id: "in11", name: "Rajma (Kidney Bean Curry)", category: "Indian - North", calories: 180, protein: 10, carbs: 28, fats: 3, servingSize: "1 bowl", servingGrams: 200, dietaryTags: V },
  { id: "in12", name: "Chole / Chana Masala", category: "Indian - North", calories: 210, protein: 10, carbs: 30, fats: 6, servingSize: "1 bowl", servingGrams: 200, dietaryTags: V },
  { id: "in13", name: "Rajma Chawal", category: "Indian - North", calories: 420, protein: 16, carbs: 72, fats: 6, servingSize: "1 plate", servingGrams: 350, dietaryTags: V },
  { id: "in14", name: "Chole Bhature", category: "Indian - North", calories: 480, protein: 16, carbs: 65, fats: 18, servingSize: "1 plate", servingGrams: 350, dietaryTags: VE },
  { id: "in15", name: "Tandoori Chicken", category: "Indian - North", calories: 195, protein: 28, carbs: 6, fats: 7, servingSize: "2 pieces", servingGrams: 200, dietaryTags: NV },
  { id: "in16", name: "Biryani (Chicken)", category: "Indian - North", calories: 350, protein: 18, carbs: 45, fats: 10, servingSize: "1 plate", servingGrams: 300, dietaryTags: NV },
  { id: "in17", name: "Biryani (Veg)", category: "Indian - North", calories: 290, protein: 8, carbs: 48, fats: 8, servingSize: "1 plate", servingGrams: 300, dietaryTags: VE },
  { id: "in18", name: "Matar Paneer", category: "Indian - North", calories: 240, protein: 12, carbs: 16, fats: 15, servingSize: "1 serving", servingGrams: 200, dietaryTags: VE },
  { id: "in19", name: "Shahi Paneer", category: "Indian - North", calories: 350, protein: 14, carbs: 15, fats: 27, servingSize: "1 serving", servingGrams: 200, dietaryTags: VE },
  { id: "in20", name: "Kadai Chicken", category: "Indian - North", calories: 280, protein: 26, carbs: 10, fats: 16, servingSize: "1 serving", servingGrams: 200, dietaryTags: NV },
  { id: "in21", name: "Mutton Curry", category: "Indian - North", calories: 320, protein: 28, carbs: 8, fats: 20, servingSize: "1 serving", servingGrams: 200, dietaryTags: NV },
  { id: "in22", name: "Jeera Rice", category: "Indian - North", calories: 200, protein: 4, carbs: 38, fats: 5, servingSize: "1 cup", servingGrams: 175, dietaryTags: V },
  { id: "in23", name: "Kadhi Pakora", category: "Indian - North", calories: 180, protein: 6, carbs: 18, fats: 10, servingSize: "1 bowl", servingGrams: 200, dietaryTags: VE },
  { id: "in24", name: "Baingan Bharta", category: "Indian - North", calories: 120, protein: 3, carbs: 14, fats: 6, servingSize: "1 serving", servingGrams: 200, dietaryTags: V },
  { id: "in25", name: "Malai Kofta", category: "Indian - North", calories: 340, protein: 10, carbs: 22, fats: 24, servingSize: "1 serving", servingGrams: 200, dietaryTags: VE },
  { id: "in26", name: "Keema (Mutton Mince)", category: "Indian - North", calories: 250, protein: 22, carbs: 6, fats: 16, servingSize: "1 serving", servingGrams: 200, dietaryTags: NV },
  { id: "in27", name: "Egg Curry", category: "Indian - North", calories: 200, protein: 14, carbs: 10, fats: 13, servingSize: "1 serving", servingGrams: 200, dietaryTags: EG },

  // ═══════════════════════════════════════════════════════════════════════════
  // INDIAN - SOUTH (~18 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "is1", name: "Idli", category: "Indian - South", calories: 39, protein: 2, carbs: 8, fats: 0.2, servingSize: "1 piece", servingGrams: 30, dietaryTags: V },
  { id: "is2", name: "Dosa (Plain)", category: "Indian - South", calories: 120, protein: 3, carbs: 18, fats: 4, servingSize: "1 dosa", servingGrams: 80, dietaryTags: V },
  { id: "is3", name: "Masala Dosa", category: "Indian - South", calories: 200, protein: 5, carbs: 28, fats: 8, servingSize: "1 dosa", servingGrams: 130, dietaryTags: VE },
  { id: "is4", name: "Rava Dosa", category: "Indian - South", calories: 175, protein: 4, carbs: 24, fats: 7, servingSize: "1 dosa", servingGrams: 100, dietaryTags: VE },
  { id: "is5", name: "Uttapam", category: "Indian - South", calories: 185, protein: 5, carbs: 26, fats: 7, servingSize: "1 piece", servingGrams: 110, dietaryTags: VE },
  { id: "is6", name: "Sambar", category: "Indian - South", calories: 90, protein: 5, carbs: 14, fats: 2, servingSize: "1 bowl", servingGrams: 200, dietaryTags: V },
  { id: "is7", name: "Rasam", category: "Indian - South", calories: 50, protein: 2, carbs: 8, fats: 1.5, servingSize: "1 bowl", servingGrams: 200, dietaryTags: V },
  { id: "is8", name: "Upma", category: "Indian - South", calories: 180, protein: 4, carbs: 28, fats: 6, servingSize: "1 bowl", servingGrams: 200, dietaryTags: VE },
  { id: "is9", name: "Pongal (Ven Pongal)", category: "Indian - South", calories: 210, protein: 6, carbs: 34, fats: 7, servingSize: "1 bowl", servingGrams: 200, dietaryTags: VE },
  { id: "is10", name: "Appam", category: "Indian - South", calories: 80, protein: 2, carbs: 15, fats: 2, servingSize: "1 piece", servingGrams: 60, dietaryTags: VE },
  { id: "is11", name: "Puttu", category: "Indian - South", calories: 160, protein: 3, carbs: 32, fats: 2, servingSize: "1 serving", servingGrams: 100, dietaryTags: V },
  { id: "is12", name: "Avial", category: "Indian - South", calories: 130, protein: 3, carbs: 15, fats: 7, servingSize: "1 serving", servingGrams: 180, dietaryTags: VE },
  { id: "is13", name: "Vada (Medu Vada)", category: "Indian - South", calories: 110, protein: 4, carbs: 14, fats: 5, servingSize: "1 piece", servingGrams: 50, dietaryTags: V },
  { id: "is14", name: "Coconut Chutney", category: "Indian - South", calories: 60, protein: 1.5, carbs: 4, fats: 5, servingSize: "2 tbsp", servingGrams: 40, dietaryTags: V },
  { id: "is15", name: "Kerala Fish Curry", category: "Indian - South", calories: 200, protein: 20, carbs: 6, fats: 11, servingSize: "1 serving", servingGrams: 200, dietaryTags: NV },
  { id: "is16", name: "Pesarattu", category: "Indian - South", calories: 140, protein: 7, carbs: 20, fats: 4, servingSize: "1 piece", servingGrams: 80, dietaryTags: V },
  { id: "is17", name: "Chettinad Chicken", category: "Indian - South", calories: 290, protein: 25, carbs: 8, fats: 18, servingSize: "1 serving", servingGrams: 200, dietaryTags: NV },
  { id: "is18", name: "Lemon Rice", category: "Indian - South", calories: 220, protein: 4, carbs: 40, fats: 6, servingSize: "1 cup", servingGrams: 180, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // INDIAN - STREET FOOD (~12 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "isf1", name: "Samosa", category: "Indian - Street Food", calories: 260, protein: 5, carbs: 32, fats: 13, servingSize: "1 piece", servingGrams: 100, dietaryTags: VE },
  { id: "isf2", name: "Pav Bhaji", category: "Indian - Street Food", calories: 380, protein: 10, carbs: 52, fats: 16, servingSize: "1 plate", servingGrams: 280, dietaryTags: VE },
  { id: "isf3", name: "Vada Pav", category: "Indian - Street Food", calories: 290, protein: 7, carbs: 42, fats: 11, servingSize: "1 piece", servingGrams: 150, dietaryTags: VE },
  { id: "isf4", name: "Bhel Puri", category: "Indian - Street Food", calories: 200, protein: 5, carbs: 38, fats: 4, servingSize: "1 bowl", servingGrams: 180, dietaryTags: V },
  { id: "isf5", name: "Sev Puri", category: "Indian - Street Food", calories: 230, protein: 5, carbs: 32, fats: 10, servingSize: "4 pieces", servingGrams: 140, dietaryTags: VE },
  { id: "isf6", name: "Pani Puri / Golgappe", category: "Indian - Street Food", calories: 180, protein: 3, carbs: 35, fats: 3, servingSize: "6 pieces", servingGrams: 150, dietaryTags: V },
  { id: "isf7", name: "Kachori", category: "Indian - Street Food", calories: 280, protein: 6, carbs: 30, fats: 16, servingSize: "1 piece", servingGrams: 80, dietaryTags: VE },
  { id: "isf8", name: "Aloo Tikki", category: "Indian - Street Food", calories: 220, protein: 4, carbs: 28, fats: 11, servingSize: "1 piece", servingGrams: 100, dietaryTags: VE },
  { id: "isf9", name: "Dahi Puri", category: "Indian - Street Food", calories: 200, protein: 5, carbs: 30, fats: 7, servingSize: "4 pieces", servingGrams: 150, dietaryTags: VE },
  { id: "isf10", name: "Dabeli", category: "Indian - Street Food", calories: 220, protein: 5, carbs: 38, fats: 6, servingSize: "1 piece", servingGrams: 120, dietaryTags: VE },
  { id: "isf11", name: "Egg Roll / Egg Kathi Roll", category: "Indian - Street Food", calories: 320, protein: 14, carbs: 36, fats: 14, servingSize: "1 roll", servingGrams: 180, dietaryTags: EG },
  { id: "isf12", name: "Chicken Momos (steamed)", category: "Indian - Street Food", calories: 210, protein: 12, carbs: 24, fats: 8, servingSize: "6 pieces", servingGrams: 150, dietaryTags: NV },

  // ═══════════════════════════════════════════════════════════════════════════
  // INDIAN - SWEETS (~8 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "isw1", name: "Gulab Jamun", category: "Indian - Sweets", calories: 175, protein: 3, carbs: 30, fats: 6, servingSize: "2 pieces", servingGrams: 80, dietaryTags: VE },
  { id: "isw2", name: "Rasgulla", category: "Indian - Sweets", calories: 130, protein: 5, carbs: 24, fats: 2, servingSize: "2 pieces", servingGrams: 80, dietaryTags: VE },
  { id: "isw3", name: "Jalebi", category: "Indian - Sweets", calories: 150, protein: 1, carbs: 30, fats: 3, servingSize: "2 pieces", servingGrams: 60, dietaryTags: VE },
  { id: "isw4", name: "Barfi (plain)", category: "Indian - Sweets", calories: 180, protein: 4, carbs: 28, fats: 7, servingSize: "2 pieces", servingGrams: 60, dietaryTags: VE },
  { id: "isw5", name: "Ladoo (besan)", category: "Indian - Sweets", calories: 160, protein: 3, carbs: 20, fats: 8, servingSize: "1 piece", servingGrams: 40, dietaryTags: VE },
  { id: "isw6", name: "Halwa (suji)", category: "Indian - Sweets", calories: 280, protein: 4, carbs: 40, fats: 12, servingSize: "1 bowl", servingGrams: 120, dietaryTags: VE },
  { id: "isw7", name: "Kheer / Payasam", category: "Indian - Sweets", calories: 220, protein: 6, carbs: 38, fats: 5, servingSize: "1 bowl", servingGrams: 200, dietaryTags: VE },
  { id: "isw8", name: "Gajar Ka Halwa", category: "Indian - Sweets", calories: 250, protein: 4, carbs: 36, fats: 10, servingSize: "1 bowl", servingGrams: 150, dietaryTags: VE },

  // ═══════════════════════════════════════════════════════════════════════════
  // INDIAN - BEVERAGES (~6 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "ib1", name: "Masala Chai", category: "Indian - Beverages", calories: 80, protein: 3, carbs: 10, fats: 3, servingSize: "1 cup", servingGrams: 180, dietaryTags: VE },
  { id: "ib2", name: "Lassi (sweet)", category: "Indian - Beverages", calories: 170, protein: 6, carbs: 28, fats: 4, servingSize: "1 glass", servingGrams: 250, dietaryTags: VE },
  { id: "ib3", name: "Mango Lassi", category: "Indian - Beverages", calories: 200, protein: 5, carbs: 36, fats: 4, servingSize: "1 glass", servingGrams: 250, dietaryTags: VE },
  { id: "ib4", name: "Nimbu Pani / Limewater", category: "Indian - Beverages", calories: 40, protein: 0, carbs: 10, fats: 0, servingSize: "1 glass", servingGrams: 250, dietaryTags: V },
  { id: "ib5", name: "Thandai", category: "Indian - Beverages", calories: 200, protein: 5, carbs: 28, fats: 8, servingSize: "1 glass", servingGrams: 250, dietaryTags: VE },
  { id: "ib6", name: "Jaljeera", category: "Indian - Beverages", calories: 30, protein: 0.5, carbs: 7, fats: 0, servingSize: "1 glass", servingGrams: 250, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // MEXICAN (~12 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "mx1", name: "Chicken Burrito", category: "Mexican", calories: 580, protein: 28, carbs: 60, fats: 24, servingSize: "1 burrito", servingGrams: 350, dietaryTags: NV },
  { id: "mx2", name: "Beef Tacos", category: "Mexican", calories: 340, protein: 18, carbs: 28, fats: 18, servingSize: "2 tacos", servingGrams: 200, dietaryTags: NV },
  { id: "mx3", name: "Quesadilla (cheese)", category: "Mexican", calories: 330, protein: 14, carbs: 32, fats: 16, servingSize: "1 quesadilla", servingGrams: 150, dietaryTags: VE },
  { id: "mx4", name: "Guacamole", category: "Mexican", calories: 150, protein: 2, carbs: 8, fats: 13, servingSize: "¼ cup", servingGrams: 60, dietaryTags: V },
  { id: "mx5", name: "Nachos with Cheese", category: "Mexican", calories: 420, protein: 12, carbs: 48, fats: 22, servingSize: "1 plate", servingGrams: 200, dietaryTags: VE },
  { id: "mx6", name: "Enchiladas (chicken)", category: "Mexican", calories: 380, protein: 22, carbs: 34, fats: 18, servingSize: "2 pieces", servingGrams: 250, dietaryTags: NV },
  { id: "mx7", name: "Bean & Rice Bowl", category: "Mexican", calories: 380, protein: 14, carbs: 62, fats: 8, servingSize: "1 bowl", servingGrams: 350, dietaryTags: V },
  { id: "mx8", name: "Chicken Fajitas", category: "Mexican", calories: 350, protein: 28, carbs: 22, fats: 16, servingSize: "1 plate", servingGrams: 280, dietaryTags: NV },
  { id: "mx9", name: "Churros", category: "Mexican", calories: 240, protein: 3, carbs: 30, fats: 12, servingSize: "3 pieces", servingGrams: 80, dietaryTags: VE },
  { id: "mx10", name: "Elote (Mexican corn)", category: "Mexican", calories: 200, protein: 4, carbs: 24, fats: 10, servingSize: "1 ear", servingGrams: 130, dietaryTags: VE },
  { id: "mx11", name: "Tamales", category: "Mexican", calories: 285, protein: 10, carbs: 28, fats: 15, servingSize: "1 tamale", servingGrams: 130, dietaryTags: NV },
  { id: "mx12", name: "Pozole (pork)", category: "Mexican", calories: 280, protein: 20, carbs: 30, fats: 10, servingSize: "1 bowl", servingGrams: 350, dietaryTags: NV },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHINESE & ASIAN (~15 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "ch1", name: "Fried Rice", category: "Chinese & Asian", calories: 340, protein: 8, carbs: 52, fats: 12, servingSize: "1 plate", servingGrams: 250, dietaryTags: VE },
  { id: "ch2", name: "Chow Mein", category: "Chinese & Asian", calories: 300, protein: 10, carbs: 42, fats: 10, servingSize: "1 plate", servingGrams: 250, dietaryTags: VE },
  { id: "ch3", name: "Kung Pao Chicken", category: "Chinese & Asian", calories: 380, protein: 28, carbs: 18, fats: 22, servingSize: "1 serving", servingGrams: 250, dietaryTags: NV },
  { id: "ch4", name: "Spring Rolls (fried)", category: "Chinese & Asian", calories: 250, protein: 5, carbs: 28, fats: 13, servingSize: "4 pieces", servingGrams: 120, dietaryTags: VE },
  { id: "ch5", name: "Sweet & Sour Chicken", category: "Chinese & Asian", calories: 420, protein: 20, carbs: 50, fats: 16, servingSize: "1 serving", servingGrams: 280, dietaryTags: NV },
  { id: "ch6", name: "Dim Sum (Har Gow)", category: "Chinese & Asian", calories: 200, protein: 12, carbs: 24, fats: 6, servingSize: "5 pieces", servingGrams: 120, dietaryTags: NV },
  { id: "ch7", name: "Wonton Soup", category: "Chinese & Asian", calories: 180, protein: 10, carbs: 22, fats: 6, servingSize: "1 bowl", servingGrams: 300, dietaryTags: NV },
  { id: "ch8", name: "Pad Thai", category: "Chinese & Asian", calories: 380, protein: 14, carbs: 52, fats: 14, servingSize: "1 plate", servingGrams: 300, dietaryTags: NV },
  { id: "ch9", name: "Tom Yum Soup", category: "Chinese & Asian", calories: 120, protein: 8, carbs: 10, fats: 5, servingSize: "1 bowl", servingGrams: 300, dietaryTags: NV },
  { id: "ch10", name: "Green Curry (chicken)", category: "Chinese & Asian", calories: 350, protein: 22, carbs: 12, fats: 24, servingSize: "1 serving", servingGrams: 250, dietaryTags: NV },
  { id: "ch11", name: "Pho (beef)", category: "Chinese & Asian", calories: 400, protein: 25, carbs: 45, fats: 12, servingSize: "1 bowl", servingGrams: 500, dietaryTags: NV },
  { id: "ch12", name: "Bibimbap", category: "Chinese & Asian", calories: 490, protein: 22, carbs: 62, fats: 16, servingSize: "1 bowl", servingGrams: 450, dietaryTags: NV },
  { id: "ch13", name: "Bulgogi (Korean BBQ)", category: "Chinese & Asian", calories: 290, protein: 28, carbs: 12, fats: 15, servingSize: "1 serving", servingGrams: 200, dietaryTags: NV },
  { id: "ch14", name: "Tofu Stir-Fry (Thai basil)", category: "Chinese & Asian", calories: 260, protein: 16, carbs: 20, fats: 14, servingSize: "1 plate", servingGrams: 300, dietaryTags: V },
  { id: "ch15", name: "Bao Bun (pork)", category: "Chinese & Asian", calories: 230, protein: 10, carbs: 32, fats: 7, servingSize: "1 bun", servingGrams: 80, dietaryTags: NV },

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDITERRANEAN (~10 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "md1", name: "Hummus", category: "Mediterranean", calories: 166, protein: 8, carbs: 14, fats: 10, servingSize: "¼ cup", servingGrams: 60, dietaryTags: V },
  { id: "md2", name: "Falafel", category: "Mediterranean", calories: 330, protein: 13, carbs: 31, fats: 18, servingSize: "4 balls", servingGrams: 120, dietaryTags: V },
  { id: "md3", name: "Greek Salad", category: "Mediterranean", calories: 200, protein: 6, carbs: 10, fats: 16, servingSize: "1 bowl", servingGrams: 200, dietaryTags: VE },
  { id: "md4", name: "Grilled Chicken Pita", category: "Mediterranean", calories: 380, protein: 26, carbs: 40, fats: 12, servingSize: "1 pita", servingGrams: 250, dietaryTags: NV },
  { id: "md5", name: "Tabouleh", category: "Mediterranean", calories: 130, protein: 3, carbs: 18, fats: 6, servingSize: "1 cup", servingGrams: 160, dietaryTags: V },
  { id: "md6", name: "Baba Ganoush", category: "Mediterranean", calories: 80, protein: 2, carbs: 6, fats: 6, servingSize: "¼ cup", servingGrams: 60, dietaryTags: V },
  { id: "md7", name: "Shawarma (chicken)", category: "Mediterranean", calories: 420, protein: 28, carbs: 38, fats: 18, servingSize: "1 wrap", servingGrams: 300, dietaryTags: NV },
  { id: "md8", name: "Lamb Kebab", category: "Mediterranean", calories: 320, protein: 26, carbs: 4, fats: 22, servingSize: "2 skewers", servingGrams: 160, dietaryTags: NV },
  { id: "md9", name: "Dolma / Stuffed Grape Leaves", category: "Mediterranean", calories: 190, protein: 4, carbs: 20, fats: 10, servingSize: "5 pieces", servingGrams: 100, dietaryTags: V },
  { id: "md10", name: "Moussaka", category: "Mediterranean", calories: 350, protein: 18, carbs: 22, fats: 22, servingSize: "1 serving", servingGrams: 250, dietaryTags: NV },

  // ═══════════════════════════════════════════════════════════════════════════
  // ITALIAN (~12 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "it1", name: "Margherita Pizza", category: "Italian", calories: 250, protein: 11, carbs: 32, fats: 9, servingSize: "1 slice", servingGrams: 107, dietaryTags: VE },
  { id: "it2", name: "Pasta Carbonara", category: "Italian", calories: 520, protein: 22, carbs: 58, fats: 22, servingSize: "1 plate", servingGrams: 300, dietaryTags: NV },
  { id: "it3", name: "Lasagna (meat)", category: "Italian", calories: 380, protein: 22, carbs: 30, fats: 18, servingSize: "1 slice", servingGrams: 250, dietaryTags: NV },
  { id: "it4", name: "Risotto", category: "Italian", calories: 340, protein: 8, carbs: 52, fats: 12, servingSize: "1 plate", servingGrams: 280, dietaryTags: VE },
  { id: "it5", name: "Pesto Pasta", category: "Italian", calories: 450, protein: 14, carbs: 52, fats: 22, servingSize: "1 plate", servingGrams: 300, dietaryTags: VE },
  { id: "it6", name: "Bruschetta", category: "Italian", calories: 120, protein: 3, carbs: 18, fats: 4, servingSize: "2 pieces", servingGrams: 80, dietaryTags: V },
  { id: "it7", name: "Caprese Salad", category: "Italian", calories: 250, protein: 12, carbs: 6, fats: 20, servingSize: "1 serving", servingGrams: 200, dietaryTags: VE },
  { id: "it8", name: "Minestrone Soup", category: "Italian", calories: 120, protein: 5, carbs: 20, fats: 3, servingSize: "1 bowl", servingGrams: 300, dietaryTags: V },
  { id: "it9", name: "Gnocchi (with sauce)", category: "Italian", calories: 340, protein: 8, carbs: 48, fats: 12, servingSize: "1 plate", servingGrams: 280, dietaryTags: VE },
  { id: "it10", name: "Tiramisu", category: "Italian", calories: 300, protein: 5, carbs: 32, fats: 16, servingSize: "1 slice", servingGrams: 120, dietaryTags: VE },
  { id: "it11", name: "Chicken Parmesan", category: "Italian", calories: 420, protein: 32, carbs: 24, fats: 22, servingSize: "1 serving", servingGrams: 280, dietaryTags: NV },
  { id: "it12", name: "Arancini (rice balls)", category: "Italian", calories: 280, protein: 8, carbs: 34, fats: 12, servingSize: "2 pieces", servingGrams: 120, dietaryTags: VE },

  // ═══════════════════════════════════════════════════════════════════════════
  // JAPANESE (~12 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "jp1", name: "Sushi (salmon, 6pc)", category: "Japanese", calories: 280, protein: 14, carbs: 38, fats: 7, servingSize: "6 pieces", servingGrams: 200, dietaryTags: NV },
  { id: "jp2", name: "Sashimi (assorted)", category: "Japanese", calories: 120, protein: 24, carbs: 0, fats: 2, servingSize: "6 slices", servingGrams: 100, dietaryTags: NV },
  { id: "jp3", name: "Ramen (tonkotsu)", category: "Japanese", calories: 550, protein: 24, carbs: 60, fats: 22, servingSize: "1 bowl", servingGrams: 500, dietaryTags: NV },
  { id: "jp4", name: "Miso Soup", category: "Japanese", calories: 40, protein: 3, carbs: 5, fats: 1, servingSize: "1 cup", servingGrams: 240, dietaryTags: V },
  { id: "jp5", name: "Teriyaki Chicken", category: "Japanese", calories: 320, protein: 28, carbs: 18, fats: 14, servingSize: "1 serving", servingGrams: 200, dietaryTags: NV },
  { id: "jp6", name: "Edamame", category: "Japanese", calories: 121, protein: 12, carbs: 9, fats: 5, servingSize: "1 cup", servingGrams: 155, dietaryTags: V },
  { id: "jp7", name: "Tempura (vegetable)", category: "Japanese", calories: 280, protein: 5, carbs: 34, fats: 14, servingSize: "5 pieces", servingGrams: 120, dietaryTags: VE },
  { id: "jp8", name: "Onigiri (rice ball)", category: "Japanese", calories: 180, protein: 4, carbs: 38, fats: 1, servingSize: "1 piece", servingGrams: 120, dietaryTags: V },
  { id: "jp9", name: "Udon Noodle Soup", category: "Japanese", calories: 340, protein: 10, carbs: 60, fats: 6, servingSize: "1 bowl", servingGrams: 400, dietaryTags: V },
  { id: "jp10", name: "Katsu Curry (chicken)", category: "Japanese", calories: 580, protein: 26, carbs: 62, fats: 24, servingSize: "1 plate", servingGrams: 400, dietaryTags: NV },
  { id: "jp11", name: "Gyoza (pan-fried)", category: "Japanese", calories: 230, protein: 10, carbs: 26, fats: 10, servingSize: "6 pieces", servingGrams: 120, dietaryTags: NV },
  { id: "jp12", name: "Matcha Latte", category: "Japanese", calories: 140, protein: 6, carbs: 18, fats: 5, servingSize: "1 cup", servingGrams: 240, dietaryTags: VE },

  // ═══════════════════════════════════════════════════════════════════════════
  // MIDDLE EASTERN (~8 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "me1", name: "Shakshuka", category: "Middle Eastern", calories: 260, protein: 14, carbs: 18, fats: 16, servingSize: "1 serving", servingGrams: 250, dietaryTags: EG },
  { id: "me2", name: "Labneh", category: "Middle Eastern", calories: 80, protein: 4, carbs: 3, fats: 6, servingSize: "2 tbsp", servingGrams: 30, dietaryTags: VE },
  { id: "me3", name: "Fattoush Salad", category: "Middle Eastern", calories: 160, protein: 4, carbs: 20, fats: 8, servingSize: "1 bowl", servingGrams: 200, dietaryTags: V },
  { id: "me4", name: "Manakeesh (za'atar)", category: "Middle Eastern", calories: 280, protein: 6, carbs: 38, fats: 12, servingSize: "1 piece", servingGrams: 130, dietaryTags: V },
  { id: "me5", name: "Kibbeh", category: "Middle Eastern", calories: 300, protein: 16, carbs: 22, fats: 16, servingSize: "3 pieces", servingGrams: 120, dietaryTags: NV },
  { id: "me6", name: "Halloumi (grilled)", category: "Middle Eastern", calories: 320, protein: 22, carbs: 3, fats: 25, servingSize: "100g", servingGrams: 100, dietaryTags: VE },
  { id: "me7", name: "Kofta (lamb)", category: "Middle Eastern", calories: 280, protein: 22, carbs: 4, fats: 20, servingSize: "2 skewers", servingGrams: 140, dietaryTags: NV },
  { id: "me8", name: "Stuffed Bell Peppers", category: "Middle Eastern", calories: 260, protein: 12, carbs: 30, fats: 12, servingSize: "2 halves", servingGrams: 250, dietaryTags: NV },

  // ═══════════════════════════════════════════════════════════════════════════
  // AMERICAN (~12 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "am1", name: "Cheeseburger", category: "American", calories: 520, protein: 28, carbs: 40, fats: 28, servingSize: "1 burger", servingGrams: 220, dietaryTags: NV },
  { id: "am2", name: "Hot Dog", category: "American", calories: 290, protein: 10, carbs: 24, fats: 18, servingSize: "1 hot dog", servingGrams: 100, dietaryTags: NV },
  { id: "am3", name: "Mac & Cheese", category: "American", calories: 380, protein: 14, carbs: 42, fats: 18, servingSize: "1 cup", servingGrams: 200, dietaryTags: VE },
  { id: "am4", name: "Grilled Cheese Sandwich", category: "American", calories: 400, protein: 16, carbs: 36, fats: 22, servingSize: "1 sandwich", servingGrams: 160, dietaryTags: VE },
  { id: "am5", name: "BBQ Chicken Wings", category: "American", calories: 430, protein: 32, carbs: 14, fats: 28, servingSize: "6 wings", servingGrams: 200, dietaryTags: NV },
  { id: "am6", name: "BLT Sandwich", category: "American", calories: 350, protein: 12, carbs: 30, fats: 22, servingSize: "1 sandwich", servingGrams: 180, dietaryTags: NV },
  { id: "am7", name: "Clam Chowder", category: "American", calories: 250, protein: 10, carbs: 22, fats: 14, servingSize: "1 bowl", servingGrams: 300, dietaryTags: NV },
  { id: "am8", name: "Pulled Pork Sandwich", category: "American", calories: 480, protein: 28, carbs: 44, fats: 20, servingSize: "1 sandwich", servingGrams: 250, dietaryTags: NV },
  { id: "am9", name: "French Fries", category: "American", calories: 365, protein: 4, carbs: 48, fats: 17, servingSize: "medium serving", servingGrams: 117, dietaryTags: V },
  { id: "am10", name: "Chicken Tenders", category: "American", calories: 340, protein: 22, carbs: 22, fats: 18, servingSize: "4 tenders", servingGrams: 140, dietaryTags: NV },
  { id: "am11", name: "Mashed Potatoes", category: "American", calories: 210, protein: 4, carbs: 32, fats: 8, servingSize: "1 cup", servingGrams: 210, dietaryTags: VE },
  { id: "am12", name: "Coleslaw", category: "American", calories: 150, protein: 1.5, carbs: 14, fats: 10, servingSize: "1 cup", servingGrams: 120, dietaryTags: VE },

  // ═══════════════════════════════════════════════════════════════════════════
  // SUPPLEMENTS (~6 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "sp1", name: "Creatine Monohydrate", category: "Supplements", calories: 0, protein: 0, carbs: 0, fats: 0, servingSize: "5g scoop", servingGrams: 5, dietaryTags: V },
  { id: "sp2", name: "BCAA Powder", category: "Supplements", calories: 10, protein: 3, carbs: 0, fats: 0, servingSize: "1 scoop", servingGrams: 7, dietaryTags: V },
  { id: "sp3", name: "Pre-Workout Mix", category: "Supplements", calories: 15, protein: 0, carbs: 3, fats: 0, servingSize: "1 scoop", servingGrams: 10, dietaryTags: V },
  { id: "sp4", name: "Casein Protein", category: "Supplements", calories: 120, protein: 24, carbs: 4, fats: 1, servingSize: "1 scoop", servingGrams: 33, dietaryTags: VE },
  { id: "sp5", name: "Pea Protein Powder", category: "Supplements", calories: 110, protein: 24, carbs: 1, fats: 1.5, servingSize: "1 scoop", servingGrams: 33, dietaryTags: V },
  { id: "sp6", name: "Mass Gainer Shake", category: "Supplements", calories: 650, protein: 32, carbs: 110, fats: 8, servingSize: "1 serving", servingGrams: 165, dietaryTags: VE },

  // ═══════════════════════════════════════════════════════════════════════════
  // OILS & CONDIMENTS (~10 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "oc1", name: "Olive Oil", category: "Oils & Condiments", calories: 119, protein: 0, carbs: 0, fats: 14, servingSize: "1 tbsp", servingGrams: 14, dietaryTags: V },
  { id: "oc2", name: "Coconut Oil", category: "Oils & Condiments", calories: 121, protein: 0, carbs: 0, fats: 14, servingSize: "1 tbsp", servingGrams: 14, dietaryTags: V },
  { id: "oc3", name: "Ghee", category: "Oils & Condiments", calories: 112, protein: 0, carbs: 0, fats: 13, servingSize: "1 tbsp", servingGrams: 14, dietaryTags: VE },
  { id: "oc4", name: "Honey", category: "Oils & Condiments", calories: 64, protein: 0.1, carbs: 17, fats: 0, servingSize: "1 tbsp", servingGrams: 21, dietaryTags: VE },
  { id: "oc5", name: "Maple Syrup", category: "Oils & Condiments", calories: 52, protein: 0, carbs: 13, fats: 0, servingSize: "1 tbsp", servingGrams: 20, dietaryTags: V },
  { id: "oc6", name: "Soy Sauce", category: "Oils & Condiments", calories: 8, protein: 1.3, carbs: 0.8, fats: 0, servingSize: "1 tbsp", servingGrams: 16, dietaryTags: V },
  { id: "oc7", name: "Mustard", category: "Oils & Condiments", calories: 3, protein: 0.2, carbs: 0.3, fats: 0.2, servingSize: "1 tsp", servingGrams: 5, dietaryTags: V },
  { id: "oc8", name: "Ketchup", category: "Oils & Condiments", calories: 20, protein: 0.2, carbs: 5, fats: 0, servingSize: "1 tbsp", servingGrams: 17, dietaryTags: V },
  { id: "oc9", name: "Mayonnaise", category: "Oils & Condiments", calories: 94, protein: 0.1, carbs: 0.1, fats: 10, servingSize: "1 tbsp", servingGrams: 14, dietaryTags: EG },
  { id: "oc10", name: "Tahini", category: "Oils & Condiments", calories: 89, protein: 2.6, carbs: 3, fats: 8, servingSize: "1 tbsp", servingGrams: 15, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // FROZEN & CONVENIENCE (~8 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "fc1", name: "Frozen Pizza (cheese)", category: "Frozen & Convenience", calories: 280, protein: 12, carbs: 34, fats: 11, servingSize: "1 slice", servingGrams: 120, dietaryTags: VE },
  { id: "fc2", name: "Frozen Chicken Nuggets", category: "Frozen & Convenience", calories: 280, protein: 14, carbs: 18, fats: 17, servingSize: "6 pieces", servingGrams: 90, dietaryTags: NV },
  { id: "fc3", name: "Frozen Veggie Burger", category: "Frozen & Convenience", calories: 230, protein: 18, carbs: 20, fats: 8, servingSize: "1 patty", servingGrams: 113, dietaryTags: V },
  { id: "fc4", name: "Ice Cream (vanilla)", category: "Frozen & Convenience", calories: 270, protein: 5, carbs: 32, fats: 14, servingSize: "1 cup", servingGrams: 132, dietaryTags: VE },
  { id: "fc5", name: "Frozen Fish Sticks", category: "Frozen & Convenience", calories: 230, protein: 12, carbs: 22, fats: 11, servingSize: "5 sticks", servingGrams: 100, dietaryTags: NV },
  { id: "fc6", name: "Instant Noodles", category: "Frozen & Convenience", calories: 380, protein: 8, carbs: 52, fats: 16, servingSize: "1 packet", servingGrams: 85, dietaryTags: V },
  { id: "fc7", name: "Frozen Burrito", category: "Frozen & Convenience", calories: 340, protein: 12, carbs: 46, fats: 12, servingSize: "1 burrito", servingGrams: 140, dietaryTags: NV },
  { id: "fc8", name: "Frozen Stir-Fry Vegetables", category: "Frozen & Convenience", calories: 30, protein: 1.5, carbs: 5, fats: 0.3, servingSize: "1 cup", servingGrams: 100, dietaryTags: V },

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKFAST (~10 items)
  // ═══════════════════════════════════════════════════════════════════════════
  { id: "bf1", name: "Pancakes (2 medium)", category: "Breakfast", calories: 260, protein: 7, carbs: 38, fats: 9, servingSize: "2 pancakes", servingGrams: 140, dietaryTags: VE },
  { id: "bf2", name: "Waffles", category: "Breakfast", calories: 290, protein: 7, carbs: 32, fats: 14, servingSize: "2 waffles", servingGrams: 140, dietaryTags: VE },
  { id: "bf3", name: "French Toast", category: "Breakfast", calories: 280, protein: 8, carbs: 36, fats: 12, servingSize: "2 slices", servingGrams: 140, dietaryTags: VE },
  { id: "bf4", name: "Granola", category: "Breakfast", calories: 220, protein: 5, carbs: 34, fats: 8, servingSize: "½ cup", servingGrams: 50, dietaryTags: V },
  { id: "bf5", name: "Muesli", category: "Breakfast", calories: 176, protein: 5, carbs: 33, fats: 3, servingSize: "½ cup", servingGrams: 55, dietaryTags: V },
  { id: "bf6", name: "Cornflakes", category: "Breakfast", calories: 100, protein: 2, carbs: 24, fats: 0.2, servingSize: "1 cup", servingGrams: 28, dietaryTags: V },
  { id: "bf7", name: "Breakfast Sausage (pork)", category: "Breakfast", calories: 240, protein: 12, carbs: 2, fats: 20, servingSize: "2 links", servingGrams: 56, dietaryTags: NV },
  { id: "bf8", name: "Bacon", category: "Breakfast", calories: 180, protein: 12, carbs: 0, fats: 14, servingSize: "3 slices", servingGrams: 34, dietaryTags: NV },
  { id: "bf9", name: "Smoothie Bowl", category: "Breakfast", calories: 300, protein: 8, carbs: 52, fats: 8, servingSize: "1 bowl", servingGrams: 300, dietaryTags: V },
  { id: "bf10", name: "Chia Pudding", category: "Breakfast", calories: 210, protein: 6, carbs: 22, fats: 10, servingSize: "1 cup", servingGrams: 200, dietaryTags: V },
];

export function searchFoods(query: string, category?: string): FoodItem[] {
  const lower = query.toLowerCase();
  return foodDatabase.filter((f) => {
    const matchesQuery = !query || f.name.toLowerCase().includes(lower) || f.category.toLowerCase().includes(lower);
    const matchesCategory = !category || f.category === category;
    return matchesQuery && matchesCategory;
  });
}

export function getFoodsByCategory(category: string): FoodItem[] {
  return foodDatabase.filter((f) => f.category === category);
}

export function getFoodById(id: string): FoodItem | undefined {
  return foodDatabase.find((f) => f.id === id);
}

export function filterByDiet(foods: FoodItem[], diet: string): FoodItem[] {
  if (!diet || diet === "all") return foods;
  return foods.filter((f) => !f.dietaryTags || f.dietaryTags.includes(diet));
}
