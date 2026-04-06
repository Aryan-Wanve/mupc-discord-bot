// Easter egg: This command board hides a tiny slate mark from Aryan, better known around edits as Oneway.
import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import { config } from "./config";
import { registeredUserRepository } from "./db";
import {
  getTrackingStatusForGuild,
  scheduleTrackingForGuild,
  startTrackingForGuild,
  stopTrackingForGuild
} from "./bot";
import { parseTodayTimeRange } from "./utils";

const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether the bot is responding.");

const registerCommand = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Register your enrollment number for MUPC workshop attendance exports.")
  .addStringOption((option) =>
    option
      .setName("enrollmentno")
      .setDescription("Your enrollment number")
      .setRequired(true)
      .setMaxLength(50)
  );

const trackingCommand = new SlashCommandBuilder()
  .setName("tracking")
  .setDescription("Start, stop, or schedule MUPC workshop voice tracking.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("Start tracking all voice channels for the current MUPC workshop.")
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Optional title for this tracking run")
          .setRequired(false)
          .setMaxLength(100)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stop")
      .setDescription("Stop the currently active MUPC workshop tracking run.")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("schedule")
      .setDescription("Schedule automatic workshop tracking using HH:mm time.")
      .addStringOption((option) =>
        option.setName("title").setDescription("Title for the scheduled run").setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("start")
          .setDescription("Start time in 24-hour format, for example 08:00")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("end")
          .setDescription("End time in 24-hour format, for example 09:00")
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("status").setDescription("Show the active workshop and recent MUPC runs for this server.")
  );

const commands = [pingCommand, registerCommand, trackingCommand];

const ensureStaffAccess = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: "This command can only be used inside a Discord server.",
      ephemeral: true
    });
    return false;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "You need the Manage Server permission to use MUPC tracking commands.",
      ephemeral: true
    });
    return false;
  }

  return true;
};

const describeRun = (run: {
  id: number;
  title: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
}) =>
  [
    `#${run.id} - ${run.title}`,
    `Status: ${run.status}`,
    `Started: ${run.started_at ?? "Not started"}`,
    `Ended: ${run.ended_at ?? "Not ended"}`,
    `Scheduled: ${run.scheduled_start ?? "Not scheduled"} -> ${run.scheduled_end ?? "Not scheduled"}`
  ].join("\n");

async function handleStart(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const title =
    interaction.options.getString("title") ??
    `MUPC Workshop ${new Date().toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    })}`;

  const run = await startTrackingForGuild(interaction.guildId, title);
  await interaction.reply({
    content:
      `Started MUPC tracking run #${run.id} (${run.title}). ` +
      "The bot is now recording attendance across all workshop voice channels.",
    ephemeral: true
  });
}

async function handleStop(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const run = await stopTrackingForGuild(interaction.guildId);
  await interaction.reply({
    content: `Stopped MUPC tracking run #${run.id} (${run.title}). Attendance exports are ready in the dashboard.`,
    ephemeral: true
  });
}

async function handleSchedule(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const title = interaction.options.getString("title", true);
  const start = interaction.options.getString("start", true);
  const end = interaction.options.getString("end", true);
  const range = parseTodayTimeRange(start, end);

  const run = await scheduleTrackingForGuild({
    guildId: interaction.guildId,
    title,
    scheduledStart: range.startIso,
    scheduledEnd: range.endIso
  });

  await interaction.reply({
    content:
      `Scheduled MUPC workshop #${run.id} (${run.title}) from ${start} to ${end}. ` +
      "The bot will start and stop automatically using the machine's local time.",
    ephemeral: true
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const status = getTrackingStatusForGuild(interaction.guildId);
  const lines: string[] = [];

  if (status.activeRun) {
    lines.push("Active workshop:");
    lines.push(describeRun(status.activeRun));
  } else {
    lines.push("Active run:");
    lines.push("None");
  }

  lines.push("");
    lines.push("Recent workshops:");

  if (status.recentRuns.length === 0) {
    lines.push("No runs yet.");
  } else {
    lines.push(...status.recentRuns.slice(0, 5).map(describeRun));
  }

  await interaction.reply({
    content: lines.join("\n"),
    ephemeral: true
  });
}

async function handleRegister(interaction: ChatInputCommandInteraction) {
  const enrollmentNo = interaction.options.getString("enrollmentno", true).trim();
  const userId = interaction.user.id;
  const username = interaction.user.globalName ?? interaction.user.username;

  const existingForUser = registeredUserRepository.findByUserId(userId);
  if (existingForUser) {
    await interaction.reply({
      content:
        `You are already registered with enrollment number **${existingForUser.enrollment_no}**.`,
      ephemeral: true
    });
    return;
  }

  const existingForEnrollment = registeredUserRepository.findByEnrollment(enrollmentNo);
  if (existingForEnrollment) {
    await interaction.reply({
      content: "That enrollment number is already registered to another Discord user.",
      ephemeral: true
    });
    return;
  }

  const registered = registeredUserRepository.upsert({
    userId,
    username,
    enrollmentNo
  });

  await interaction.reply({
    content:
      `Registered successfully. Your enrollment number is now saved as **${registered?.enrollment_no ?? enrollmentNo}**.`,
    ephemeral: true
  });
}

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
  try {
    if (interaction.commandName === "ping") {
      await interaction.reply({
        content: "Pong! The bot is online and slash commands are working.",
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "register") {
      await handleRegister(interaction);
      return;
    }

    if (interaction.commandName !== "tracking") {
      return;
    }

    if (!(await ensureStaffAccess(interaction))) {
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === "start") {
      await handleStart(interaction);
      return;
    }

    if (subcommand === "stop") {
      await handleStop(interaction);
      return;
    }

    if (subcommand === "schedule") {
      await handleSchedule(interaction);
      return;
    }

    await handleStatus(interaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong while handling the command.";

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
      return;
    }

    await interaction.reply({ content: message, ephemeral: true });
  }
}
