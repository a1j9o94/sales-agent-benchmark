import type { ScoringDimensionKey, EvaluationTaskType } from "@/types/benchmark-v2";

export function scoreColor(percentage: number): string {
  if (percentage >= 75) return "text-emerald-400";
  if (percentage >= 50) return "text-amber-400";
  return "text-red-400";
}

export function scoreBgColor(percentage: number): string {
  if (percentage >= 75) return "bg-emerald-500/10 border-emerald-500/20";
  if (percentage >= 50) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

export function scoreBarColor(percentage: number): string {
  if (percentage >= 75) return "from-emerald-500 to-emerald-400";
  if (percentage >= 50) return "from-amber-500 to-amber-400";
  return "from-red-500 to-red-400";
}

export function taskTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    deal_analysis: "Deal Analysis",
    call_summary: "Call Summary",
    follow_up_draft: "Follow-Up Draft",
    stakeholder_analysis: "Stakeholder Analysis",
    risk_assessment: "Risk Assessment",
    deal_qualification: "Deal Qualification",
    objection_handling: "Objection Handling",
    action_items: "Action Items",
  };
  return labels[type] || type;
}

export function taskTypeColor(type: string): { text: string; bg: string; border: string } {
  const colors: Record<string, { text: string; bg: string; border: string }> = {
    deal_analysis: { text: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
    call_summary: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    follow_up_draft: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    stakeholder_analysis: { text: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    risk_assessment: { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
    deal_qualification: { text: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    objection_handling: { text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
    action_items: { text: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20" },
  };
  return colors[type] || { text: "text-slate-400", bg: "bg-white/5", border: "border-white/10" };
}

export function dimensionLabel(key: string): string {
  const labels: Record<string, string> = {
    riskIdentification: "Risk ID",
    nextStepQuality: "Next Steps",
    prioritization: "Prioritization",
    outcomeAlignment: "Outcome",
    stakeholderMapping: "Stakeholder",
    dealQualification: "Qualification",
    informationSynthesis: "Synthesis",
    communicationQuality: "Communication",
  };
  return labels[key] || key;
}

export function dimensionFullLabel(key: string): string {
  const labels: Record<string, string> = {
    riskIdentification: "Risk Identification",
    nextStepQuality: "Next Step Quality",
    prioritization: "Prioritization",
    outcomeAlignment: "Outcome Alignment",
    stakeholderMapping: "Stakeholder Mapping",
    dealQualification: "Deal Qualification",
    informationSynthesis: "Info Synthesis",
    communicationQuality: "Communication Quality",
  };
  return labels[key] || key;
}

export function dimensionColor(key: string): string {
  const colors: Record<string, string> = {
    riskIdentification: "cyan",
    nextStepQuality: "emerald",
    prioritization: "amber",
    outcomeAlignment: "purple",
    stakeholderMapping: "indigo",
    dealQualification: "teal",
    informationSynthesis: "orange",
    communicationQuality: "rose",
  };
  return colors[key] || "slate";
}

export const V2_DIMENSION_KEYS: ScoringDimensionKey[] = [
  "riskIdentification",
  "nextStepQuality",
  "prioritization",
  "outcomeAlignment",
  "stakeholderMapping",
  "dealQualification",
  "informationSynthesis",
  "communicationQuality",
];

export function getJudgeShortName(model: string): string {
  if (model.includes("claude")) {
    const match = model.match(/claude[- ](\w+)[- ]?([\d.]+)?/i);
    if (match) return `Claude ${match[1]}`;
  }
  if (model.includes("gpt")) {
    const match = model.match(/gpt[- ]?([\w.]+)/i);
    if (match) return `GPT-${match[1]}`;
  }
  if (model.includes("gemini")) {
    const match = model.match(/gemini[- ]?([\w.]+)/i);
    if (match) return `Gemini ${match[1]}`;
  }
  const parts = model.split("/");
  const last = parts[parts.length - 1] || model;
  return last.length > 20 ? last.substring(0, 20) + "..." : last;
}
