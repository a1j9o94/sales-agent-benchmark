/**
 * Cross-Reference Linker
 *
 * Links artifacts to each other by date windows and name matching.
 * Associates transcripts, emails, CRM entries, and documents that
 * relate to the same events, stakeholders, or time periods.
 */

import type { Artifact, ArtifactReference } from "../../../src/types/benchmark-artifact";

/** How close in time two artifacts must be to be linked (days) */
const DEFAULT_DATE_WINDOW_DAYS = 3;

/** Extract date string from any artifact type */
export function getArtifactDate(artifact: Artifact): string {
  switch (artifact.type) {
    case "transcript":
      return artifact.date;
    case "email":
      return artifact.messages[0]?.date ?? artifact.createdAt;
    case "crm_snapshot":
      return artifact.activityLog[0]?.date ?? artifact.createdAt;
    case "document":
      return artifact.createdAt;
    case "slack_thread":
      return artifact.messages[0]?.timestamp ?? artifact.createdAt;
    case "calendar_event":
      return artifact.date;
  }
}

/** Extract names/people mentioned in an artifact */
export function extractNames(artifact: Artifact): string[] {
  const names = new Set<string>();

  switch (artifact.type) {
    case "transcript":
      for (const a of artifact.attendees) names.add(a.toLowerCase());
      for (const t of artifact.turns) {
        if (t.speakerName) names.add(t.speakerName.toLowerCase());
      }
      break;
    case "email":
      for (const p of artifact.participants) names.add(p.toLowerCase());
      break;
    case "crm_snapshot":
      for (const c of artifact.contacts) names.add(c.name.toLowerCase());
      break;
    case "slack_thread":
      for (const m of artifact.messages) names.add(m.author.toLowerCase());
      break;
    case "calendar_event":
      for (const a of artifact.attendees) names.add(a.toLowerCase());
      break;
    case "document":
      break;
  }

  return [...names];
}

/** Get a display title for any artifact */
export function getArtifactTitle(artifact: Artifact): string {
  switch (artifact.type) {
    case "transcript":
      return artifact.title;
    case "email":
      return artifact.subject;
    case "crm_snapshot":
      return `CRM Snapshot - ${artifact.dealProperties.stage}`;
    case "document":
      return artifact.title;
    case "slack_thread":
      return `Slack: #${artifact.channel}`;
    case "calendar_event":
      return artifact.title;
  }
}

/** Convert artifact to a lightweight reference */
export function toArtifactReference(artifact: Artifact): ArtifactReference {
  return {
    artifactId: artifact.id,
    type: artifact.type,
    title: getArtifactTitle(artifact),
    date: getArtifactDate(artifact),
  };
}

/** Check if two dates are within a window of each other */
function datesWithinWindow(dateA: string, dateB: string, windowDays: number): boolean {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  if (isNaN(a) || isNaN(b)) return false;
  const diffMs = Math.abs(a - b);
  return diffMs <= windowDays * 24 * 60 * 60 * 1000;
}

/** Check if two artifacts share common names */
function shareNames(namesA: string[], namesB: string[]): boolean {
  return namesA.some((name) => namesB.includes(name));
}

export interface LinkedGroup {
  primaryArtifactId: string;
  linkedArtifactIds: string[];
  linkType: "temporal" | "people" | "both";
}

/**
 * Find groups of related artifacts based on temporal proximity and shared names.
 */
export function findLinkedGroups(
  artifacts: Artifact[],
  options: { dateWindowDays?: number } = {}
): LinkedGroup[] {
  const windowDays = options.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS;
  const groups: LinkedGroup[] = [];
  const visited = new Set<string>();

  for (let i = 0; i < artifacts.length; i++) {
    const a = artifacts[i]!;
    if (visited.has(a.id)) continue;

    const linked: { id: string; linkType: "temporal" | "people" | "both" }[] = [];
    const dateA = getArtifactDate(a);
    const namesA = extractNames(a);

    for (let j = i + 1; j < artifacts.length; j++) {
      const b = artifacts[j]!;
      if (visited.has(b.id)) continue;

      const dateB = getArtifactDate(b);
      const namesB = extractNames(b);

      const temporalLink = datesWithinWindow(dateA, dateB, windowDays);
      const peopleLink = shareNames(namesA, namesB);

      if (temporalLink && peopleLink) {
        linked.push({ id: b.id, linkType: "both" });
        visited.add(b.id);
      } else if (temporalLink) {
        linked.push({ id: b.id, linkType: "temporal" });
        visited.add(b.id);
      } else if (peopleLink) {
        linked.push({ id: b.id, linkType: "people" });
      }
    }

    if (linked.length > 0) {
      visited.add(a.id);
      groups.push({
        primaryArtifactId: a.id,
        linkedArtifactIds: linked.map((l) => l.id),
        linkType: linked.some((l) => l.linkType === "both")
          ? "both"
          : linked.some((l) => l.linkType === "temporal")
            ? "temporal"
            : "people",
      });
    }
  }

  return groups;
}

/**
 * Sort artifacts chronologically by their date.
 */
export function sortArtifactsChronologically(artifacts: Artifact[]): Artifact[] {
  return [...artifacts].sort((a, b) => {
    const dateA = new Date(getArtifactDate(a)).getTime();
    const dateB = new Date(getArtifactDate(b)).getTime();
    if (isNaN(dateA)) return 1;
    if (isNaN(dateB)) return -1;
    return dateA - dateB;
  });
}

/**
 * Get all artifacts available at or before a given date.
 */
export function getArtifactsAvailableAt(
  artifacts: Artifact[],
  cutoffDate: string
): Artifact[] {
  const cutoff = new Date(cutoffDate).getTime();
  if (isNaN(cutoff)) return [];

  return artifacts.filter((a) => {
    const date = new Date(getArtifactDate(a)).getTime();
    return !isNaN(date) && date <= cutoff;
  });
}
