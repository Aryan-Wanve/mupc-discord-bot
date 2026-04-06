import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { config } from "./config";
import { AttendanceSessionRow, WebinarReportRow, WebinarRow } from "./types";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS webinars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    ended_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS attendance_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webinar_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    left_at TEXT,
    FOREIGN KEY (webinar_id) REFERENCES webinars(id)
  );

  CREATE INDEX IF NOT EXISTS idx_webinars_active ON webinars(is_active);
  CREATE INDEX IF NOT EXISTS idx_attendance_webinar_user ON attendance_sessions(webinar_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_open_sessions ON attendance_sessions(webinar_id, left_at);
`);

export const statements = {
  insertWebinar: db.prepare(`
    INSERT INTO webinars (title, guild_id, channel_id, notes)
    VALUES (@title, @guildId, @channelId, @notes)
  `),
  listWebinars: db.prepare(`
    SELECT *
    FROM webinars
    ORDER BY created_at DESC, id DESC
  `),
  findWebinarById: db.prepare(`
    SELECT *
    FROM webinars
    WHERE id = ?
  `),
  listWebinarsByGuild: db.prepare(`
    SELECT *
    FROM webinars
    WHERE guild_id = ?
    ORDER BY created_at DESC, id DESC
  `),
  findActiveWebinarsForChannel: db.prepare(`
    SELECT *
    FROM webinars
    WHERE guild_id = ?
      AND channel_id = ?
      AND is_active = 1
  `),
  startWebinar: db.prepare(`
    UPDATE webinars
    SET is_active = 1,
        started_at = COALESCE(started_at, @startedAt),
        ended_at = NULL
    WHERE id = @id
  `),
  stopWebinar: db.prepare(`
    UPDATE webinars
    SET is_active = 0,
        ended_at = @endedAt
    WHERE id = @id
  `),
  insertAttendanceSession: db.prepare(`
    INSERT INTO attendance_sessions (webinar_id, user_id, username, joined_at)
    VALUES (@webinarId, @userId, @username, @joinedAt)
  `),
  closeAttendanceSession: db.prepare(`
    UPDATE attendance_sessions
    SET left_at = @leftAt
    WHERE webinar_id = @webinarId
      AND user_id = @userId
      AND left_at IS NULL
  `),
  closeAllOpenSessionsForWebinar: db.prepare(`
    UPDATE attendance_sessions
    SET left_at = @leftAt
    WHERE webinar_id = @webinarId
      AND left_at IS NULL
  `),
  listSessionsForWebinar: db.prepare(`
    SELECT *
    FROM attendance_sessions
    WHERE webinar_id = ?
    ORDER BY joined_at ASC, id ASC
  `),
  reportForWebinar: db.prepare(`
    SELECT
      user_id,
      username,
      CAST(SUM(MAX(0, strftime('%s', COALESCE(left_at, CURRENT_TIMESTAMP)) - strftime('%s', joined_at))) AS INTEGER) AS total_seconds,
      GROUP_CONCAT(
        joined_at || ' -> ' || COALESCE(left_at, 'ACTIVE'),
        ' | '
      ) AS sessions
    FROM attendance_sessions
    WHERE webinar_id = ?
    GROUP BY user_id, username
    ORDER BY total_seconds DESC, username ASC
  `)
};

export const webinarRepository = {
  create(input: { title: string; guildId: string; channelId: string; notes?: string }) {
    return statements.insertWebinar.run({
      title: input.title,
      guildId: input.guildId,
      channelId: input.channelId,
      notes: input.notes ?? null
    });
  },
  list(): WebinarRow[] {
    return statements.listWebinars.all() as WebinarRow[];
  },
  findById(id: number): WebinarRow | undefined {
    return statements.findWebinarById.get(id) as WebinarRow | undefined;
  },
  listByGuild(guildId: string): WebinarRow[] {
    return statements.listWebinarsByGuild.all(guildId) as WebinarRow[];
  },
  findActiveByChannel(guildId: string, channelId: string): WebinarRow[] {
    return statements.findActiveWebinarsForChannel.all(guildId, channelId) as WebinarRow[];
  },
  markStarted(id: number, startedAt: string) {
    statements.startWebinar.run({ id, startedAt });
  },
  markStopped(id: number, endedAt: string) {
    statements.stopWebinar.run({ id, endedAt });
  }
};

export const attendanceRepository = {
  createSession(input: { webinarId: number; userId: string; username: string; joinedAt: string }) {
    return statements.insertAttendanceSession.run(input);
  },
  closeSession(input: { webinarId: number; userId: string; leftAt: string }) {
    return statements.closeAttendanceSession.run(input);
  },
  closeAllOpenSessionsForWebinar(input: { webinarId: number; leftAt: string }) {
    return statements.closeAllOpenSessionsForWebinar.run(input);
  },
  listByWebinar(webinarId: number): AttendanceSessionRow[] {
    return statements.listSessionsForWebinar.all(webinarId) as AttendanceSessionRow[];
  },
  reportByWebinar(webinarId: number): WebinarReportRow[] {
    return statements.reportForWebinar.all(webinarId) as WebinarReportRow[];
  }
};
