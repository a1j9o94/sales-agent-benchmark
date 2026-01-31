/**
 * Runs API - Vercel Serverless Function
 */

import { handleGetAllRuns } from "./results";

export const config = { runtime: "edge" };
export default handleGetAllRuns;
