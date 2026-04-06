import express, { NextFunction, Request, Response } from "express";
import path from "path";
import { config } from "./config";
import { trackingRunRepository, trackingSessionRepository } from "./db";
import { csvEscape, formatDateTime, formatDuration } from "./utils";

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

app.use(requireBasicAuth);

app.get("/", (req, res) => {
  const runs = trackingRunRepository.list().map((run) => {
    const channels = trackingSessionRepository.listChannelSummariesByRun(run.id).map((channel) => ({
      ...channel,
      report: trackingSessionRepository.reportByRunAndChannel(run.id, channel.channel_id).map((entry) => ({
        ...entry,
        total_display: formatDuration(entry.total_seconds)
      }))
    }));

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

  const sessions = trackingSessionRepository.listAll().map((session) => ({
    ...session,
    joined_display: formatDateTime(session.joined_at),
    left_display: formatDateTime(session.left_at)
  }));

  res.render("users", { users, sessions });
});

app.get("/runs/:id/export.csv", (req, res) => {
  const runId = Number(req.params.id);
  const run = trackingRunRepository.findById(runId);
  if (!run) {
    return res.status(404).send("Tracking run not found.");
  }

  const report = trackingSessionRepository.fullReportByRun(runId);
  const csvRows = [
    ["Channel", "User ID", "Username", "Total Seconds", "Total Duration", "Marked Timings"].join(","),
    ...report.map((row) =>
      [
        csvEscape(row.channel_name),
        csvEscape(row.user_id),
        csvEscape(row.username),
        csvEscape(row.total_seconds),
        csvEscape(formatDuration(row.total_seconds)),
        csvEscape(row.sessions)
      ].join(",")
    )
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${run.title.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}-all-channels.csv"`
  );
  res.send(csvRows.join("\n"));
});

app.get("/runs/:id/channels/:channelId/export.csv", (req, res) => {
  const runId = Number(req.params.id);
  const channelId = req.params.channelId;
  const run = trackingRunRepository.findById(runId);
  if (!run) {
    return res.status(404).send("Tracking run not found.");
  }

  const report = trackingSessionRepository.reportByRunAndChannel(runId, channelId);
  if (report.length === 0) {
    return res.status(404).send("Channel report not found.");
  }

  const csvRows = [
    ["Channel", "User ID", "Username", "Total Seconds", "Total Duration", "Marked Timings"].join(","),
    ...report.map((row) =>
      [
        csvEscape(row.channel_name),
        csvEscape(row.user_id),
        csvEscape(row.username),
        csvEscape(row.total_seconds),
        csvEscape(formatDuration(row.total_seconds)),
        csvEscape(row.sessions)
      ].join(",")
    )
  ];

  const safeTitle = run.title.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
  const safeChannel = report[0].channel_name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeTitle}-${safeChannel}.csv"`
  );
  res.send(csvRows.join("\n"));
});

export async function startServer() {
  return new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      console.log(`Dashboard running on http://localhost:${config.port}`);
      resolve();
    });
  });
}
