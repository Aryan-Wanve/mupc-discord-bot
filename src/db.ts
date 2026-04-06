import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { config } from "./config";
import {
  ChannelAttendanceReportRow,
  ChannelSummaryRow,
  TrackingRunRow,
  TrackingSessionRow
} from "./types";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tracking_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scheduled_start TEXT,
    scheduled_end TEXT,
    started_at TEXT,
    ended_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tracking_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_run_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    left_at TEXT,
    FOREIGN KEY (tracking_run_id) REFERENCES tracking_runs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_tracking_runs_guild_status
    ON tracking_runs(guild_id, status, is_active);
  CREATE INDEX IF NOT EXISTS idx_tracking_sessions_run_channel
    ON tracking_sessions(tracking_run_id, channel_id);
  CREATE INDEX IF NOT EXISTS idx_tracking_sessions_open
    ON tracking_sessions(tracking_run_id, left_at);
`);

const statements = {
  createRun: db.prepare(`
    INSERT INTO tracking_runs (
      title,
      guild_id,
      scheduled_start,
      scheduled_end,
      started_at,
      ended_at,
      is_active,
      status
    )
    VALUES (
      @title,
      @guildId,
      @scheduledStart,
      @scheduledEnd,
      @startedAt,
      @endedAt,
      @isActive,
      @status
    )
  `),
  listRuns: db.prepare(`
    SELECT *
    FROM tracking_runs
    ORDER BY COALESCE(started_at, scheduled_start, created_at) DESC, id DESC
  `),
  listRunsByGuild: db.prepare(`
    SELECT *
    FROM tracking_runs
    WHERE guild_id = ?
    ORDER BY COALESCE(started_at, scheduled_start, created_at) DESC, id DESC
  `),
  findRunById: db.prepare(`
    SELECT *
    FROM tracking_runs
    WHERE id = ?
  `),
  findActiveRunByGuild: db.prepare(`
    SELECT *
    FROM tracking_runs
    WHERE guild_id = ?
      AND is_active = 1
    ORDER BY id DESC
    LIMIT 1
  `),
  listScheduledRunsDueToStart: db.prepare(`
    SELECT *
    FROM tracking_runs
    WHERE status = 'scheduled'
      AND scheduled_start IS NOT NULL
      AND scheduled_start <= ?
    ORDER BY scheduled_start ASC, id ASC
  `),
  listScheduledRunsDueToStop: db.prepare(`
    SELECT *
    FROM tracking_runs
    WHERE is_active = 1
      AND scheduled_end IS NOT NULL
      AND scheduled_end <= ?
    ORDER BY scheduled_end ASC, id ASC
  `),
  activateRun: db.prepare(`
    UPDATE tracking_runs
    SET is_active = 1,
        status = 'active',
        started_at = COALESCE(started_at, @startedAt),
        ended_at = NULL
    WHERE id = @id
  `),
  completeRun: db.prepare(`
    UPDATE tracking_runs
    SET is_active = 0,
        status = @status,
        ended_at = @endedAt
    WHERE id = @id
  `),
  createSession: db.prepare(`
    INSERT INTO tracking_sessions (
      tracking_run_id,
      guild_id,
      channel_id,
      channel_name,
      user_id,
      username,
      joined_at
    )
    VALUES (
      @trackingRunId,
      @guildId,
      @channelId,
      @channelName,
      @userId,
      @username,
      @joinedAt
    )
  `),
  closeSession: db.prepare(`
    UPDATE tracking_sessions
    SET left_at = @leftAt
    WHERE tracking_run_id = @trackingRunId
      AND user_id = @userId
      AND left_at IS NULL
  `),
  closeAllSessionsForRun: db.prepare(`
    UPDATE tracking_sessions
    SET left_at = @leftAt
    WHERE tracking_run_id = @trackingRunId
      AND left_at IS NULL
  `),
  listOpenSessionsForActiveRuns: db.prepare(`
    SELECT sessions.*
    FROM tracking_sessions AS sessions
    INNER JOIN tracking_runs AS runs ON runs.id = sessions.tracking_run_id
    WHERE runs.is_active = 1
      AND sessions.left_at IS NULL
  `),
  listChannelSummariesByRun: db.prepare(`
    SELECT
      channel_id,
      channel_name,
      COUNT(DISTINCT user_id) AS participant_count
    FROM tracking_sessions
    WHERE tracking_run_id = ?
    GROUP BY channel_id, channel_name
    ORDER BY channel_name COLLATE NOCASE ASC
  `),
  reportByRunAndChannel: db.prepare(`
    SELECT
      channel_id,
      channel_name,
      user_id,
      username,
      CAST(SUM(MAX(0, strftime('%s', COALESCE(left_at, CURRENT_TIMESTAMP)) - strftime('%s', joined_at))) AS INTEGER) AS total_seconds,
      GROUP_CONCAT(
        joined_at || ' -> ' || COALESCE(left_at, 'ACTIVE'),
        ' | '
      ) AS sessions
    FROM tracking_sessions
    WHERE tracking_run_id = ?
      AND channel_id = ?
    GROUP BY channel_id, channel_name, user_id, username
    ORDER BY total_seconds DESC, username COLLATE NOCASE ASC
  `),
  fullReportByRun: db.prepare(`
    SELECT
      channel_id,
      channel_name,
      user_id,
      username,
      CAST(SUM(MAX(0, strftime('%s', COALESCE(left_at, CURRENT_TIMESTAMP)) - strftime('%s', joined_at))) AS INTEGER) AS total_seconds,
      GROUP_CONCAT(
        joined_at || ' -> ' || COALESCE(left_at, 'ACTIVE'),
        ' | '
      ) AS sessions
    FROM tracking_sessions
    WHERE tracking_run_id = ?
    GROUP BY channel_id, channel_name, user_id, username
    ORDER BY channel_name COLLATE NOCASE ASC, total_seconds DESC, username COLLATE NOCASE ASC
  `)
};

export const trackingRunRepository = {
  createManual(input: { title: string; guildId: string; startedAt: string }) {
    const result = statements.createRun.run({
      title: input.title,
      guildId: input.guildId,
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: input.startedAt,
      endedAt: null,
      isActive: 1,
      status: "active"
    });

    return this.findById(Number(result.lastInsertRowid));
  },
  createScheduled(input: {
    title: string;
    guildId: string;
    scheduledStart: string;
    scheduledEnd: string;
  }) {
    const result = statements.createRun.run({
      title: input.title,
      guildId: input.guildId,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      startedAt: null,
      endedAt: null,
      isActive: 0,
      status: "scheduled"
    });

    return this.findById(Number(result.lastInsertRowid));
  },
  list(): TrackingRunRow[] {
    return statements.listRuns.all() as TrackingRunRow[];
  },
  listByGuild(guildId: string): TrackingRunRow[] {
    return statements.listRunsByGuild.all(guildId) as TrackingRunRow[];
  },
  findById(id: number): TrackingRunRow | undefined {
    return statements.findRunById.get(id) as TrackingRunRow | undefined;
  },
  findActiveByGuild(guildId: string): TrackingRunRow | undefined {
    return statements.findActiveRunByGuild.get(guildId) as TrackingRunRow | undefined;
  },
  listDueToStart(nowIso: string): TrackingRunRow[] {
    return statements.listScheduledRunsDueToStart.all(nowIso) as TrackingRunRow[];
  },
  listDueToStop(nowIso: string): TrackingRunRow[] {
    return statements.listScheduledRunsDueToStop.all(nowIso) as TrackingRunRow[];
  },
  markActive(id: number, startedAt: string) {
    statements.activateRun.run({ id, startedAt });
  },
  markCompleted(id: number, endedAt: string, status = "completed") {
    statements.completeRun.run({ id, endedAt, status });
  }
};

export const trackingSessionRepository = {
  create(input: {
    trackingRunId: number;
    guildId: string;
    channelId: string;
    channelName: string;
    userId: string;
    username: string;
    joinedAt: string;
  }) {
    statements.createSession.run(input);
  },
  close(input: { trackingRunId: number; userId: string; leftAt: string }) {
    statements.closeSession.run(input);
  },
  closeAllForRun(input: { trackingRunId: number; leftAt: string }) {
    statements.closeAllSessionsForRun.run(input);
  },
  listOpenForActiveRuns(): TrackingSessionRow[] {
    return statements.listOpenSessionsForActiveRuns.all() as TrackingSessionRow[];
  },
  listChannelSummariesByRun(runId: number): ChannelSummaryRow[] {
    return statements.listChannelSummariesByRun.all(runId) as ChannelSummaryRow[];
  },
  reportByRunAndChannel(runId: number, channelId: string): ChannelAttendanceReportRow[] {
    return statements.reportByRunAndChannel.all(runId, channelId) as ChannelAttendanceReportRow[];
  },
  fullReportByRun(runId: number): ChannelAttendanceReportRow[] {
    return statements.fullReportByRun.all(runId) as ChannelAttendanceReportRow[];
  }
};
