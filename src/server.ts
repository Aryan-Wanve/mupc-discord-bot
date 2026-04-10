// Easter egg: these dashboards were framed with a little Oneway energy for future explorers.
import ExcelJS from "exceljs";
import { createHash } from "crypto";
import express, { NextFunction, Request, Response } from "express";
import path from "path";
import { discordClient } from "./bot";
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
  firstJoinIso: string;
  firstJoin: string;
  lastLeaveIso: string;
  lastLeave: string;
  totalSessions: number;
};

type ParticipantAggregate = {
  username: string;
  userId: string;
  enrollmentNo: string;
  totalSeconds: number;
  totalDuration: string;
  totalSessions: number;
  firstJoinIso: string;
  firstJoinDisplay: string;
  lastLeaveIso: string;
  lastLeaveDisplay: string;
  percentage: string;
  channelCount: number;
};

type UserAnalyticsRow = {
  username: string;
  userId: string;
  enrollmentNo: string;
  totalRunsJoined: number;
  totalSeconds: number;
  totalDuration: string;
  averagePercentage: string;
  averagePercentageValue: number;
  totalSessions: number;
  firstSeenDisplay: string;
  lastSeenDisplay: string;
};

type ServerSummary = {
  guildId: string;
  guildName: string;
  guildIconUrl: string | null;
  runCount: number;
  activeCount: number;
  trackedParticipants: number;
  latestActivity: string | null;
  latestActivityDisplay: string;
};

const createSnapshot = (value: unknown) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);

const getGuildName = (guildId: string) => discordClient.guilds.cache.get(guildId)?.name ?? `Server ${guildId}`;
const getGuildIconUrl = (guildId: string) =>
  discordClient.guilds.cache.get(guildId)?.iconURL({ extension: "png", size: 128 }) ?? null;

const filterRunsByGuild = (guildId: string) => trackingRunRepository.listByGuild(guildId);
const filterSessionsByGuild = (guildId: string) =>
  trackingSessionRepository.listAll().filter((session) => session.guild_id === guildId);

const getRunAnalyticsEnd = (run: { is_active: number; ended_at: string | null }) =>
  run.ended_at ?? (run.is_active ? new Date().toISOString() : null);

const getRunDurationSeconds = (startedAt: string | null, endedAt: string | null) => {
  if (!startedAt || !endedAt) {
    return 0;
  }

  return Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
};

const listKnownGuildMembers = async (guildId: string) => {
  const guild =
    discordClient.guilds.cache.get(guildId) ?? (await discordClient.guilds.fetch(guildId).catch(() => null));
  if (!guild) {
    return [] as Array<{ user_id: string; server_username: string; discord_username: string }>;
  }

  const members = await guild.members.fetch().catch(() => null);
  if (!members) {
    return [] as Array<{ user_id: string; server_username: string; discord_username: string }>;
  }

  return [...members.values()]
    .filter((member) => !member.user.bot)
    .map((member) => ({
      user_id: member.id,
      server_username: member.displayName ?? member.user.globalName ?? member.user.username,
      discord_username: member.user.username
    }));
};

const sanitizeWorksheetName = (name: string) =>
  name.replace(/[:\\/?*\[\]]/g, " ").trim().slice(0, 31) || "Voice Channel";

const autoFitWorksheetColumns = (sheet: ExcelJS.Worksheet, minimumWidth = 12) => {
  sheet.columns.forEach((column) => {
    let maxLength = minimumWidth;
    if (!column.eachCell) {
      column.width = minimumWidth;
      return;
    }

    column.eachCell({ includeEmpty: true }, (cell) => {
      const rawValue = cell.value;
      const text =
        typeof rawValue === "object" && rawValue !== null && "richText" in rawValue
          ? rawValue.richText.map((part) => part.text).join("")
          : String(rawValue ?? "");
      maxLength = Math.max(maxLength, text.length + 2);
    });

    column.width = Math.min(maxLength, 40);
  });
};

const summarizeRunByChannel = (runId: number, runStart: string | null, runEnd: string | null) => {
  const sessions = trackingSessionRepository.listByRun(runId);
  const guildId = sessions[0]?.guild_id ?? trackingRunRepository.findById(runId)?.guild_id ?? "";
  const registrations = new Map(
    registeredUserRepository
      .listByGuild(guildId)
      .map((user) => [`${user.guild_id}:${user.user_id}`, user.enrollment_no])
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
        enrollmentNo: registrations.get(`${session.guild_id}:${session.user_id}`) ?? "Not registered",
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
      firstJoinIso: entry.firstJoin,
      firstJoin: formatDateTime(entry.firstJoin),
      lastLeaveIso: entry.lastLeave,
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

const buildRunAnalytics = (runId: number, runStart: string | null, runEnd: string | null) => {
  const summary = summarizeRunByChannel(runId, runStart, runEnd);
  const participantMap = new Map<
    string,
    {
      username: string;
      userId: string;
      enrollmentNo: string;
      totalSeconds: number;
      totalSessions: number;
      firstJoinIso: string;
      lastLeaveIso: string;
      channels: Set<string>;
    }
  >();

  for (const channel of summary.channels) {
    for (const row of channel.rows) {
      const existing = participantMap.get(row.userId);
      if (!existing) {
        participantMap.set(row.userId, {
          username: row.username,
          userId: row.userId,
          enrollmentNo: row.enrollmentNo,
          totalSeconds: row.totalSeconds,
          totalSessions: row.totalSessions,
          firstJoinIso: row.firstJoinIso,
          lastLeaveIso: row.lastLeaveIso,
          channels: new Set([channel.channelName])
        });
        continue;
      }

      existing.totalSeconds += row.totalSeconds;
      existing.totalSessions += row.totalSessions;
      existing.channels.add(channel.channelName);

      const firstJoinTime = new Date(existing.firstJoinIso).getTime();
      const rowFirstJoinTime = new Date(row.firstJoinIso).getTime();
      if (!Number.isNaN(rowFirstJoinTime) && (Number.isNaN(firstJoinTime) || rowFirstJoinTime < firstJoinTime)) {
        existing.firstJoinIso = row.firstJoinIso;
      }

      const lastLeaveTime = new Date(existing.lastLeaveIso).getTime();
      const rowLastLeaveTime = new Date(row.lastLeaveIso).getTime();
      if (!Number.isNaN(rowLastLeaveTime) && (Number.isNaN(lastLeaveTime) || rowLastLeaveTime > lastLeaveTime)) {
        existing.lastLeaveIso = row.lastLeaveIso;
      }
    }
  }

  const participants: ParticipantAggregate[] = [...participantMap.values()]
    .map((entry) => ({
      username: entry.username,
      userId: entry.userId,
      enrollmentNo: entry.enrollmentNo,
      totalSeconds: entry.totalSeconds,
      totalDuration: formatDuration(entry.totalSeconds),
      totalSessions: entry.totalSessions,
      firstJoinIso: entry.firstJoinIso,
      firstJoinDisplay: formatDateTime(entry.firstJoinIso),
      lastLeaveIso: entry.lastLeaveIso,
      lastLeaveDisplay: formatDateTime(entry.lastLeaveIso),
      percentage: formatPercentage(entry.totalSeconds, summary.totalRunSeconds),
      channelCount: entry.channels.size
    }))
    .sort((left, right) => right.totalSeconds - left.totalSeconds || left.username.localeCompare(right.username));

  const topSeconds = participants[0]?.totalSeconds ?? 1;
  const topSessions = Math.max(...participants.map((participant) => participant.totalSessions), 1);
  const topChannelsTouched = Math.max(...participants.map((participant) => participant.channelCount), 1);
  const topChannelTime = Math.max(
    ...summary.channels.map((channel) =>
      channel.rows.reduce((sum, row) => sum + row.totalSeconds, 0)
    ),
    1
  );

  const channels = summary.channels.map((channel) => {
    const totalSeconds = channel.rows.reduce((sum, row) => sum + row.totalSeconds, 0);
    return {
      ...channel,
      totalSeconds,
      totalDuration: formatDuration(totalSeconds),
      averageDuration:
        channel.rows.length > 0 ? formatDuration(Math.round(totalSeconds / channel.rows.length)) : "00:00:00",
      topBarWidth: `${Math.max(10, Math.round((totalSeconds / topChannelTime) * 100))}%`
    };
  });

  const earliestArrivals = [...participants]
    .filter((participant) => participant.firstJoinIso !== "Not set")
    .sort((left, right) => new Date(left.firstJoinIso).getTime() - new Date(right.firstJoinIso).getTime())
    .slice(0, 5);

  const latestLeavers = [...participants]
    .filter((participant) => participant.lastLeaveIso !== "Not set")
    .sort((left, right) => new Date(right.lastLeaveIso).getTime() - new Date(left.lastLeaveIso).getTime())
    .slice(0, 5);

  return {
    summary,
    participants,
    channels,
    topAttendees: participants.slice(0, 5).map((participant) => ({
      ...participant,
      barWidth: `${Math.max(10, Math.round((participant.totalSeconds / topSeconds) * 100))}%`
    })),
    mostRejoined: [...participants]
      .sort((left, right) => right.totalSessions - left.totalSessions || right.totalSeconds - left.totalSeconds)
      .slice(0, 5)
      .map((participant) => ({
        ...participant,
        barWidth: `${Math.max(10, Math.round((participant.totalSessions / topSessions) * 100))}%`
      })),
    explorers: [...participants]
      .sort((left, right) => right.channelCount - left.channelCount || right.totalSeconds - left.totalSeconds)
      .slice(0, 5)
      .map((participant) => ({
        ...participant,
        barWidth: `${Math.max(10, Math.round((participant.channelCount / topChannelsTouched) * 100))}%`
      })),
    earliestArrivals,
    latestLeavers,
    totalParticipants: participants.length,
    totalChannels: summary.channels.length,
    totalRunSeconds: summary.totalRunSeconds,
    totalRunDuration: formatDuration(summary.totalRunSeconds)
  };
};

const buildUserAnalytics = (guildId?: string) => {
  const runs = guildId ? filterRunsByGuild(guildId) : trackingRunRepository.list();
  const sessions = guildId ? filterSessionsByGuild(guildId) : trackingSessionRepository.listAll();
  const registrations = new Map(
    (guildId ? registeredUserRepository.listByGuild(guildId) : registeredUserRepository.list()).map((user) => [
      `${user.guild_id}:${user.user_id}`,
      user.enrollment_no
    ])
  );
  const runDurations = new Map(
    runs.map((run) => {
      const seconds =
        run.started_at && run.ended_at
          ? Math.max(0, Math.floor((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000))
          : 0;
      return [run.id, seconds];
    })
  );

  const perUserPerRun = new Map<
    string,
    {
      userId: string;
      username: string;
      runId: number;
      totalSeconds: number;
    }
  >();

  const perUser = new Map<
    string,
    {
      username: string;
      userId: string;
      totalSeconds: number;
      totalSessions: number;
      runIds: Set<number>;
      percentageValues: number[];
      firstSeenIso: string;
      lastSeenIso: string;
    }
  >();

  for (const session of sessions) {
    const userEntry = perUser.get(session.user_id) ?? {
      username: session.username,
      userId: session.user_id,
      totalSeconds: 0,
      totalSessions: 0,
      runIds: new Set<number>(),
      percentageValues: [],
      firstSeenIso: session.joined_at,
      lastSeenIso: session.left_at ?? session.joined_at
    };

    const leftAt = session.left_at ?? session.joined_at;
    const durationSeconds = Math.max(
      0,
      Math.floor((new Date(leftAt).getTime() - new Date(session.joined_at).getTime()) / 1000)
    );

    userEntry.totalSeconds += durationSeconds;
    userEntry.totalSessions += 1;
    userEntry.runIds.add(session.tracking_run_id);
    if (new Date(session.joined_at).getTime() < new Date(userEntry.firstSeenIso).getTime()) {
      userEntry.firstSeenIso = session.joined_at;
    }
    if (new Date(leftAt).getTime() > new Date(userEntry.lastSeenIso).getTime()) {
      userEntry.lastSeenIso = leftAt;
    }
    perUser.set(session.user_id, userEntry);

    const runKey = `${session.user_id}:${session.tracking_run_id}`;
    const runEntry = perUserPerRun.get(runKey) ?? {
      userId: session.user_id,
      username: session.username,
      runId: session.tracking_run_id,
      totalSeconds: 0
    };
    runEntry.totalSeconds += durationSeconds;
    perUserPerRun.set(runKey, runEntry);
  }

  for (const runEntry of perUserPerRun.values()) {
    const userEntry = perUser.get(runEntry.userId);
    const runSeconds = runDurations.get(runEntry.runId) ?? 0;
    if (!userEntry) {
      continue;
    }

    userEntry.percentageValues.push(runSeconds > 0 ? (runEntry.totalSeconds / runSeconds) * 100 : 0);
  }

  const rows: UserAnalyticsRow[] = [...perUser.values()]
    .map((user) => {
      const averagePercentageValue =
        user.percentageValues.length > 0
          ? user.percentageValues.reduce((sum, value) => sum + value, 0) / user.percentageValues.length
          : 0;

      return {
        username: user.username,
        userId: user.userId,
        enrollmentNo: registrations.get(`${guildId ?? "all"}:${user.userId}`) ??
          registrations.get(
            [...registrations.keys()].find((key) => key.endsWith(`:${user.userId}`)) ?? ""
          ) ??
          "Not registered",
        totalRunsJoined: user.runIds.size,
        totalSeconds: user.totalSeconds,
        totalDuration: formatDuration(user.totalSeconds),
        averagePercentage: `${averagePercentageValue.toFixed(2)}%`,
        averagePercentageValue,
        totalSessions: user.totalSessions,
        firstSeenDisplay: formatDateTime(user.firstSeenIso),
        lastSeenDisplay: formatDateTime(user.lastSeenIso)
      };
    })
    .sort((left, right) => {
      if (right.totalRunsJoined !== left.totalRunsJoined) {
        return right.totalRunsJoined - left.totalRunsJoined;
      }

      if (right.averagePercentageValue !== left.averagePercentageValue) {
        return right.averagePercentageValue - left.averagePercentageValue;
      }

      return right.totalSeconds - left.totalSeconds;
    });

  return rows;
};

const createWorkbookForRun = async (runId: number) => {
  const run = trackingRunRepository.findById(runId);
  if (!run) {
    return null;
  }

  const summary = summarizeRunByChannel(run.id, run.started_at, run.ended_at);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MUPC Attendance Bot";
  workbook.created = new Date();
  const guildMembers = new Map(
    (await listKnownGuildMembers(run.guild_id)).map((member) => [member.user_id, member])
  );

  const header = [
    "S.No",
    "Server Username",
    "Discord Username",
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
      const member = guildMembers?.get(row.userId);
      sheet.addRow([
        row.serial,
        member?.server_username ?? row.username,
        member?.discord_username ?? row.username,
        row.userId,
        row.enrollmentNo,
        row.totalDuration,
        row.percentage,
        row.firstJoin,
        row.lastLeave,
        row.totalSessions
      ]);
    }

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getColumn(4).numFmt = "@";
    sheet.eachRow((worksheetRow, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      worksheetRow.getCell(4).value = String(worksheetRow.getCell(4).value ?? "");
    });
    autoFitWorksheetColumns(sheet);
  }

  if (summary.channels.length === 0) {
    const sheet = workbook.addWorksheet("No Data");
    sheet.addRow(["No tracked voice activity for this run."]);
  }

  return { run, workbook, summary };
};

const buildServerSelectionPageData = () => {
  const runs = trackingRunRepository.list();
  const grouped = new Map<string, { runs: typeof runs; participantIds: Set<string>; latestActivity: string | null }>();

  for (const run of runs) {
    const existing =
      grouped.get(run.guild_id) ??
      { runs: [], participantIds: new Set<string>(), latestActivity: null };
    existing.runs.push(run);
    const activityMarker = run.ended_at ?? run.started_at ?? run.scheduled_start ?? run.created_at;
    if (!existing.latestActivity || new Date(activityMarker) > new Date(existing.latestActivity)) {
      existing.latestActivity = activityMarker;
    }
    grouped.set(run.guild_id, existing);
  }

  for (const session of trackingSessionRepository.listAll()) {
    const existing =
      grouped.get(session.guild_id) ??
      { runs: [], participantIds: new Set<string>(), latestActivity: session.joined_at };
    existing.participantIds.add(session.user_id);
    if (!existing.latestActivity || new Date(session.joined_at) > new Date(existing.latestActivity)) {
      existing.latestActivity = session.joined_at;
    }
    grouped.set(session.guild_id, existing);
  }

  for (const registration of registeredUserRepository.list()) {
    const existing =
      grouped.get(registration.guild_id) ??
      { runs: [], participantIds: new Set<string>(), latestActivity: registration.updated_at };
    existing.participantIds.add(registration.user_id);
    if (!existing.latestActivity || new Date(registration.updated_at) > new Date(existing.latestActivity)) {
      existing.latestActivity = registration.updated_at;
    }
    grouped.set(registration.guild_id, existing);
  }

  const servers: ServerSummary[] = [...grouped.entries()]
    .map(([guildId, value]) => ({
      guildId,
      guildName: getGuildName(guildId),
      guildIconUrl: getGuildIconUrl(guildId),
      runCount: value.runs.length,
      activeCount: value.runs.filter((run) => run.is_active).length,
      trackedParticipants: value.participantIds.size,
      latestActivity: value.latestActivity,
      latestActivityDisplay: formatDateTime(value.latestActivity)
    }))
    .sort((left, right) => {
      const leftTime = left.latestActivity ? new Date(left.latestActivity).getTime() : 0;
      const rightTime = right.latestActivity ? new Date(right.latestActivity).getTime() : 0;
      return rightTime - leftTime || left.guildName.localeCompare(right.guildName);
    });

  return {
    servers,
    currentPage: "servers",
    livePage: "servers",
    liveSnapshot: createSnapshot({
      runs: trackingRunRepository.list(),
      sessions: trackingSessionRepository.listAll()
    })
  };
};

const buildRunsPageData = (guildId: string) => {
  const runs = filterRunsByGuild(guildId).map((run) => {
    const analyticsEnd = getRunAnalyticsEnd(run);
    const analytics = buildRunAnalytics(run.id, run.started_at, analyticsEnd);

    return {
      ...run,
      created_display: formatDateTime(run.created_at),
      scheduled_start_display: formatDateTime(run.scheduled_start),
      scheduled_end_display: formatDateTime(run.scheduled_end),
      started_display: formatDateTime(run.started_at),
      ended_display: formatDateTime(run.ended_at),
      total_channels: analytics.totalChannels,
      total_participants: analytics.totalParticipants,
      total_run_duration_seconds: getRunDurationSeconds(run.started_at, analyticsEnd),
      total_run_duration: analytics.totalRunDuration
    };
  });

  return {
    guildId,
    guildName: getGuildName(guildId),
    serverBasePath: `/servers/${guildId}`,
    runs,
    currentPage: "runs",
    livePage: "runs",
    liveSnapshot: createSnapshot({
      guildId,
      runs: filterRunsByGuild(guildId),
      sessions: filterSessionsByGuild(guildId)
    })
  };
};

const buildRunDetailPageData = (guildId: string, runId: number) => {
  const run = trackingRunRepository.findById(runId);
  if (!run || run.guild_id !== guildId) {
    return null;
  }

  const analyticsEnd = getRunAnalyticsEnd(run);
  const analytics = buildRunAnalytics(run.id, run.started_at, analyticsEnd);

  return {
    guildId,
    guildName: getGuildName(guildId),
    serverBasePath: `/servers/${guildId}`,
    currentPage: "runs",
    livePage: "run-detail",
    liveEntityId: String(run.id),
    liveSnapshot: createSnapshot({
      guildId,
      run,
      sessions: trackingSessionRepository.listByRun(run.id),
      registrations: registeredUserRepository.listByGuild(guildId)
    }),
    run: {
      ...run,
      created_display: formatDateTime(run.created_at),
      scheduled_start_display: formatDateTime(run.scheduled_start),
      scheduled_end_display: formatDateTime(run.scheduled_end),
      started_display: formatDateTime(run.started_at),
      ended_display: formatDateTime(run.ended_at),
      total_run_duration_seconds: getRunDurationSeconds(run.started_at, analyticsEnd)
    },
    analytics
  };
};

const buildUsersPageData = async (guildId: string) => {
  const users = buildUserAnalytics(guildId);
  const sessionsForGuild = filterSessionsByGuild(guildId);
  const guildMembers = await listKnownGuildMembers(guildId);

  const registrationMap = new Map(
    registeredUserRepository
      .listByGuild(guildId)
      .map((user) => [user.user_id, user])
  );
  const trackedUsers = new Map<
    string,
    { user_id: string; username: string; discord_username: string }
  >();

  for (const member of guildMembers) {
    trackedUsers.set(member.user_id, {
      user_id: member.user_id,
      username: member.server_username,
      discord_username: member.discord_username
    });
  }

  for (const session of sessionsForGuild) {
    trackedUsers.set(session.user_id, {
      user_id: session.user_id,
      username: trackedUsers.get(session.user_id)?.username ?? session.username,
      discord_username: trackedUsers.get(session.user_id)?.discord_username ?? session.username
    });
  }

  for (const registration of registrationMap.values()) {
    trackedUsers.set(registration.user_id, {
      user_id: registration.user_id,
      username: trackedUsers.get(registration.user_id)?.username ?? registration.username,
      discord_username: trackedUsers.get(registration.user_id)?.discord_username ?? registration.username
    });
  }

  const registrations = [...trackedUsers.values()]
    .map((user) => {
      const registration = registrationMap.get(user.user_id);
      return {
        guild_id: guildId,
        user_id: user.user_id,
        username: registration?.username ?? user.username,
        enrollment_no: registration?.enrollment_no ?? "Not registered",
        registered_display: formatDateTime(registration?.registered_at ?? null),
        updated_display: formatDateTime(registration?.updated_at ?? null)
      };
    })
    .sort((left, right) => left.username.localeCompare(right.username));

  const sessions = sessionsForGuild.map((session) => ({
    ...session,
    enrollment_no:
      registeredUserRepository.findByUserId(guildId, session.user_id)?.enrollment_no ?? "Not registered",
    joined_display: formatDateTime(session.joined_at),
    left_display: formatDateTime(session.left_at)
  }));

  return {
    guildId,
    guildName: getGuildName(guildId),
    serverBasePath: `/servers/${guildId}`,
    users,
    sessions,
    registrations,
    currentPage: "users",
    livePage: "users",
    liveSnapshot: createSnapshot({
      guildId,
      runs: filterRunsByGuild(guildId),
      registrations,
      sessions: sessionsForGuild
    })
  };
};

const buildUsersExportRows = async (guildId: string) => {
  const pageData = await buildUsersPageData(guildId);
  const analyticsByUserId = new Map(pageData.users.map((user) => [user.userId, user]));
  const knownMembers = await listKnownGuildMembers(guildId);
  const memberMap = new Map(knownMembers.map((member) => [member.user_id, member]));

  return pageData.registrations.map((registration) => {
    const analytics = analyticsByUserId.get(registration.user_id);
    const member = memberMap.get(registration.user_id);

    return {
      serverUsername: member?.server_username ?? registration.username,
      discordUsername: member?.discord_username ?? registration.username,
      userId: registration.user_id,
      enrollmentNo: registration.enrollment_no,
      status: registration.enrollment_no === "Not registered" ? "Unregistered" : "Registered",
      totalRunsJoined: analytics?.totalRunsJoined ?? 0,
      averagePercentage: analytics?.averagePercentage ?? "0.0%",
      totalDuration: analytics?.totalDuration ?? formatDuration(0),
      totalSessions: analytics?.totalSessions ?? 0,
      firstSeenDisplay: analytics?.firstSeenDisplay ?? "Not tracked",
      lastSeenDisplay: analytics?.lastSeenDisplay ?? "Not tracked"
    };
  });
};

const createWorkbookForUsers = async (guildId: string) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MUPC Attendance Bot";
  workbook.created = new Date();

  const guildName = getGuildName(guildId);
  const rows = await buildUsersExportRows(guildId);
  const sheet = workbook.addWorksheet(sanitizeWorksheetName(`${guildName} Users`));

  const header = [
    "Server Username",
    "Discord Username",
    "User ID",
    "Enrollment No",
    "Status",
    "Total Workshops Joined",
    "Average Percentage of Duration",
    "Total Duration (HH:MM:SS)",
    "Total Sessions",
    "First Seen",
    "Last Seen"
  ];

  sheet.addRow(header);

  for (const row of rows) {
    sheet.addRow([
      row.serverUsername,
      row.discordUsername,
      row.userId,
      row.enrollmentNo,
      row.status,
      row.totalRunsJoined,
      row.averagePercentage,
      row.totalDuration,
      row.totalSessions,
      row.firstSeenDisplay,
      row.lastSeenDisplay
    ]);
  }

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getColumn(3).numFmt = "@";

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    row.getCell(3).value = String(row.getCell(3).value ?? "");
  });

  autoFitWorksheetColumns(sheet);

  return workbook;
};

const requireGuildContext = (req: Request, res: Response) => {
  const guildId = String(req.params.guildId ?? "");
  const hasData =
    filterRunsByGuild(guildId).length > 0 ||
    filterSessionsByGuild(guildId).length > 0 ||
    registeredUserRepository.listByGuild(guildId).length > 0;
  if (!guildId || !hasData) {
    res.status(404).send("Server dashboard not found.");
    return null;
  }

  return guildId;
};

// Public health endpoint for Railway and other uptime checks.
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use(requireBasicAuth);

app.get("/", (req, res) => {
  res.render("servers", buildServerSelectionPageData());
});

app.get("/servers/:guildId", (req, res) => {
  const guildId = requireGuildContext(req, res);
  if (!guildId) {
    return;
  }

  res.render("index", buildRunsPageData(guildId));
});

app.get("/servers/:guildId/runs/:id", (req, res) => {
  const guildId = requireGuildContext(req, res);
  if (!guildId) {
    return;
  }

  const viewModel = buildRunDetailPageData(guildId, Number(req.params.id));
  if (!viewModel) {
    return res.status(404).send("Tracking run not found.");
  }

  res.render("run-detail", viewModel);
});

app.get("/servers/:guildId/users", (req, res) => {
  const guildId = requireGuildContext(req, res);
  if (!guildId) {
    return;
  }

  buildUsersPageData(guildId)
    .then((viewModel) => {
      res.render("users", viewModel);
    })
    .catch((error) => {
      res.status(500).send(error instanceof Error ? error.message : "Failed to load users dashboard.");
    });
});

app.get("/api/dashboard-snapshot", async (req, res) => {
  const page = String(req.query.page ?? "");
  const guildId = String(req.query.guildId ?? "");
  const entityId = req.query.id ? Number(req.query.id) : null;

  if (page === "servers") {
    return res.json({ snapshot: buildServerSelectionPageData().liveSnapshot });
  }

  if (page === "runs" && guildId) {
    return res.json({ snapshot: buildRunsPageData(guildId).liveSnapshot });
  }

  if (page === "run-detail" && guildId && entityId) {
    const viewModel = buildRunDetailPageData(guildId, entityId);
    if (!viewModel) {
      return res.status(404).json({ error: "Tracking run not found." });
    }

    return res.json({ snapshot: viewModel.liveSnapshot });
  }

  if (page === "users" && guildId) {
    const viewModel = await buildUsersPageData(guildId);
    return res.json({ snapshot: viewModel.liveSnapshot });
  }

  return res.status(400).json({ error: "Unknown dashboard page." });
});

const sendUsersWorkbook = async (guildId: string, res: Response) => {
  const workbook = await createWorkbookForUsers(guildId);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${guildId}-user-attendance.xlsx"`
  );

  await workbook.xlsx.write(res);
  res.end();
};

app.get("/servers/:guildId/users/export.csv", async (req, res) => {
  const guildId = requireGuildContext(req, res);
  if (!guildId) {
    return;
  }

  await sendUsersWorkbook(guildId, res);
});

app.get("/servers/:guildId/users/export.xlsx", async (req, res) => {
  const guildId = requireGuildContext(req, res);
  if (!guildId) {
    return;
  }

  await sendUsersWorkbook(guildId, res);
});

app.get("/servers/:guildId/runs/:id/export.xlsx", async (req, res) => {
  const guildId = requireGuildContext(req, res);
  if (!guildId) {
    return;
  }

  const result = await createWorkbookForRun(Number(req.params.id));
  if (!result || result.run.guild_id !== guildId) {
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
