import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { OpenClawPluginService } from "../../../../src/plugins/types.js";
import { resolveConductorConfig } from "./config.js";
import { runMonitorPass } from "./monitor.js";
import { maybeSendMorningReport } from "./morning-report.js";

export function createConductorService(api: OpenClawPluginApi): OpenClawPluginService {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  return {
    id: "conductor-monitor",
    start: async (ctx) => {
      const cfg = resolveConductorConfig(api);
      const run = async () => {
        if (running) {
          api.logger.debug(
            "Conductor monitor pass skipped because a previous pass is still running",
          );
          return;
        }
        running = true;
        try {
          await runMonitorPass(api, cfg.tasksPath);
          await maybeSendMorningReport(api, ctx.stateDir);
        } catch (error) {
          api.logger.warn(`Conductor monitor pass failed: ${String(error)}`);
        } finally {
          running = false;
        }
      };

      await run();
      timer = setInterval(() => {
        void run();
      }, cfg.monitorIntervalMs);
      api.logger.info("Conductor monitor service started");
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      api.logger.info("Conductor monitor service stopped");
    },
  };
}
