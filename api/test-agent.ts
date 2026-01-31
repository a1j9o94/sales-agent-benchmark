/**
 * Test Agent API - Vercel Serverless Function
 */

import { handleTestEndpoint } from "./register";

export const config = { runtime: "edge" };
export default handleTestEndpoint;
