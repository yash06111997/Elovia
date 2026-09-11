/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4 reads class names from source files; content globs must
  // cover every place className can appear.
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./screens/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
};
