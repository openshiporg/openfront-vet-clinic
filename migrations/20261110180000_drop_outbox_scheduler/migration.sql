-- Remove the invented outbox and the in-app scheduler's tables (owner rule: no outbox, no
-- cron/worker machinery). Live check beforehand: OutboxEvent held only delivered rows, nothing
-- pending; ScheduledJob and Lease held only scheduler heartbeats and lease keys; none has a foreign
-- key or trigger pointing at it. No other table is touched.
DROP TABLE "OutboxEvent";
DROP TABLE "ScheduledJob";
DROP TABLE "Lease";
