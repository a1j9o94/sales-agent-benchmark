/**
 * Benchmark Run API - Vercel Serverless Function
 */

import { handleRunBenchmarkEndpoint } from "../run-benchmark";

export const config = {
  runtime: "nodejs",
  maxDuration: 300 // 5 minutes for long benchmark runs
};

export default handleRunBenchmarkEndpoint;
