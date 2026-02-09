/**
 * Artifact Data Quality Validation
 *
 * Validates ArtifactDeal data for:
 * - Minimum artifact thresholds
 * - Anonymization leak detection
 * - Completeness checks
 * - Structural integrity
 */

import type { ArtifactDeal, ArtifactCheckpoint, Artifact, ArtifactType } from "../../../src/types/benchmark-artifact";

export interface ValidationResult {
  dealId: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Known real names that should have been anonymized */
const LEAK_PATTERNS = [
  // Real person names (from extract_checkpoints.ts PERSON_REPLACEMENTS)
  /\badrian\b/i,
  /\bsam\b/i,
  /\bamy\b/i,
  /\bfeng\b/i,
  /\bbryan\b/i,
  /\bfred\b/i,
  /\bsonia\b/i,
  /\bsonya\b/i,
  /\bderek\b/i,
  /\bjulia\b/i,
  /\bemily\b/i,
  /\bcaroline\b/i,
  /\bclementine\b/i,
  /\bnyal\b/i,
  /\bshre\b/i,
  /\btracy\b/i,
  /\bwade\b/i,
  /\bkyle\b/i,
  /\bfrank\b/i,
  /\bcarl\b/i,

  // Real company names
  /\bflagship\b/i,
  /\bflagship pioneering\b/i,
  /\bmoxie\b/i,
  /\bgranola\b/i,
  /\bzenith prep\b/i,
  /\beaton group\b/i,
  /\banisa\b/i,
  /\bgenea\b/i,
  /\bpronet\b/i,
  /\bhometime\b/i,
  /\bpatoma\b/i,
  /\bavmedia\b/i,
  /\bscg-security\b/i,
  /\bcool-rooms\b/i,
  /\bxpansiv\b/i,
  /\bfinera\b/i,

  // Email patterns
  /[\w.-]+@(?!company\.example\.com)[\w.-]+\.\w+/,

  // Real phone numbers (not anonymized pattern)
  /\(\d{3}\)\s?\d{3}-\d{4}/,

  // Real file paths
  /\/Users\/(?!username)\w+/,
];

/** Scan text for anonymization leaks */
export function scanForLeaks(text: string): string[] {
  const leaks: string[] = [];

  for (const pattern of LEAK_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      leaks.push(`Potential leak: "${match[0]}" matched pattern ${pattern.source}`);
    }
  }

  return leaks;
}

/** Scan an artifact for anonymization leaks */
function scanArtifactForLeaks(artifact: Artifact): string[] {
  const textFields: string[] = [];

  switch (artifact.type) {
    case "transcript":
      textFields.push(artifact.title, artifact.rawText);
      for (const t of artifact.turns) textFields.push(t.text);
      textFields.push(...artifact.attendees);
      break;
    case "email":
      textFields.push(artifact.subject);
      for (const m of artifact.messages) {
        textFields.push(m.from, m.body, ...m.to);
      }
      textFields.push(...artifact.participants);
      break;
    case "crm_snapshot":
      textFields.push(...artifact.notes);
      for (const c of artifact.contacts) {
        textFields.push(c.name, c.title ?? "", c.role ?? "");
      }
      for (const a of artifact.activityLog) textFields.push(a.description);
      break;
    case "document":
      textFields.push(artifact.title, artifact.content);
      break;
    case "slack_thread":
      for (const m of artifact.messages) textFields.push(m.author, m.text);
      break;
    case "calendar_event":
      textFields.push(artifact.title, artifact.description ?? "");
      textFields.push(...artifact.attendees);
      break;
  }

  const allText = textFields.join("\n");
  return scanForLeaks(allText);
}

/** Validate a single ArtifactDeal */
export function validateDeal(deal: ArtifactDeal): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Structural checks ---

  if (deal.version !== 2) {
    errors.push(`Expected version 2, got ${deal.version}`);
  }

  if (!deal.id) {
    errors.push("Deal ID is missing");
  }

  if (!deal.name) {
    errors.push("Deal name is missing");
  }

  // --- Artifact checks ---

  const artifactCount = Object.keys(deal.artifacts).length;
  if (artifactCount === 0) {
    errors.push("No artifacts found");
  } else if (artifactCount < 2) {
    warnings.push(`Only ${artifactCount} artifact(s) — recommend 2+ from different sources`);
  }

  // Check artifact type diversity
  const artifactTypes = new Set<ArtifactType>();
  for (const artifact of Object.values(deal.artifacts)) {
    artifactTypes.add(artifact.type);
  }
  if (artifactTypes.size < 2 && artifactCount >= 2) {
    warnings.push(`All ${artifactCount} artifacts are of type "${[...artifactTypes][0]}" — recommend diverse sources`);
  }

  // Validate artifact IDs match keys
  for (const [key, artifact] of Object.entries(deal.artifacts)) {
    if (key !== artifact.id) {
      errors.push(`Artifact key "${key}" doesn't match artifact.id "${artifact.id}"`);
    }
    if (artifact.dealId !== deal.id) {
      errors.push(`Artifact "${artifact.id}" has dealId "${artifact.dealId}", expected "${deal.id}"`);
    }
  }

  // --- Checkpoint checks ---

  if (deal.checkpoints.length === 0) {
    errors.push("No checkpoints found");
  }

  for (const checkpoint of deal.checkpoints) {
    const cpErrors = validateCheckpoint(checkpoint, deal);
    errors.push(...cpErrors.errors);
    warnings.push(...cpErrors.warnings);
  }

  // --- Anonymization leak scan ---

  for (const artifact of Object.values(deal.artifacts)) {
    if (artifact.anonymized) {
      const leaks = scanArtifactForLeaks(artifact);
      for (const leak of leaks) {
        warnings.push(`Artifact ${artifact.id}: ${leak}`);
      }
    }
  }

  return {
    dealId: deal.id,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Validate a single checkpoint within a deal */
function validateCheckpoint(
  checkpoint: ArtifactCheckpoint,
  deal: ArtifactDeal
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = `Checkpoint ${checkpoint.id}:`;

  if (checkpoint.version !== 2) {
    errors.push(`${prefix} Expected version 2, got ${checkpoint.version}`);
  }

  if (checkpoint.dealId !== deal.id) {
    errors.push(`${prefix} dealId "${checkpoint.dealId}" doesn't match deal "${deal.id}"`);
  }

  if (!checkpoint.timestamp) {
    errors.push(`${prefix} Missing timestamp`);
  }

  // Verify referenced artifacts exist
  for (const ref of checkpoint.availableArtifacts) {
    if (!deal.artifacts[ref.artifactId]) {
      errors.push(`${prefix} References artifact "${ref.artifactId}" which doesn't exist in deal`);
    }
  }

  if (checkpoint.availableArtifacts.length === 0) {
    warnings.push(`${prefix} No available artifacts`);
  }

  // Verify tasks reference valid artifacts
  for (const task of checkpoint.tasks) {
    for (const artifactId of task.requiredArtifacts) {
      const validRefs = checkpoint.availableArtifacts.map((r) => r.artifactId);
      if (!validRefs.includes(artifactId)) {
        errors.push(`${prefix} Task "${task.id}" requires artifact "${artifactId}" not available at this checkpoint`);
      }
    }

    if (task.scoringDimensions.length === 0) {
      warnings.push(`${prefix} Task "${task.id}" has no scoring dimensions`);
    }
  }

  if (checkpoint.tasks.length === 0) {
    warnings.push(`${prefix} No evaluation tasks`);
  }

  // Ground truth checks
  if (!checkpoint.groundTruth.whatHappenedNext) {
    warnings.push(`${prefix} Missing ground truth whatHappenedNext`);
  }

  return { errors, warnings };
}

/** Validate a batch of deals and return summary */
export function validateBatch(deals: ArtifactDeal[]): {
  results: ValidationResult[];
  totalErrors: number;
  totalWarnings: number;
  allValid: boolean;
} {
  const results = deals.map(validateDeal);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

  return {
    results,
    totalErrors,
    totalWarnings,
    allValid: totalErrors === 0,
  };
}
