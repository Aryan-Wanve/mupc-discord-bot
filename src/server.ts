import ExcelJS from "exceljs";
import express, { NextFunction, Request, Response } from "express";
import path from "path";
import { config } from "./config";
import { registeredUserRepository, trackingRunRepository, trackingSessionRepository } from "./db";
import { formatDateTime, formatDuration, formatPercentage } from "./utils";

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.use(express.urlencoded({ extended: true }));
app.use("/assets", express.static(path.join(process.cwd(), "public")));

const requireBasicAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", "Basic realm=\"Attendance Dashboard\"");
    return res.status(401).send("Authentication required.");
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const [username, password] = decoded.split(":");

  if (username !== config.dashboardUsername || password !== config.dashboardPassword) {
    res.setHeader("WWW-Authenticate", "Basic realm=\"Attendance Dashboard\"");
    return res.status(401).send("Invalid credentials.");
  }

  next();
};

type ExportRow = {
  serial: number;
  username: string;
  userId: string;
  enrollmentNo: string;
  totalSeconds: number;
  totalDuration: string;
  percentage: string;
  firstJoin: string;
  lastLeave: string;
  totalSessions: number;
};

const sanitizeWorksheetName = (name: string) =>
  name.replace(/[:\\/?*\[\]]/g, " ").trim().slice(0, 31) || "Voice Channel";

const summarizeRunByChannel = (runId: number, runStart: string | null, runEnd: string | null) => {
  const sessions = trackingSessionRepository.listByRun(runId);
  const registrations = new Map(
    registeredUserRepository.list().map((user) => [user.user_id, user.enrollment_no])
  );
  const totalRunSeconds =
    runStart && runEnd
      ? Math.max(0, Math.floor((new Date(runEnd).getTime() - new Date(runStart).getTime()) / 1000))
      : 0;

  const byChannel = new Map<string, { channelName: string; rows: ExportRow[] }>();
  const grouped = new Map<
    string,
    {
      channelId: string;
      channelName: string;
      userId: string;
      username: string;
      enrollmentNo: string;
      firstJoin: string;
      lastLeave: string;
      totalSeconds: number;
      totalSessions: number;
    }
  >();

  for (const session of sessions) {
    const key = `${session.channel_id}:${session.user_id}`;
    const leftAt = session.left_at ?? runEnd ?? session.joined_at;
    const durationSeconds = Math.max(
      0,
      Math.floor((new Date(leftAt).getTime() - new Date(session.joined_at).getTime()) / 1000)
    );

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        channelId: session.channel_id,
        channelName: session.channel_name,
        userId: session.user_id,
        username: session.username,
        enrollmentNo: registrations.get(session.user_id) ?? "Not registered",
        firstJoin: session.joined_at,
        lastLeave: leftAt,
        totalSeconds: durationSeconds,
        totalSessions: 1
      });
      continue;
    }

    existing.totalSeconds += durationSeconds;
    existing.totalSessions += 1;
    if (new Date(session.joined_at) < new Date(existing.firstJoin)) {
      existing.firstJoin = session.joined_at;
    }
    if (new Date(leftAt) > new Date(existing.lastLeave)) {
      existing.lastLeave = leftAt;
    }
  }

  const sortedRows = [...grouped.values()].sort((left, right) => {
    if (left.channelName !== right.channelName) {
      return left.channelName.localeCompare(right.channelName);
    }

    if (right.totalSeconds !== left.totalSeconds) {
      return right.totalSeconds - left.totalSeconds;
    }

    return left.username.localeCompare(right.username);
  });

  for (const entry of sortedRows) {
    const channel = byChannel.get(entry.channelId) ?? {
      channelName: entry.channelName,
      rows: []
    };

    channel.rows.push({
      serial: channel.rows.length + 1,
      username: entry.username,
      userId: entry.userId,
      enrollmentNo: entry.enrollmentNo,
      totalSeconds: entry.totalSeconds,
      totalDuration: formatDuration(entry.totalSeconds),
      percentage: formatPercentage(entry.totalSeconds, totalRunSeconds),
      firstJoin: formatDateTime(entry.firstJoin),
      lastLeave: formatDateTime(entry.lastLeave),
      totalSessions: entry.totalSessions
    });

    byChannel.set(entry.channelId, channel);
  }

  return {
    totalRunSeconds,
    channels: [...byChannel.entries()].map(([channelId, value]) => ({
      channelId,
      channelName: value.channelName,
      rows: value.rows
    }))
  };
};

const createWorkbookForRun = (runId: number) => {
  const run = trackingRunRepository.findById(runId);
  if (!run) {
    return null;
  }

  const summary = summarizeRunByChannel(run.id, run.started_at, run.ended_at);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MUPC Attendance Bot";
  workbook.created = new Date();

  const header = [
    "S.No",
    "Username",
    "User ID",
    "Enrollment No",
    "Total Duration (HH:MM:SS)",
    "Percentage of Total Duration",
    "First Join",
    "Last Leave",
    "Total Sessions in VC"
  ];

  for (const channel of summary.channels) {
    const sheet = workbook.addWorksheet(sanitizeWorksheetName(channel.channelName));
    sheet.addRow(header);

    for (const row of channel.rows) {
      sheet.addRow([
        row.serial,
        row.username,
        row.userId,
        row.enrollmentNo,
        row.totalDuration,
        row.percentage,
        row.firstJoin,
        row.lastLeave,
        row.totalSessions
      ]);
    }

    sheet.columns = [
      { width: 8 },
      { width: 24 },
      { width: 24 },
      { width: 20 },
      { width: 22 },
      { width: 24 },
      { width: 24 },
      { width: 24 },
      { width: 18 }
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  if (summary.channels.length === 0) {
    const sheet = workbook.addWorksheet("No Data");
    sheet.addRow(["No tracked voice activity for this run."]);
  }

  return { run, workbook, summary };
};

app.use(requireBasicAuth);

app.get("/", (req, res) => {
  const runs = trackingRunRepository.list().map((run) => {
    const channels = summarizeRunByChannel(run.id, run.started_at, run.ended_at).channels;

    return {
      ...run,
      created_display: formatDateTime(run.created_at),
      scheduled_start_display: formatDateTime(run.scheduled_start),
      scheduled_end_display: formatDateTime(run.scheduled_end),
      started_display: formatDateTime(run.started_at),
      ended_display: formatDateTime(run.ended_at),
      channels
    };
  });

  res.render("index", { runs });
});

app.get("/users", (req, res) => {
  const users = trackingSessionRepository.listUserSummaries().map((user) => ({
    ...user,
    total_display: formatDuration(user.total_seconds)
  }));

  const registrations = registeredUserRepository.list().map((user) => ({
    ...user,
    registered_display: formatDateTime(user.registered_at),
    updated_display: formatDateTime(user.updated_at)
  }));

  const sessions = trackingSessionRepository.listAll().map((session) => ({
    ...session,
    enrollment_no: registeredUserRepository.findByUserId(session.user_id)?.enrollment_no ?? "Not registered",
    joined_display: formatDateTime(session.joined_at),
    left_display: formatDateTime(session.left_at)
  }));

  res.render("users", { users, sessions, registrations });
});

app.get("/runs/:id/export.xlsx", async (req, res) => {
  const result = createWorkbookForRun(Number(req.params.id));
  if (!result) {
    return res.status(404).send("Tracking run not found.");
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${result.run.title.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}-attendance.xlsx"`
  );

  await result.workbook.xlsx.write(res);
  res.end();
});

export async function startServer() {
  return new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      console.log(`Dashboard running on http://localhost:${config.port}`);
      resolve();
    });
  });
}
