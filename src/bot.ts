// Easter egg: If the club ever finds "Oneway" in the logs, Aryan definitely touched this file.
import {
  ActivityType,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Guild,
  GuildBasedChannel,
  Interaction,
  PermissionFlagsBits,
  Partials,
  TextChannel,
  VoiceBasedChannel,
  VoiceState
} from "discord.js";
import { config } from "./config";
import { AttendanceTracker } from "./attendanceTracker";
import { trackingRunRepository } from "./db";
import { handleSlashCommand, registerSlashCommands } from "./commands";
import { formatScheduleWindow, nowIso } from "./utils";

const tracker = new AttendanceTracker();
const schedulerIntervalMs = 15_000;
const logChannelName = "attendance-logs";

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

const getDisplayName = (state: VoiceState) =>
  state.member?.displayName ??
  state.member?.user.globalName ??
  state.member?.user.username ??
  state.id;

function updateBotBio() {
  if (!discordClient.user) {
    return;
  }

  discordClient.user.setActivity(`${tracker.getTrackedUserCount()} users`, {
    type: ActivityType.Watching
  });
}

async function logGuildDiagnostics(guild: Guild) {
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) {
    console.warn(`[Guild Check] ${guild.name} (${guild.id}) -> Could not fetch bot member.`);
    return;
  }

  const permissions = me.permissions;
  const existingLogChannel = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === logChannelName
  );

  const canViewExistingLog =
    existingLogChannel?.isTextBased() && existingLogChannel.viewable ? "yes" : "no";
  const canSendExistingLog =
    existingLogChannel?.isTextBased() &&
    existingLogChannel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)
      ? "yes"
      : "no";

  console.log(
    [
      `[Guild Check] ${guild.name} (${guild.id})`,
      `admin=${permissions.has(PermissionFlagsBits.Administrator)}`,
      `manageChannels=${permissions.has(PermissionFlagsBits.ManageChannels)}`,
      `viewChannel=${permissions.has(PermissionFlagsBits.ViewChannel)}`,
      `sendMessages=${permissions.has(PermissionFlagsBits.SendMessages)}`,
      `voiceConnect=${permissions.has(PermissionFlagsBits.Connect)}`,
      `logChannel=${existingLogChannel ? existingLogChannel.name : "missing"}`,
      `logView=${canViewExistingLog}`,
      `logSend=${canSendExistingLog}`
    ].join(" | ")
  );
}

const isTrackableVoiceChannel = (channel: GuildBasedChannel | null): channel is VoiceBasedChannel =>
  Boolean(channel && channel.isVoiceBased());

async function ensureLogChannel(guild: Guild) {
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === logChannelName
  );

  if (existing?.isTextBased()) {
    return existing as TextChannel;
  }

  try {
    return await guild.channels.create({
      name: logChannelName,
      type: ChannelType.GuildText,
      topic: "MUPC workshop attendance logs, timing updates, and session notes."
    });
  } catch (error) {
    console.warn(
      `Could not create ${logChannelName} in guild ${guild.id}. ` +
        `${error instanceof Error ? error.message : "Unknown error"}`
    );
    return null;
  }
}

function buildLogEmbed(input: {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}) {
  return new EmbedBuilder()
    .setColor(input.color ?? 0x62e6ff)
    .setTitle(input.title)
    .setDescription(input.description ?? null)
    .setFields(input.fields ?? [])
    .setTimestamp();
}

async function sendGuildLog(
  guildId: string,
  input: {
    title: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }
) {
  const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return;
  }

  const channel = await ensureLogChannel(guild).catch(() => null);
  if (channel && channel.isTextBased()) {
    await channel.send({ embeds: [buildLogEmbed(input)] }).catch(() => undefined);
  }
}

function getTrackableChannels(guild: Guild) {
  return guild.channels.cache.filter(
    (channel) =>
      channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice
  );
}

function syncRunAcrossGuild(runId: number, guild: Guild) {
  for (const channel of getTrackableChannels(guild).values()) {
    if (!isTrackableVoiceChannel(channel)) {
      continue;
    }

    for (const [memberId, member] of channel.members) {
      tracker.startTracking({
        runId,
        guildId: guild.id,
        channelId: channel.id,
        channelName: channel.name,
        userId: memberId,
        username: member.displayName ?? member.user.globalName ?? member.user.username
      });
    }
  }

  updateBotBio();
}

async function activateRun(runId: number, startedAt = nowIso()) {
  const run = trackingRunRepository.findById(runId);
  if (!run) {
    throw new Error("Tracking run not found.");
  }

  const existingActive = trackingRunRepository.findActiveByGuild(run.guild_id);
  if (existingActive && existingActive.id !== run.id) {
    throw new Error("A tracking run is already active for this server.");
  }

  trackingRunRepository.markActive(run.id, startedAt);

  const guild = await discordClient.guilds.fetch(run.guild_id).catch(() => null);
  if (guild) {
    await guild.channels.fetch();
    syncRunAcrossGuild(run.id, guild);
    await sendGuildLog(
      guild.id,
      {
        title: "Tracking Started",
        description: "Voice attendance is now being recorded across all voice channels.",
        color: 0x67f0aa,
        fields: [
          { name: "Run", value: `#${run.id}`, inline: true },
          { name: "Title", value: run.title, inline: true }
        ]
      }
    );
  }
}

async function completeRun(runId: number, status = "completed", endedAt = nowIso()) {
  const run = trackingRunRepository.findById(runId);
  if (!run) {
    throw new Error("Tracking run not found.");
  }

  trackingRunRepository.markCompleted(run.id, endedAt, status);
  tracker.stopTrackingForRun(run.id);
  updateBotBio();

  await sendGuildLog(
    run.guild_id,
    {
      title: "Tracking Stopped",
      description: "Open the dashboard to download attendance exports and insights.",
      color: 0xffb869,
      fields: [
        { name: "Run", value: `#${run.id}`, inline: true },
        { name: "Title", value: run.title, inline: true }
      ]
    }
  );
}

async function checkScheduledRuns() {
  const current = nowIso();

  for (const run of trackingRunRepository.listDueToStart(current)) {
    try {
      await activateRun(run.id, run.scheduled_start ?? current);
    } catch (error) {
      trackingRunRepository.markCompleted(run.id, current, "failed");
      await sendGuildLog(
        run.guild_id,
        {
          title: "Scheduled Tracking Failed",
          description: error instanceof Error ? error.message : "Unknown error",
          color: 0xff7a7a,
          fields: [
            { name: "Run", value: `#${run.id}`, inline: true },
            { name: "Title", value: run.title, inline: true }
          ]
        }
      );
    }
  }

  for (const run of trackingRunRepository.listDueToStop(current)) {
    await completeRun(run.id, "completed", run.scheduled_end ?? current);
  }
}

async function handleVoiceStateChange(oldState: VoiceState, newState: VoiceState) {
  const guildId = newState.guild.id;
  const activeRun = trackingRunRepository.findActiveByGuild(guildId);
  if (!activeRun) {
    return;
  }

  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  const oldTrackable = isTrackableVoiceChannel(oldChannel) ? oldChannel : null;
  const newTrackable = isTrackableVoiceChannel(newChannel) ? newChannel : null;

  if (!oldTrackable && !newTrackable) {
    return;
  }

  tracker.switchChannel({
    runId: activeRun.id,
    guildId,
    userId: newState.id,
    username: getDisplayName(newState),
    oldChannelId: oldTrackable?.id,
    newChannelId: newTrackable?.id,
    newChannelName: newTrackable?.name ?? null
  });
  updateBotBio();
}

discordClient.once("clientReady", async () => {
  console.log(`[Discord] Client ready as ${discordClient.user?.tag ?? "unknown-user"}`);
  tracker.hydrateFromDatabase();
  updateBotBio();

  for (const guild of discordClient.guilds.cache.values()) {
    await guild.channels.fetch();
    await logGuildDiagnostics(guild);
    await ensureLogChannel(guild);
  }

  for (const run of trackingRunRepository.list().filter((item) => item.is_active === 1)) {
    const guild = discordClient.guilds.cache.get(run.guild_id);
    if (guild) {
      syncRunAcrossGuild(run.id, guild);
    }
  }

  console.log(`[Discord] Registering slash commands for ${discordClient.guilds.cache.size} guild(s).`);
  await registerSlashCommands([...discordClient.guilds.cache.keys()]);
  console.log("[Discord] Slash command registration complete.");
  void checkScheduledRuns();
  setInterval(() => {
    void checkScheduledRuns();
  }, schedulerIntervalMs);
  console.log(`Discord bot logged in as ${discordClient.user?.tag}`);
});

discordClient.on("guildCreate", async (guild) => {
  await guild.channels.fetch();
  await logGuildDiagnostics(guild);
  await ensureLogChannel(guild);
  await registerSlashCommands([guild.id]);
});

discordClient.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  console.log(
    `[Discord] Interaction received: /${interaction.commandName} in guild ${interaction.guildId ?? "dm"} from ${interaction.user.tag}`
  );

  try {
    await handleSlashCommand(interaction);
  } catch (error) {
    console.error("Unhandled slash command error:", error);
  }
});

discordClient.on("voiceStateUpdate", async (oldState, newState) => {
  if (oldState.channelId === newState.channelId) {
    return;
  }

  await handleVoiceStateChange(oldState, newState);
});

export async function loginBot() {
  console.log("[Discord] Starting bot login...");
  await discordClient.login(config.discordToken);
}

discordClient.on("error", (error) => {
  console.error("[Discord] Client error:", error);
});

discordClient.on("warn", (message) => {
  console.warn("[Discord] Warning:", message);
});

discordClient.on("shardError", (error) => {
  console.error("[Discord] Shard error:", error);
});

discordClient.on("shardDisconnect", (event, shardId) => {
  console.warn(`[Discord] Shard ${shardId} disconnected with code ${event.code}.`);
});

discordClient.on("shardResume", (shardId, replayedEvents) => {
  console.log(`[Discord] Shard ${shardId} resumed. Replayed ${replayedEvents} events.`);
});

export async function startTrackingForGuild(guildId: string, title: string) {
  const activeRun = trackingRunRepository.findActiveByGuild(guildId);
  if (activeRun) {
    throw new Error("A tracking session is already active for this server.");
  }

  const run = trackingRunRepository.createManual({
    title,
    guildId,
    startedAt: nowIso()
  });

  if (!run) {
    throw new Error("Failed to create the tracking session.");
  }

  const guild = await discordClient.guilds.fetch(guildId);
  await guild.channels.fetch();
  syncRunAcrossGuild(run.id, guild);
  await sendGuildLog(
    guildId,
    {
      title: "Tracking Started",
      description: "Voice attendance is now being recorded across all voice channels.",
      color: 0x67f0aa,
      fields: [
        { name: "Run", value: `#${run.id}`, inline: true },
        { name: "Title", value: run.title, inline: true }
      ]
    }
  );

  return run;
}

export async function stopTrackingForGuild(guildId: string) {
  const activeRun = trackingRunRepository.findActiveByGuild(guildId);
  if (!activeRun) {
    throw new Error("There is no active tracking session for this server.");
  }

  await completeRun(activeRun.id);
  return activeRun;
}

export async function scheduleTrackingForGuild(input: {
  guildId: string;
  title: string;
  scheduledStart: string;
  scheduledEnd: string | null;
}) {
  const run = trackingRunRepository.createScheduled(input);
  if (!run) {
    throw new Error("Failed to create the scheduled tracking session.");
  }

  await sendGuildLog(
    input.guildId,
    {
      title: "Workshop Scheduled",
      color: 0xffd85a,
      fields: [
        { name: "Title", value: input.title },
        {
          name: "Time Window",
          value: formatScheduleWindow(input.scheduledStart, input.scheduledEnd)
        }
      ]
    }
  );

  return run;
}

export async function scheduleTrackingStartOnlyForGuild(input: {
  guildId: string;
  title: string;
  scheduledStart: string;
}) {
  const run = trackingRunRepository.createScheduled({
    guildId: input.guildId,
    title: input.title,
    scheduledStart: input.scheduledStart,
    scheduledEnd: null
  });
  if (!run) {
    throw new Error("Failed to create the scheduled tracking session.");
  }

  await sendGuildLog(input.guildId, {
    title: "Workshop Start Scheduled",
    description: "This run will start automatically and stay active until you stop it manually.",
    color: 0xffd85a,
    fields: [
      { name: "Title", value: input.title },
      {
        name: "Start Time",
        value: formatScheduleWindow(input.scheduledStart, null)
      }
    ]
  });

  return run;
}

export async function cancelScheduledTrackingForGuild(guildId: string, runId: number) {
  const run = trackingRunRepository.findById(runId);
  if (!run || run.guild_id !== guildId) {
    throw new Error("Scheduled tracking run not found for this server.");
  }

  if (run.is_active || run.status === "active") {
    throw new Error("That run is already active. Use /tracking stop instead.");
  }

  if (run.status !== "scheduled") {
    throw new Error("Only scheduled runs can be cancelled.");
  }

  const deleted = trackingRunRepository.deleteScheduled(runId, guildId);
  if (!deleted) {
    throw new Error("Failed to cancel the scheduled run.");
  }

  await sendGuildLog(
    guildId,
    {
      title: "Scheduled Run Cancelled",
      color: 0xffb869,
      fields: [
        { name: "Run", value: `#${run.id}`, inline: true },
        { name: "Title", value: run.title, inline: true },
        {
          name: "Time Window",
          value: formatScheduleWindow(run.scheduled_start, run.scheduled_end)
        }
      ]
    }
  );

  return run;
}

export function getTrackingStatusForGuild(guildId: string) {
  const activeRun = trackingRunRepository.findActiveByGuild(guildId);
  const runs = trackingRunRepository.listByGuild(guildId).slice(0, 10);

  return {
    activeRun,
    recentRuns: runs
  };
}
