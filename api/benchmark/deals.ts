/**
 * Deals API - Vercel Serverless Function
 */

import { handleDealsEndpoint } from "../run-benchmark";

export const config = {
  runtime: "nodejs"
};

export default handleDealsEndpoint;
