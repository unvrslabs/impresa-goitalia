/**
 * RoutineScheduler — tick-based scheduler for cron routine triggers.
 *
 * Every 30 seconds, queries routine_triggers for due cron triggers,
 * creates routine_runs, and dispatches execution to the RoutineExecutor.
 */
import type { Db } from "@goitalia/db";
import { routineTriggers, routines, routineRuns } from "@goitalia/db";
import { and, eq, lte } from "drizzle-orm";
import { nextCronTickInTimeZone } from "./routines.js";
import { randomUUID } from "node:crypto";

const TICK_INTERVAL_MS = 30_000;

export interface RoutineScheduler {
  start(): void;
  stop(): void;
}

export function createRoutineScheduler(
  db: Db,
  executeRun: (runId: string, routineId: string) => Promise<void>,
): RoutineScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const now = new Date();
      const dueTriggers = await db
        .select({
          triggerId: routineTriggers.id,
          routineId: routineTriggers.routineId,
          cronExpression: routineTriggers.cronExpression,
          timezone: routineTriggers.timezone,
          companyId: routineTriggers.companyId,
        })
        .from(routineTriggers)
        .innerJoin(routines, eq(routineTriggers.routineId, routines.id))
        .where(
          and(
            lte(routineTriggers.nextRunAt, now),
            eq(routineTriggers.enabled, true),
            eq(routineTriggers.kind, "cron"),
            eq(routines.status, "active"),
          ),
        )
        .limit(20);

      for (const trigger of dueTriggers) {
        try {
          // Skip if a run is already active for this routine
          const activeRun = await db
            .select({ id: routineRuns.id })
            .from(routineRuns)
            .where(
              and(eq(routineRuns.routineId, trigger.routineId), eq(routineRuns.status, "received")),
            )
            .then((r) => r[0]);

          if (activeRun) continue;

          // Create run record
          const runId = randomUUID();
          await db.insert(routineRuns).values({
            id: runId,
            companyId: trigger.companyId,
            routineId: trigger.routineId,
            triggerId: trigger.triggerId,
            source: "cron",
            status: "received",
            triggeredAt: now,
          });

          // Advance next_run_at (timezone-aware)
          if (trigger.cronExpression) {
            const tz = trigger.timezone || "Europe/Rome";
            const next = nextCronTickInTimeZone(trigger.cronExpression, tz, now);
            await db
              .update(routineTriggers)
              .set({ nextRunAt: next, lastFiredAt: now })
              .where(eq(routineTriggers.id, trigger.triggerId));
          }

          // Dispatch execution (fire and forget)
          executeRun(runId, trigger.routineId).catch((err) => {
            console.error("[routine-scheduler] execution error:", err);
          });
        } catch (err) {
          console.error("[routine-scheduler] trigger error:", trigger.triggerId, err);
        }
      }
    } catch (err) {
      console.error("[routine-scheduler] tick error:", err);
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      console.log("[routine-scheduler] started, tick every", TICK_INTERVAL_MS, "ms");
      timer = setInterval(tick, TICK_INTERVAL_MS);
      void tick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.log("[routine-scheduler] stopped");
    },
  };
}
