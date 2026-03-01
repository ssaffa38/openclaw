import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { createConductorService } from "./src/lib/service.js";
import { createBlogGenerateTool } from "./src/tools/blog-generate.js";
import { createBlogRecommendTool } from "./src/tools/blog-recommend.js";
import { createCheckTaskTool } from "./src/tools/check-task.js";
import { createCleanupTool } from "./src/tools/cleanup.js";
import { createCompanyStatusTool } from "./src/tools/company-status.js";
import { createDelegateToCtTool } from "./src/tools/delegate-to-ct.js";
import { createGtmReportTool } from "./src/tools/gtm-report.js";
import { createKillAgentTool } from "./src/tools/kill-agent.js";
import { createListTasksTool } from "./src/tools/list-tasks.js";
import { createMergePrTool } from "./src/tools/merge-pr.js";
import { createMorningReportTool } from "./src/tools/morning-report.js";
import { createRedirectAgentTool } from "./src/tools/redirect-agent.js";
import { createReviewPrTool } from "./src/tools/review-pr.js";
import { createScanWorkTool } from "./src/tools/scan-work.js";
import { createSpawnAgentTool } from "./src/tools/spawn-agent.js";
import { createUpdateExperimentTool } from "./src/tools/update-experiment.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createBlogRecommendTool(api));
  api.registerTool(createBlogGenerateTool(api));
  api.registerTool(createSpawnAgentTool(api));
  api.registerTool(createListTasksTool(api));
  api.registerTool(createCheckTaskTool(api));
  api.registerTool(createCompanyStatusTool(api));
  api.registerTool(createDelegateToCtTool(api));
  api.registerTool(createGtmReportTool(api));
  api.registerTool(createKillAgentTool(api));
  api.registerTool(createCleanupTool(api));
  api.registerTool(createMergePrTool(api));
  api.registerTool(createMorningReportTool(api));
  api.registerTool(createRedirectAgentTool(api));
  api.registerTool(createReviewPrTool(api));
  api.registerTool(createScanWorkTool(api));
  api.registerTool(createUpdateExperimentTool(api));
  api.registerService(createConductorService(api));
}
