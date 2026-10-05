import assert from "node:assert/strict";
import test from "node:test";
import { semanticMismatches } from "../../lib/db/scripts/migrate.mjs";

const revision = {
  table_name: "user_data", column_name: "revision", data_type: "bigint",
  not_null: true, identity: "", generated: "", default_expression: "1",
};
const notNull = {
  table_name: "user_data", constraint_name: "user_data_revision_not_null",
  constraint_type: "n", deferrable: false, initially_deferred: false,
  validated: true, definition: "NOT NULL revision",
};
const metadata = (columns = [], constraints = []) => ({
  tables: [{ table_name: "user_data", relation_kind: "r", persistence: "p" }],
  columns, constraints, indexes: [],
});

test("legacy baseline without optional revision can adopt PostgreSQL 18 metadata", () => {
  assert.deepEqual(semanticMismatches(metadata([revision], [notNull]), metadata()), []);
});

test("equivalent legacy NOT NULL column does not require the newer catalog name", () => {
  assert.deepEqual(semanticMismatches(metadata([revision], [notNull]), metadata([revision])), []);
});

test("existing nullable revision remains incompatible", () => {
  const errors = semanticMismatches(metadata([revision], [notNull]), metadata([{ ...revision, not_null: false }]));
  assert.ok(errors.some(error => error.includes("incompatible column user_data.revision")));
});

test("existing unvalidated NOT NULL constraint remains incompatible", () => {
  const errors = semanticMismatches(metadata([revision], [notNull]), metadata([revision], [{ ...notNull, validated: false }]));
  assert.ok(errors.some(error => error.includes("incompatible constraint user_data.user_data_revision_not_null")));
});

test("missing unrelated baseline constraint still blocks adoption", () => {
  const required = { ...notNull, constraint_name: "user_data_user_id_unique", constraint_type: "u", definition: "UNIQUE (user_id)" };
  const errors = semanticMismatches(metadata([], [required]), metadata());
  assert.ok(errors.some(error => error.includes("missing constraint user_data.user_data_user_id_unique")));
});
