/**
 * Leaderboard API - Vercel Serverless Function
 */

import { handleGetLeaderboard } from "./results";

export const config = { runtime: "edge" };
export default handleGetLeaderboard;
