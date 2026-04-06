import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { config } from "./config";
import { attendanceRepository, webinarRepository } from "./db";
import { startWebinarTracking, stopWebinarTracking } from "./bot";
import { csvEscape, formatDuration } from "./utils";

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
  const webinars = webinarRepository.list().map((webinar) => ({
    ...webinar,
    report: attendanceRepository.reportByWebinar(webinar.id).map((entry) => ({
      ...entry,
      total_display: formatDuration(entry.total_seconds)
    }))
  }));

  res.render("index", { webinars });
});

app.post("/webinars", (req, res) => {
  const title = String(req.body.title ?? "").trim();
  const guildId = String(req.body.guildId ?? "").trim();
  const channelId = String(req.body.channelId ?? "").trim();
  const notes = String(req.body.notes ?? "").trim();

  if (!title || !guildId || !channelId) {
    return res.status(400).send("Title, guild ID, and channel ID are required.");
  }

  webinarRepository.create({ title, guildId, channelId, notes });
  res.redirect("/");
});

app.post("/webinars/:id/start", async (req, res) => {
  try {
    await startWebinarTracking(Number(req.params.id));
    res.redirect("/");
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Failed to start webinar.");
  }
});

app.post("/webinars/:id/stop", (req, res) => {
  try {
    stopWebinarTracking(Number(req.params.id));
    res.redirect("/");
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : "Failed to stop webinar.");
  }
});

app.get("/webinars/:id/export.csv", (req, res) => {
  const webinarId = Number(req.params.id);
  const webinar = webinarRepository.findById(webinarId);
  if (!webinar) {
    return res.status(404).send("Webinar not found.");
  }

  const report = attendanceRepository.reportByWebinar(webinarId);
  const csvRows = [
    ["User ID", "Username", "Total Seconds", "Total Duration", "Marked Timings"].join(","),
    ...report.map((row) =>
      [
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
    `attachment; filename="${webinar.title.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}-attendance.csv"`
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
