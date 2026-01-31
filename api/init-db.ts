/**
 * Init DB API - Vercel Serverless Function
 */

import { handleInitDatabase } from "./results";

export const config = { runtime: "edge" };
export default handleInitDatabase;
