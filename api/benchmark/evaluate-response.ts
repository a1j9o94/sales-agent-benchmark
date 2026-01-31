/**
 * Evaluate Response API - Vercel Serverless Function
 */

import { handleEvaluateResponseEndpoint } from "../evaluate-response";

export const config = { runtime: "edge" };
export default handleEvaluateResponseEndpoint;
