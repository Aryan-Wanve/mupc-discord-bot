// Easter egg: If the club ever finds "Oneway" in the logs, Aryan definitely touched this file.
import {
  ChannelType,
  Client,
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
import { nowIso } from "./utils";

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
  state.member?.user.globalName ?? state.member?.user.username ?? state.id;

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

async function sendGuildLog(guildId: string, message: string) {
  const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return;
  }

  const channel = await ensureLogChannel(guild).catch(() => null);
  if (channel && channel.isTextBased()) {
    await channel.send(message).catch(() => undefined);
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
        username: member.user.globalName ?? member.user.username
      });
    }
  }
}

async function activateRun(runId: number) {
  const run = trackingRunRepository.findById(runId);
  if (!run) {
    throw new Error("Tracking run not found.");
  }

  const existingActive = trackingRunRepository.findActiveByGuild(run.guild_id);
  if (existingActive && existingActive.id !== run.id) {
    throw new Error("A tracking run is already active for this server.");
  }

  trackingRunRepository.markActive(run.id, nowIso());

  const guild = await discordClient.guilds.fetch(run.guild_id).catch(() => null);
  if (guild) {
    await guild.channels.fetch();
    syncRunAcrossGuild(run.id, guild);
    await sendGuildLog(
      guild.id,
      `MUPC workshop tracking started for **${run.title}**. Voice attendance is now being recorded across all voice channels.`
    );
  }
}

async function completeRun(runId: number, status = "completed") {
  const run = trackingRunRepository.findById(runId);
  if (!run) {
    throw new Error("Tracking run not found.");
  }

  trackingRunRepository.markCompleted(run.id, nowIso(), status);
  tracker.stopTrackingForRun(run.id);

  await sendGuildLog(
    run.guild_id,
    `MUPC workshop tracking stopped for **${run.title}**. Open the dashboard to download attendance exports and insights.`
  );
}

async function checkScheduledRuns() {
  const current = nowIso();

  for (const run of trackingRunRepository.listDueToStart(current)) {
    try {
      await activateRun(run.id);
    } catch (error) {
      trackingRunRepository.markCompleted(run.id, current, "failed");
      await sendGuildLog(
        run.guild_id,
        `Scheduled workshop tracking for **${run.title}** could not start: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  for (const run of trackingRunRepository.listDueToStop(current)) {
    await completeRun(run.id);
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
}

discordClient.once("ready", async () => {
  tracker.hydrateFromDatabase();

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

  await registerSlashCommands([...discordClient.guilds.cache.keys()]);
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

  await handleSlashCommand(interaction);
});

discordClient.on("voiceStateUpdate", async (oldState, newState) => {
  if (oldState.channelId === newState.channelId) {
    return;
  }

  await handleVoiceStateChange(oldState, newState);
});

export async function loginBot() {
  await discordClient.login(config.discordToken);
}

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
    `MUPC workshop tracking started for **${run.title}**. Voice attendance is now being recorded across all voice channels.`
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
  scheduledEnd: string;
}) {
  const run = trackingRunRepository.createScheduled(input);
  if (!run) {
    throw new Error("Failed to create the scheduled tracking session.");
  }

  await sendGuildLog(
    input.guildId,
    `Scheduled **${input.title}** for MUPC from **${input.scheduledStart}** to **${input.scheduledEnd}**.`
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
