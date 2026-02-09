#!/usr/bin/env bun
/**
 * Database Migration: V2 → Artifact-Based
 *
 * Merges v2_dimension_scores into dimension_scores,
 * renames v2_task_evaluations → task_evaluations,
 * and updates agent IDs from v2_ to artifact_ prefix.
 *
 * Usage: bun scripts/migrate-v2-to-artifact.ts
 */

import { sql } from "@vercel/postgres";

async function migrate() {
  console.log("Starting V2 → Artifact-Based migration...\n");

  // 1. Add artifact dimension columns to dimension_scores
  console.log("1. Adding artifact dimension columns to dimension_scores...");
  await sql`ALTER TABLE dimension_scores ADD COLUMN IF NOT EXISTS stakeholder_mapping REAL`;
  await sql`ALTER TABLE dimension_scores ADD COLUMN IF NOT EXISTS deal_qualification REAL`;
  await sql`ALTER TABLE dimension_scores ADD COLUMN IF NOT EXISTS information_synthesis REAL`;
  await sql`ALTER TABLE dimension_scores ADD COLUMN IF NOT EXISTS communication_quality REAL`;
  console.log("   Done.");

  // 2. Migrate data from v2_dimension_scores into dimension_scores
  console.log("2. Migrating v2_dimension_scores data into dimension_scores...");
  const migrateResult = await sql`
    UPDATE dimension_scores ds
    SET stakeholder_mapping = v2ds.stakeholder_mapping,
        deal_qualification = v2ds.deal_qualification,
        information_synthesis = v2ds.information_synthesis,
        communication_quality = v2ds.communication_quality
    FROM v2_dimension_scores v2ds
    WHERE ds.run_id = v2ds.run_id
  `;
  console.log(`   Migrated ${migrateResult.rowCount ?? 0} rows.`);

  // 3. Drop v2_dimension_scores table and its index
  console.log("3. Dropping v2_dimension_scores table...");
  await sql`DROP INDEX IF EXISTS idx_v2_dim_scores_run`;
  await sql`DROP TABLE IF EXISTS v2_dimension_scores`;
  console.log("   Done.");

  // 4. Rename v2_task_evaluations → task_evaluations
  console.log("4. Renaming v2_task_evaluations → task_evaluations...");
  await sql`ALTER TABLE IF EXISTS v2_task_evaluations RENAME TO task_evaluations`;
  console.log("   Done.");

  // 5. Rename indexes
  console.log("5. Renaming indexes...");
  await sql`ALTER INDEX IF EXISTS idx_v2_task_evals_run RENAME TO idx_task_evals_run`;
  await sql`ALTER INDEX IF EXISTS idx_v2_task_evals_checkpoint RENAME TO idx_task_evals_checkpoint`;
  console.log("   Done.");

  // 6. Migrate agent IDs: v2_ → artifact_
  // Must drop FK, update agents first, then benchmark_runs, then re-add FK
  console.log("6. Migrating agent IDs (v2_ → artifact_)...");

  await sql`ALTER TABLE benchmark_runs DROP CONSTRAINT IF EXISTS benchmark_runs_agent_id_fkey`;

  const agentsResult = await sql`
    UPDATE agents SET id = REPLACE(id, 'v2_', 'artifact_')
    WHERE id LIKE 'v2_%'
  `;
  console.log(`   Updated ${agentsResult.rowCount ?? 0} agents rows.`);

  const runsResult = await sql`
    UPDATE benchmark_runs SET agent_id = REPLACE(agent_id, 'v2_', 'artifact_')
    WHERE agent_id LIKE 'v2_%'
  `;
  console.log(`   Updated ${runsResult.rowCount ?? 0} benchmark_runs rows.`);

  await sql`ALTER TABLE benchmark_runs ADD CONSTRAINT benchmark_runs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id)`;

  console.log("\nMigration complete!");
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
