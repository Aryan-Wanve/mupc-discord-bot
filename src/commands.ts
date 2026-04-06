import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import { config } from "./config";
import { attendanceRepository, webinarRepository } from "./db";
import { startWebinarTracking, stopWebinarTracking } from "./bot";
import { formatDuration } from "./utils";

const webinarCommand = new SlashCommandBuilder()
  .setName("webinar")
  .setDescription("Manage webinar attendance tracking.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a webinar for a voice or stage channel.")
      .addStringOption((option) =>
        option.setName("title").setDescription("Webinar title").setRequired(true).setMaxLength(100)
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Voice channel to track")
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("notes").setDescription("Optional notes for the webinar").setRequired(false)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("Start attendance tracking for a webinar.")
      .addIntegerOption((option) =>
        option.setName("id").setDescription("Webinar ID from /webinar list").setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stop")
      .setDescription("Stop attendance tracking for a webinar.")
      .addIntegerOption((option) =>
        option.setName("id").setDescription("Webinar ID from /webinar list").setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("List recent webinars for this server.")
  );

const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether the bot is responding.");

const commands = [pingCommand, webinarCommand];

const ensureAdminAccess = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: "This command can only be used inside a Discord server.",
      ephemeral: true
    });
    return false;
  }

  const memberPermissions = interaction.memberPermissions;
  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "Only server administrators can use webinar commands right now.",
      ephemeral: true
    });
    return false;
  }

  return true;
};

const formatWebinarStatus = (isActive: number, startedAt: string | null, endedAt: string | null) => {
  if (isActive) {
    return "Live";
  }

  if (startedAt && endedAt) {
    return "Stopped";
  }

  return "Draft";
};

const handleCreate = async (interaction: ChatInputCommandInteraction) => {
  const title = interaction.options.getString("title", true);
  const channel = interaction.options.getChannel("channel", true);
  const notes = interaction.options.getString("notes") ?? undefined;

  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const result = webinarRepository.create({
    title,
    guildId: interaction.guildId,
    channelId: channel.id,
    notes
  });

  await interaction.reply({
    content: `Created webinar #${result.lastInsertRowid} for ${channel.toString()}. Open the dashboard to export the CSV later.`,
    ephemeral: true
  });
};

const handleStart = async (interaction: ChatInputCommandInteraction) => {
  const webinarId = interaction.options.getInteger("id", true);
  const webinar = webinarRepository.findById(webinarId);

  if (!interaction.guildId || !webinar || webinar.guild_id !== interaction.guildId) {
    await interaction.reply({
      content: "That webinar ID was not found for this server.",
      ephemeral: true
    });
    return;
  }

  await startWebinarTracking(webinarId);
  await interaction.reply({
    content: `Attendance tracking started for webinar #${webinar.id} (${webinar.title}).`,
    ephemeral: true
  });
};

const handleStop = async (interaction: ChatInputCommandInteraction) => {
  const webinarId = interaction.options.getInteger("id", true);
  const webinar = webinarRepository.findById(webinarId);

  if (!interaction.guildId || !webinar || webinar.guild_id !== interaction.guildId) {
    await interaction.reply({
      content: "That webinar ID was not found for this server.",
      ephemeral: true
    });
    return;
  }

  stopWebinarTracking(webinarId);

  const report = attendanceRepository.reportByWebinar(webinarId);
  const trackedUsers = report.length;
  const totalTime = report.reduce((sum, row) => sum + row.total_seconds, 0);

  await interaction.reply({
    content:
      `Stopped webinar #${webinar.id} (${webinar.title}). ` +
      `Tracked ${trackedUsers} participant(s) for a combined ${formatDuration(totalTime)}.`,
    ephemeral: true
  });
};

const handleList = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const webinars = webinarRepository.listByGuild(interaction.guildId).slice(0, 10);
  if (webinars.length === 0) {
    await interaction.reply({
      content: "No webinars exist for this server yet. Use `/webinar create` first.",
      ephemeral: true
    });
    return;
  }

  const lines = webinars.map((webinar) => {
    const report = attendanceRepository.reportByWebinar(webinar.id);
    const attendeeCount = report.length;

    return [
      `#${webinar.id} • ${webinar.title}`,
      `Status: ${formatWebinarStatus(webinar.is_active, webinar.started_at, webinar.ended_at)}`,
      `Channel: ${webinar.channel_id}`,
      `Attendees tracked: ${attendeeCount}`
    ].join("\n");
  });

  await interaction.reply({
    content: lines.join("\n\n"),
    ephemeral: true
  });
};

export async function registerSlashCommands(guildIds: string[]) {
  if (guildIds.length === 0) {
    return;
  }

  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const body = commands.map((command) => command.toJSON());

  await Promise.all(
    guildIds.map((guildId) =>
      rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body })
    )
  );
}

export async function handleSlashCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ping") {
    await interaction.reply({
      content: "Pong! The bot is online and slash commands are working.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName !== "webinar") {
    return;
  }

  if (!(await ensureAdminAccess(interaction))) {
    return;
  }

  try {
    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === "create") {
      await handleCreate(interaction);
      return;
    }

    if (subcommand === "start") {
      await handleStart(interaction);
      return;
    }

    if (subcommand === "stop") {
      await handleStop(interaction);
      return;
    }

    await handleList(interaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong while handling the command.";

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
      return;
    }

    await interaction.reply({ content: message, ephemeral: true });
  }
}
