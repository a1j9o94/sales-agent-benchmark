import { useState } from "react";

interface CheckpointEvaluation {
  checkpointId: string;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
  totalScore: number;
  maxScore: number;
  feedback: string;
  groundTruthComparison?: {
    risksIdentified: string[];
    risksMissed: string[];
    helpfulRecommendations: string[];
    unhelpfulRecommendations: string[];
  };
}

interface DealResult {
  dealId: string;
  checkpointEvaluations: CheckpointEvaluation[];
  dealScore: number;
}

interface BenchmarkResult {
  agentId: string;
  agentEndpoint: string;
  mode: string;
  runTimestamp: string;
  dealResults: DealResult[];
  aggregateScore: number;
  maxPossibleScore: number;
}

interface ResultsTimelineProps {
  results: BenchmarkResult;
}

// Radar Chart Component
function RadarChart({ scores }: { scores: CheckpointEvaluation["scores"] }) {
  const dimensions = [
    { key: "riskIdentification", label: "Risk ID", angle: -90 },
    { key: "nextStepQuality", label: "Next Steps", angle: 0 },
    { key: "prioritization", label: "Priority", angle: 90 },
    { key: "outcomeAlignment", label: "Outcome", angle: 180 },
  ];

  const size = 160;
  const center = size / 2;
  const maxRadius = 60;

  const getPoint = (angle: number, value: number) => {
    const normalizedValue = (value / 10) * maxRadius;
    const radians = (angle * Math.PI) / 180;
    return {
      x: center + normalizedValue * Math.cos(radians),
      y: center + normalizedValue * Math.sin(radians),
    };
  };

  const points = dimensions.map((d) => {
    const value = scores[d.key as keyof typeof scores];
    return getPoint(d.angle, value);
  });

  const pathData = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
      {/* Grid circles */}
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <circle
          key={scale}
          cx={center}
          cy={center}
          r={maxRadius * scale}
          className="radar-grid"
          strokeDasharray={scale === 1 ? "none" : "2 4"}
        />
      ))}

      {/* Axes */}
      {dimensions.map((d) => {
        const end = getPoint(d.angle, 10);
        return (
          <g key={d.key}>
            <line x1={center} y1={center} x2={end.x} y2={end.y} className="radar-axis" />
            <text
              x={getPoint(d.angle, 12).x}
              y={getPoint(d.angle, 12).y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-500 text-[8px] font-medium"
            >
              {d.label}
            </text>
          </g>
        );
      })}

      {/* Data area */}
      <path d={pathData} className="radar-area" />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} className="radar-point" />
      ))}
    </svg>
  );
}

// Circular Score Ring
function ScoreRing({ score, max, size = 120 }: { score: number; max: number; size?: number }) {
  const percentage = (score / max) * 100;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const color =
    percentage >= 75 ? "var(--emerald-glow)" : percentage >= 50 ? "var(--amber-glow)" : "var(--red-glow)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
        />
        {/* Score ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="score-ring"
          style={{ filter: `drop-shadow(0 0 10px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>
          {percentage.toFixed(0)}%
        </span>
        <span className="text-xs text-slate-500 font-mono">
          {score}/{max}
        </span>
      </div>
    </div>
  );
}

// Timeline Checkpoint
function TimelineCheckpoint({
  evaluation,
  index,
  total,
  isExpanded,
  onClick,
}: {
  evaluation: CheckpointEvaluation;
  index: number;
  total: number;
  isExpanded: boolean;
  onClick: () => void;
}) {
  const percentage = (evaluation.totalScore / evaluation.maxScore) * 100;
  const color =
    percentage >= 75
      ? { bg: "bg-emerald-500", glow: "glow-emerald", text: "text-emerald-400" }
      : percentage >= 50
      ? { bg: "bg-amber-500", glow: "glow-amber", text: "text-amber-400" }
      : { bg: "bg-red-500", glow: "glow-red", text: "text-red-400" };

  return (
    <div className="flex flex-col items-center">
      {/* Checkpoint dot */}
      <button
        onClick={onClick}
        className={`relative w-5 h-5 rounded-full ${color.bg} ${isExpanded ? color.glow : ""}
          transition-all duration-300 hover:scale-125 cursor-pointer z-10`}
      >
        {isExpanded && (
          <span className={`absolute inset-0 rounded-full ${color.bg} animate-ping opacity-50`} />
        )}
      </button>

      {/* Score label */}
      <div className={`mt-2 text-xs font-mono ${color.text}`}>
        {evaluation.totalScore}/{evaluation.maxScore}
      </div>

      {/* Checkpoint ID */}
      <div className="text-[10px] text-slate-600 font-mono mt-1">
        CP{index + 1}
      </div>
    </div>
  );
}

// Expanded Checkpoint Detail
function CheckpointDetail({
  evaluation,
  isPublic,
}: {
  evaluation: CheckpointEvaluation;
  isPublic: boolean;
}) {
  return (
    <div className="animate-fade-up bg-navy-900/50 rounded-xl border border-white/5 p-6 mt-4">
      <div className="grid md:grid-cols-[180px_1fr] gap-6">
        {/* Radar Chart */}
        <div className="flex flex-col items-center">
          <div className="w-40 h-40">
            <RadarChart scores={evaluation.scores} />
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono">{evaluation.checkpointId}</div>
        </div>

        {/* Scores Grid */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(evaluation.scores).map(([key, value]) => {
              const color = value >= 8 ? "text-emerald-400" : value >= 5 ? "text-amber-400" : "text-red-400";
              return (
                <div key={key} className="bg-navy-800/50 rounded-lg p-3">
                  <div className="data-label mb-1">
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </div>
                  <div className={`text-2xl font-bold tabular-nums ${color}`}>
                    {value}<span className="text-slate-600 text-sm">/10</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Feedback */}
          <div className="bg-navy-800/30 rounded-lg p-4 border-l-2 border-cyan-500/50">
            <div className="data-label mb-2">Analysis</div>
            <p className="text-sm text-slate-300 leading-relaxed">{evaluation.feedback}</p>
          </div>
        </div>
      </div>

      {/* Ground Truth Comparison */}
      {isPublic && evaluation.groundTruthComparison && (
        <div className="grid md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-white/5">
          {evaluation.groundTruthComparison.risksIdentified.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="data-label text-emerald-400">Risks Identified</span>
              </div>
              <ul className="space-y-1">
                {evaluation.groundTruthComparison.risksIdentified.map((r, i) => (
                  <li key={i} className="text-sm text-slate-400 pl-4 border-l border-emerald-500/30">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evaluation.groundTruthComparison.risksMissed.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="data-label text-red-400">Risks Missed</span>
              </div>
              <ul className="space-y-1">
                {evaluation.groundTruthComparison.risksMissed.map((r, i) => (
                  <li key={i} className="text-sm text-slate-400 pl-4 border-l border-red-500/30">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evaluation.groundTruthComparison.helpfulRecommendations.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="data-label text-emerald-400">Helpful Actions</span>
              </div>
              <ul className="space-y-1">
                {evaluation.groundTruthComparison.helpfulRecommendations.map((r, i) => (
                  <li key={i} className="text-sm text-slate-400 pl-4 border-l border-emerald-500/30">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evaluation.groundTruthComparison.unhelpfulRecommendations.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="data-label text-amber-400">Missed Opportunities</span>
              </div>
              <ul className="space-y-1">
                {evaluation.groundTruthComparison.unhelpfulRecommendations.map((r, i) => (
                  <li key={i} className="text-sm text-slate-400 pl-4 border-l border-amber-500/30">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Deal Card
function DealCard({ deal, isPublic }: { deal: DealResult; isPublic: boolean }) {
  const [expandedCheckpoint, setExpandedCheckpoint] = useState<number | null>(null);
  const maxScore = deal.checkpointEvaluations.length * 40;
  const percentage = (deal.dealScore / maxScore) * 100;

  return (
    <div className="card-hover bg-navy-900/40 rounded-xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-lg tracking-tight">{deal.dealId}</h4>
          <p className="text-sm text-slate-500 font-mono">
            {deal.checkpointEvaluations.length} checkpoints
          </p>
        </div>
        <div className="text-right">
          <div
            className={`text-2xl font-bold tabular-nums ${
              percentage >= 75 ? "text-emerald-400" : percentage >= 50 ? "text-amber-400" : "text-red-400"
            }`}
          >
            {percentage.toFixed(0)}%
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {deal.dealScore}/{maxScore}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-5 pb-5">
        <div className="relative flex items-start justify-between">
          {/* Connector line */}
          <div className="absolute top-2.5 left-2.5 right-2.5 h-0.5 timeline-connector" />

          {/* Checkpoints */}
          {deal.checkpointEvaluations.map((cp, idx) => (
            <TimelineCheckpoint
              key={cp.checkpointId}
              evaluation={cp}
              index={idx}
              total={deal.checkpointEvaluations.length}
              isExpanded={expandedCheckpoint === idx}
              onClick={() => setExpandedCheckpoint(expandedCheckpoint === idx ? null : idx)}
            />
          ))}
        </div>

        {/* Expanded Detail */}
        {expandedCheckpoint !== null && (
          <CheckpointDetail
            evaluation={deal.checkpointEvaluations[expandedCheckpoint]}
            isPublic={isPublic}
          />
        )}
      </div>
    </div>
  );
}

export function ResultsTimeline({ results }: ResultsTimelineProps) {
  const isPublic = results.mode === "public";
  const percentage = Math.round((results.aggregateScore / results.maxPossibleScore) * 100);

  // Calculate aggregate scores for radar
  const aggregateScores = {
    riskIdentification: 0,
    nextStepQuality: 0,
    prioritization: 0,
    outcomeAlignment: 0,
  };

  let checkpointCount = 0;
  results.dealResults.forEach((deal) => {
    deal.checkpointEvaluations.forEach((cp) => {
      aggregateScores.riskIdentification += cp.scores.riskIdentification;
      aggregateScores.nextStepQuality += cp.scores.nextStepQuality;
      aggregateScores.prioritization += cp.scores.prioritization;
      aggregateScores.outcomeAlignment += cp.scores.outcomeAlignment;
      checkpointCount++;
    });
  });

  if (checkpointCount > 0) {
    aggregateScores.riskIdentification /= checkpointCount;
    aggregateScores.nextStepQuality /= checkpointCount;
    aggregateScores.prioritization /= checkpointCount;
    aggregateScores.outcomeAlignment /= checkpointCount;
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-navy-900/60 rounded-2xl border border-white/5 p-6 grid-bg relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-cyan-500/10 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-emerald-500/5 to-transparent rounded-full blur-3xl" />

        <div className="relative grid md:grid-cols-[1fr_auto_1fr] gap-8 items-center">
          {/* Left: Stats */}
          <div className="space-y-4">
            <div>
              <div className="data-label">Benchmark Results</div>
              <h3 className="text-2xl font-bold tracking-tight mt-1">
                {isPublic ? "Public Evaluation" : "Private Benchmark"}
              </h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-3xl font-bold tabular-nums">{results.dealResults.length}</div>
                <div className="data-label mt-1">Deals</div>
              </div>
              <div>
                <div className="text-3xl font-bold tabular-nums">{checkpointCount}</div>
                <div className="data-label mt-1">Checkpoints</div>
              </div>
              <div>
                <div className="text-3xl font-bold tabular-nums">
                  {new Date(results.runTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="data-label mt-1">Run Time</div>
              </div>
            </div>
          </div>

          {/* Center: Score Ring */}
          <div className="flex justify-center">
            <ScoreRing score={results.aggregateScore} max={results.maxPossibleScore} size={140} />
          </div>

          {/* Right: Radar */}
          <div className="flex justify-center md:justify-end">
            <div className="w-44 h-44">
              <RadarChart scores={aggregateScores} />
            </div>
          </div>
        </div>
      </div>

      {/* Deal Results */}
      <div className="space-y-4">
        <div className="data-label px-1">Deal Performance</div>
        {results.dealResults.map((deal, idx) => (
          <div
            key={deal.dealId}
            className="animate-fade-up opacity-0"
            style={{ animationDelay: `${idx * 0.1}s`, animationFillMode: "forwards" }}
          >
            <DealCard deal={deal} isPublic={isPublic} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ResultsTimeline;
