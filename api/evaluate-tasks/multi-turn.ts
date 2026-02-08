/**
 * Multi-Turn Evaluation Orchestrator
 *
 * Manages the artifact request/response loop for V2 evaluations.
 * Agents receive required artifacts upfront, then can request optional
 * artifacts across multiple turns before submitting their final answer.
 */

import type {
  V2AgentRequest,
  V2AgentResponse,
  V2Checkpoint,
  EvaluationTask,
  Artifact,
} from "../../src/types/benchmark-v2";

export interface MultiTurnResult {
  finalResponse: V2AgentResponse;
  turnsUsed: number;
  artifactsRequested: string[];
  turnHistory: Array<{
    turnNumber: number;
    artifactsProvided: string[];
    response: V2AgentResponse;
  }>;
}

export interface MultiTurnDeps {
  callAgent: (request: V2AgentRequest) => Promise<V2AgentResponse>;
}

const DEFAULT_MAX_TURNS = 3;

export class MultiTurnOrchestrator {
  private maxTurns: number;

  constructor(
    private checkpoint: V2Checkpoint,
    private task: EvaluationTask,
    private allArtifacts: Record<string, Artifact>,
    private deps: MultiTurnDeps
  ) {
    this.maxTurns = task.maxTurns ?? DEFAULT_MAX_TURNS;
  }

  async execute(): Promise<MultiTurnResult> {
    const turnHistory: MultiTurnResult["turnHistory"] = [];
    const allArtifactsRequested: string[] = [];

    // Resolve required artifacts for the initial request
    const initialArtifacts = this.resolveArtifacts(this.task.requiredArtifacts);
    const providedArtifactIds = new Set(this.task.requiredArtifacts);

    let turnNumber = 1;
    let currentArtifacts = initialArtifacts;

    while (turnNumber <= this.maxTurns) {
      const request: V2AgentRequest = {
        version: 2,
        checkpointId: this.checkpoint.id,
        taskId: this.task.id,
        taskType: this.task.type,
        prompt: this.task.prompt,
        artifacts: currentArtifacts,
        dealSnapshot: this.checkpoint.dealSnapshot,
        stakeholders: this.checkpoint.stakeholders,
        meddpicc: this.checkpoint.meddpicc,
        turnNumber,
        maxTurns: this.maxTurns,
      };

      const response = await this.deps.callAgent(request);

      // Record turn
      turnHistory.push({
        turnNumber,
        artifactsProvided: currentArtifacts.map((a) => a.id),
        response,
      });

      // If the agent is done or this is the last turn, return
      if (
        response.isComplete ||
        turnNumber >= this.maxTurns ||
        !response.artifactRequests ||
        response.artifactRequests.length === 0
      ) {
        return {
          finalResponse: response,
          turnsUsed: turnNumber,
          artifactsRequested: allArtifactsRequested,
          turnHistory,
        };
      }

      // Filter requested artifacts: only provide those in optionalArtifacts
      // and not already provided
      const validRequests = response.artifactRequests.filter(
        (id) =>
          this.task.optionalArtifacts.includes(id) &&
          !providedArtifactIds.has(id)
      );

      if (validRequests.length === 0) {
        // Agent requested artifacts that don't exist or aren't available
        // Treat as complete since we can't provide anything new
        return {
          finalResponse: response,
          turnsUsed: turnNumber,
          artifactsRequested: allArtifactsRequested,
          turnHistory,
        };
      }

      // Track requested artifacts
      allArtifactsRequested.push(...validRequests);
      for (const id of validRequests) {
        providedArtifactIds.add(id);
      }

      // Build the accumulated artifact set for the next turn
      currentArtifacts = this.resolveArtifacts(Array.from(providedArtifactIds));
      turnNumber++;
    }

    // Should not reach here, but return the last response
    const lastTurn = turnHistory[turnHistory.length - 1];
    return {
      finalResponse: lastTurn!.response,
      turnsUsed: turnHistory.length,
      artifactsRequested: allArtifactsRequested,
      turnHistory,
    };
  }

  private resolveArtifacts(ids: string[]): Artifact[] {
    const resolved: Artifact[] = [];
    for (const id of ids) {
      const artifact = this.allArtifacts[id];
      if (artifact) {
        resolved.push(artifact);
      }
    }
    return resolved;
  }
}
