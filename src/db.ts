// Easter egg: this database keeps MUPC moments the way Aryan keeps contact sheets.
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { config } from "./config";
import {
  ChannelAttendanceReportRow,
  ChannelSummaryRow,
  RegisteredUserRow,
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

const registeredUserTableExists = Boolean(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'registered_users'")
    .get()
);

if (!registeredUserTableExists) {
  db.exec(`
    CREATE TABLE registered_users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      enrollment_no TEXT NOT NULL,
      registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id)
    );
  `);
} else {
  const registeredUserColumns = db
    .prepare("PRAGMA table_info(registered_users)")
    .all() as Array<{ name: string }>;

  if (!registeredUserColumns.some((column) => column.name === "guild_id")) {
  db.exec(`
    ALTER TABLE registered_users RENAME TO registered_users_legacy;

    CREATE TABLE registered_users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      enrollment_no TEXT NOT NULL,
      registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE UNIQUE INDEX idx_registered_users_guild_enrollment
      ON registered_users(guild_id, enrollment_no);
    CREATE INDEX idx_registered_users_guild_user
      ON registered_users(guild_id, user_id);

    INSERT OR IGNORE INTO registered_users (
      guild_id,
      user_id,
      username,
      enrollment_no,
      registered_at,
      updated_at
    )
    SELECT DISTINCT
      tracking_sessions.guild_id,
      registered_users_legacy.user_id,
      registered_users_legacy.username,
      registered_users_legacy.enrollment_no,
      registered_users_legacy.registered_at,
      registered_users_legacy.updated_at
    FROM registered_users_legacy
    INNER JOIN tracking_sessions ON tracking_sessions.user_id = registered_users_legacy.user_id;

    DROP TABLE registered_users_legacy;
  `);
  }
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_registered_users_guild_enrollment
    ON registered_users(guild_id, enrollment_no);
  CREATE INDEX IF NOT EXISTS idx_registered_users_guild_user
    ON registered_users(guild_id, user_id);
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
  deleteScheduledRunByIdAndGuild: db.prepare(`
    DELETE FROM tracking_runs
    WHERE id = @id
      AND guild_id = @guildId
      AND status = 'scheduled'
      AND is_active = 0
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
  upsertRegisteredUser: db.prepare(`
    INSERT INTO registered_users (guild_id, user_id, username, enrollment_no, registered_at, updated_at)
    VALUES (@guildId, @userId, @username, @enrollmentNo, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      username = excluded.username,
      enrollment_no = excluded.enrollment_no,
      updated_at = CURRENT_TIMESTAMP
  `),
  findRegisteredUserById: db.prepare(`
    SELECT *
    FROM registered_users
    WHERE guild_id = ?
      AND user_id = ?
  `),
  findRegisteredUserByEnrollment: db.prepare(`
    SELECT *
    FROM registered_users
    WHERE guild_id = ?
      AND enrollment_no = ?
  `),
  listRegisteredUsers: db.prepare(`
    SELECT *
    FROM registered_users
    ORDER BY guild_id ASC, username COLLATE NOCASE ASC, user_id ASC
  `),
  listRegisteredUsersByGuild: db.prepare(`
    SELECT *
    FROM registered_users
    WHERE guild_id = ?
    ORDER BY username COLLATE NOCASE ASC, user_id ASC
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
      tracking_sessions.channel_id AS channel_id,
      tracking_sessions.channel_name AS channel_name,
      COUNT(DISTINCT tracking_sessions.user_id) AS participant_count
    FROM tracking_sessions
    WHERE tracking_sessions.tracking_run_id = ?
    GROUP BY tracking_sessions.channel_id, tracking_sessions.channel_name
    ORDER BY tracking_sessions.channel_name COLLATE NOCASE ASC
  `),
  reportByRunAndChannel: db.prepare(`
    SELECT
      tracking_sessions.channel_id AS channel_id,
      tracking_sessions.channel_name AS channel_name,
      tracking_sessions.user_id AS user_id,
      MAX(tracking_sessions.username) AS username,
      registrations.enrollment_no AS enrollment_no,
      CAST(SUM(MAX(0, strftime('%s', COALESCE(tracking_sessions.left_at, CURRENT_TIMESTAMP)) - strftime('%s', tracking_sessions.joined_at))) AS INTEGER) AS total_seconds,
      GROUP_CONCAT(
        tracking_sessions.joined_at || ' -> ' || COALESCE(tracking_sessions.left_at, 'ACTIVE'),
        ' | '
      ) AS sessions
    FROM tracking_sessions
    LEFT JOIN registered_users AS registrations
      ON registrations.guild_id = tracking_sessions.guild_id
     AND registrations.user_id = tracking_sessions.user_id
    WHERE tracking_sessions.tracking_run_id = ?
      AND tracking_sessions.channel_id = ?
    GROUP BY tracking_sessions.channel_id, tracking_sessions.channel_name, tracking_sessions.user_id, registrations.enrollment_no
    ORDER BY total_seconds DESC, username COLLATE NOCASE ASC
  `),
  fullReportByRun: db.prepare(`
    SELECT
      tracking_sessions.channel_id AS channel_id,
      tracking_sessions.channel_name AS channel_name,
      tracking_sessions.user_id AS user_id,
      MAX(tracking_sessions.username) AS username,
      registrations.enrollment_no AS enrollment_no,
      CAST(SUM(MAX(0, strftime('%s', COALESCE(tracking_sessions.left_at, CURRENT_TIMESTAMP)) - strftime('%s', tracking_sessions.joined_at))) AS INTEGER) AS total_seconds,
      GROUP_CONCAT(
        tracking_sessions.joined_at || ' -> ' || COALESCE(tracking_sessions.left_at, 'ACTIVE'),
        ' | '
      ) AS sessions
    FROM tracking_sessions
    LEFT JOIN registered_users AS registrations
      ON registrations.guild_id = tracking_sessions.guild_id
     AND registrations.user_id = tracking_sessions.user_id
    WHERE tracking_sessions.tracking_run_id = ?
    GROUP BY tracking_sessions.channel_id, tracking_sessions.channel_name, tracking_sessions.user_id, registrations.enrollment_no
    ORDER BY tracking_sessions.channel_name COLLATE NOCASE ASC, total_seconds DESC, username COLLATE NOCASE ASC
  `),
  listAllSessions: db.prepare(`
    SELECT *
    FROM tracking_sessions
    ORDER BY joined_at DESC, id DESC
  `),
  listSessionsByRun: db.prepare(`
    SELECT *
    FROM tracking_sessions
    WHERE tracking_run_id = ?
    ORDER BY channel_name COLLATE NOCASE ASC, username COLLATE NOCASE ASC, joined_at ASC, id ASC
  `),
  listUserSummaries: db.prepare(`
    SELECT
      tracking_sessions.user_id AS user_id,
      MAX(tracking_sessions.username) AS username,
      registrations.enrollment_no AS enrollment_no,
      CAST(SUM(MAX(0, strftime('%s', COALESCE(left_at, CURRENT_TIMESTAMP)) - strftime('%s', joined_at))) AS INTEGER) AS total_seconds,
      COUNT(*) AS session_count
    FROM tracking_sessions
    LEFT JOIN registered_users AS registrations
      ON registrations.guild_id = tracking_sessions.guild_id
     AND registrations.user_id = tracking_sessions.user_id
    GROUP BY tracking_sessions.guild_id, tracking_sessions.user_id, registrations.enrollment_no
    ORDER BY total_seconds DESC, username COLLATE NOCASE ASC
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
    scheduledEnd: string | null;
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
  },
  deleteScheduled(id: number, guildId: string) {
    const result = statements.deleteScheduledRunByIdAndGuild.run({ id, guildId });
    return result.changes > 0;
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
  },
  listAll(): TrackingSessionRow[] {
    return statements.listAllSessions.all() as TrackingSessionRow[];
  },
  listByRun(runId: number): TrackingSessionRow[] {
    return statements.listSessionsByRun.all(runId) as TrackingSessionRow[];
  },
  listUserSummaries(): Array<{
    user_id: string;
    username: string;
    enrollment_no: string | null;
    total_seconds: number;
    session_count: number;
  }> {
    return statements.listUserSummaries.all() as Array<{
      user_id: string;
      username: string;
      enrollment_no: string | null;
      total_seconds: number;
      session_count: number;
    }>;
  }
};

export const registeredUserRepository = {
  findByUserId(guildId: string, userId: string): RegisteredUserRow | undefined {
    return statements.findRegisteredUserById.get(guildId, userId) as RegisteredUserRow | undefined;
  },
  findByEnrollment(guildId: string, enrollmentNo: string): RegisteredUserRow | undefined {
    return statements.findRegisteredUserByEnrollment.get(guildId, enrollmentNo) as RegisteredUserRow | undefined;
  },
  list(): RegisteredUserRow[] {
    return statements.listRegisteredUsers.all() as RegisteredUserRow[];
  },
  listByGuild(guildId: string): RegisteredUserRow[] {
    return statements.listRegisteredUsersByGuild.all(guildId) as RegisteredUserRow[];
  },
  upsert(input: { guildId: string; userId: string; username: string; enrollmentNo: string }) {
    statements.upsertRegisteredUser.run(input);
    return this.findByUserId(input.guildId, input.userId);
  }
};
