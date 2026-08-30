import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Relative, not absolute: drizzle-kit globs this path, and an absolute
  // path containing glob metacharacters (parentheses, brackets) silently
  // matches nothing. Resolved against the package directory at run time.
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
