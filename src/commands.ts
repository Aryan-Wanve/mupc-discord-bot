// Easter egg: This command board hides a tiny slate mark from Aryan, better known around edits as Oneway.
import {
  ChatInputCommandInteraction,
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import { config } from "./config";
import { registeredUserRepository } from "./db";
import {
  cancelScheduledTrackingForGuild,
  getTrackingStatusForGuild,
  scheduleTrackingStartOnlyForGuild,
  scheduleTrackingForGuild,
  sendRegistryLogForGuild,
  startTrackingForGuild,
  stopTrackingForGuild
} from "./bot";
import { formatScheduleWindow, IST_TIME_ZONE, parseTodayTime, parseTodayTimeRange } from "./utils";

const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether the bot is responding.")
  .setDefaultMemberPermissions(null);

const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Learn how to use the MUPC attendance bot and its commands.")
  .setDefaultMemberPermissions(null);

const registerCommand = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Register your enrollment number for MUPC workshop attendance exports.")
  .setDefaultMemberPermissions(null)
  .addStringOption((option) =>
    option
      .setName("enrollmentno")
      .setDescription("Your enrollment number")
      .setRequired(true)
      .setMaxLength(50)
  );

const deregisterCommand = new SlashCommandBuilder()
  .setName("deregister")
  .setDescription("Remove a member's registered enrollment number from this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption((option) =>
    option
      .setName("member")
      .setDescription("The member whose registration should be removed")
      .setRequired(true)
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
    subcommand
      .setName("schedule-start")
      .setDescription("Schedule only the workshop start time and stop it manually later.")
      .addStringOption((option) =>
        option.setName("title").setDescription("Title for the scheduled run").setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("start")
          .setDescription("Start time in 24-hour format, for example 08:00")
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("cancel")
      .setDescription("Cancel a scheduled MUPC workshop tracking run before it starts.")
      .addIntegerOption((option) =>
        option
          .setName("runid")
          .setDescription("The scheduled run ID shown in /tracking status")
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("status").setDescription("Show the active workshop and recent MUPC runs for this server.")
  );

const commands = [pingCommand, helpCommand, registerCommand, deregisterCommand, trackingCommand];

const privateResponse = { flags: MessageFlags.Ephemeral as const };

const isUnknownInteractionError = (error: unknown) =>
  error instanceof DiscordAPIError && error.code === 10062;

const canManageTracking = (interaction: ChatInputCommandInteraction) =>
  interaction.inCachedGuild() && Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

const normalizeEnrollmentNo = (value: string) => value.trim();

const buildEmbed = (input: {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}) =>
  new EmbedBuilder()
    .setColor(input.color ?? 0x62e6ff)
    .setTitle(input.title)
    .setDescription(input.description ?? null)
    .setFields(input.fields ?? [])
    .setTimestamp();

const ensureStaffAccess = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "Server Only Command",
          description: "This command can only be used inside a Discord server.",
          color: 0xff7a7a
        })
      ]
    });
    return false;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "Missing Permission",
          description: "You need the Manage Server permission to use MUPC tracking commands.",
          color: 0xff7a7a
        })
      ]
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

const getInteractionDisplayName = async (interaction: ChatInputCommandInteraction) => {
  if (interaction.inCachedGuild()) {
    return interaction.member.displayName;
  }

  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  return member?.displayName ?? interaction.user.globalName ?? interaction.user.username;
};

async function handleHelp(interaction: ChatInputCommandInteraction) {
  await interaction.editReply({
    embeds: canManageTracking(interaction)
      ? [
          buildEmbed({
            title: "MUPC Attendance Bot Help",
            description:
              "This bot tracks workshop attendance across voice channels and syncs records to the dashboard.",
            fields: [
              {
                name: "Member Command",
                value:
                  "`/register enrollmentno:<student enrollment number>`\nLinks a Discord user to an enrollment number for this server's exports."
              },
              {
                name: "Admin Commands",
                value:
                  "`/tracking start [title]`\nStart immediately.\n\n`/tracking stop`\nStop the active run.\n\n`/tracking schedule title:<name> start:<HH:mm> end:<HH:mm>`\nSchedule both start and stop.\n\n`/tracking schedule-start title:<name> start:<HH:mm>`\nSchedule only the start and stop it manually later.\n\n`/tracking cancel runid:<id>`\nCancel a scheduled run.\n\n`/tracking status`\nShow active and recent runs.\n\n`/deregister member:<user>`\nRemove a member's saved enrollment number.\n\n`/help`\nShow this guide.\n\n`/ping`\nCheck whether the bot is online."
              },
              {
                name: "Recommended Workflow",
                value:
                  "1. Ask members to use `/register` in the same server.\n2. Use `/tracking start` for immediate sessions, `/tracking schedule` for fixed windows, or `/tracking schedule-start` when the ending time is not fixed.\n3. Use `/tracking status` to confirm the run ID and state.\n4. Use `/tracking stop` when the workshop ends, or `/tracking cancel` if a scheduled run should not happen.\n5. Review the server-specific dashboard and exports."
                }
              ]
            })
        ]
      : [
          buildEmbed({
            title: "MUPC Attendance Bot Help",
            description: "This bot is used for workshop attendance in voice channels.",
            fields: [
              {
                name: "Commands You Need",
                value:
                  "`/register enrollmentno:<your enrollment number>`\nRegister for this server so your attendance is matched correctly.\n\n`/help`\nShows this guide."
              },
              {
                name: "How Attendance Works",
                value:
                  "Join the workshop voice channel in this server when the session starts and stay connected while it runs. A server admin handles starting, scheduling, and stopping attendance tracking."
              },
              {
                name: "If A Workshop Is Scheduled",
                value:
                  "You do not need to run anything special. Just join the correct voice channel in this server at the scheduled time and the bot will track attendance automatically. If the admin used a start-only schedule, tracking will begin automatically and end when they stop it."
              }
            ]
          })
        ]
  });
}

async function handleStart(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const title =
    interaction.options.getString("title") ??
    `MUPC Workshop ${new Date().toLocaleString("en-IN", {
      timeZone: IST_TIME_ZONE,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    })}`;

  const run = await startTrackingForGuild(interaction.guildId, title);
  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: "Tracking Started",
        description: "The bot is now recording attendance across all workshop voice channels.",
        color: 0x67f0aa,
        fields: [
          { name: "Run", value: `#${run.id}`, inline: true },
          { name: "Title", value: run.title, inline: true }
        ]
      })
    ]
  });
}

async function handleStop(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const run = await stopTrackingForGuild(interaction.guildId);
  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: "Tracking Stopped",
        description: "Attendance exports are ready in the dashboard.",
        color: 0xffb869,
        fields: [
          { name: "Run", value: `#${run.id}`, inline: true },
          { name: "Title", value: run.title, inline: true }
        ]
      })
    ]
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

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: "Workshop Scheduled",
        description: "The bot will start and stop automatically using your local time.",
        color: 0xffd85a,
        fields: [
          { name: "Run", value: `#${run.id}`, inline: true },
          { name: "Title", value: run.title, inline: true },
          {
            name: "Time Window",
            value: formatScheduleWindow(run.scheduled_start, run.scheduled_end)
          }
        ]
      })
    ]
  });
}

async function handleScheduleStart(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const title = interaction.options.getString("title", true);
  const start = interaction.options.getString("start", true);
  const schedule = parseTodayTime(start);

  const run = await scheduleTrackingStartOnlyForGuild({
    guildId: interaction.guildId,
    title,
    scheduledStart: schedule.startIso
  });

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: "Workshop Start Scheduled",
        description: "The bot will start automatically and keep running until you stop it manually.",
        color: 0xffd85a,
        fields: [
          { name: "Run", value: `#${run.id}`, inline: true },
          { name: "Title", value: run.title, inline: true },
          {
            name: "Start Time",
            value: formatScheduleWindow(run.scheduled_start, null)
          }
        ]
      })
    ]
  });
}

async function handleCancel(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const runId = interaction.options.getInteger("runid", true);
  const run = await cancelScheduledTrackingForGuild(interaction.guildId, runId);

  await interaction.editReply({
    embeds: [
      buildEmbed({
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
      })
    ]
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const status = getTrackingStatusForGuild(interaction.guildId);
  const activeSummary = status.activeRun
    ? `#${status.activeRun.id} • ${status.activeRun.title}\nStatus: ${status.activeRun.status}\nStarted: ${
        status.activeRun.started_at ?? "Not started"
      }\nScheduled: ${formatScheduleWindow(
        status.activeRun.scheduled_start,
        status.activeRun.scheduled_end
      )}`
    : "No active run right now.";
  const recentSummary =
    status.recentRuns.length === 0
      ? "No runs yet."
      : status.recentRuns
          .slice(0, 5)
          .map(
            (run) =>
              `#${run.id} • ${run.title}\nStatus: ${run.status}\nScheduled: ${formatScheduleWindow(
                run.scheduled_start,
                run.scheduled_end
              )}`
          )
          .join("\n\n");

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: "Tracking Status",
        fields: [
          { name: "Active Workshop", value: activeSummary },
          { name: "Recent Runs", value: recentSummary }
        ]
      })
    ]
  });
}

async function handleRegister(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const enrollmentNo = normalizeEnrollmentNo(interaction.options.getString("enrollmentno", true));
  const userId = interaction.user.id;
  const username = await getInteractionDisplayName(interaction);

  if (!enrollmentNo) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "Invalid Enrollment Number",
          description: "Please enter a non-empty enrollment number.",
          color: 0xff7a7a
        })
      ]
    });
    return;
  }

  const existingForUser = registeredUserRepository.findByUserId(interaction.guildId, userId);
  if (existingForUser) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "Already Registered",
          description: `You are already registered in this server with enrollment number **${existingForUser.enrollment_no}**.`,
          color: 0xffb869
        })
      ]
    });
    return;
  }

  const existingForEnrollment = registeredUserRepository.findByEnrollment(
    interaction.guildId,
    enrollmentNo
  );
  if (existingForEnrollment) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "Enrollment Number Unavailable",
          description: "That enrollment number is already registered to another Discord user in this server.",
          color: 0xff7a7a
        })
      ]
    });
    return;
  }

  const registered = registeredUserRepository.upsert({
    guildId: interaction.guildId,
    userId,
    username,
    enrollmentNo
  });

  await sendRegistryLogForGuild(interaction.guildId, {
    title: "Member Registered",
    description: "A server member saved or updated their enrollment number for attendance exports.",
    color: 0x67f0aa,
    fields: [
      { name: "User", value: `${username}\n<@${userId}>`, inline: true },
      { name: "Enrollment No", value: registered?.enrollment_no ?? enrollmentNo, inline: true }
    ]
  });

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: "Registration Complete",
        description: `Your enrollment number is now saved as **${registered?.enrollment_no ?? enrollmentNo}**.`,
        color: 0x67f0aa
      })
    ]
  });
}

async function handleDeregister(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const member = interaction.options.getUser("member", true);
  const existing = registeredUserRepository.findByUserId(interaction.guildId, member.id);

  if (!existing) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "Registration Not Found",
          description: "That member does not have a saved enrollment number in this server.",
          color: 0xffb869
        })
      ]
    });
    return;
  }

  registeredUserRepository.deleteByUserId(interaction.guildId, member.id);

  await sendRegistryLogForGuild(interaction.guildId, {
    title: "Member Deregistered",
    description: "A saved enrollment number was removed from the server registry.",
    color: 0xffb869,
    fields: [
      { name: "User", value: `${existing.username}\n<@${member.id}>`, inline: true },
      { name: "Enrollment No", value: existing.enrollment_no, inline: true },
      {
        name: "Removed By",
        value: `${await getInteractionDisplayName(interaction)}\n<@${interaction.user.id}>`,
        inline: true
      }
    ]
  });

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: "Member Deregistered",
        description: `Removed **${existing.enrollment_no}** for <@${member.id}> in this server.`,
        color: 0x67f0aa
      })
    ]
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
    await interaction.deferReply(privateResponse);

    if (interaction.commandName === "ping") {
      await interaction.editReply({
        embeds: [
          buildEmbed({
            title: "Pong",
            description: "The bot is online and slash commands are working.",
            color: 0x67f0aa
          })
        ]
      });
      return;
    }

    if (interaction.commandName === "help") {
      await handleHelp(interaction);
      return;
    }

    if (interaction.commandName === "register") {
      await handleRegister(interaction);
      return;
    }

    if (interaction.commandName === "deregister") {
      if (!(await ensureStaffAccess(interaction))) {
        return;
      }

      await handleDeregister(interaction);
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

    if (subcommand === "schedule-start") {
      await handleScheduleStart(interaction);
      return;
    }

    if (subcommand === "cancel") {
      await handleCancel(interaction);
      return;
    }

    await handleStatus(interaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong while handling the command.";

    if (isUnknownInteractionError(error)) {
      console.warn("Skipped responding because the Discord interaction was no longer valid.");
      return;
    }

    if (interaction.replied || interaction.deferred) {
      await interaction
        .editReply({
          embeds: [
            buildEmbed({
              title: "Command Failed",
              description: message,
              color: 0xff7a7a
            })
          ]
        })
        .catch((replyError) => {
        if (!isUnknownInteractionError(replyError)) {
          throw replyError;
        }
      });
      return;
    }

    await interaction
      .reply({
        embeds: [
          buildEmbed({
            title: "Command Failed",
            description: message,
            color: 0xff7a7a
          })
        ],
        ...privateResponse
      })
      .catch((replyError) => {
        if (!isUnknownInteractionError(replyError)) {
          throw replyError;
        }
      });
  }
}
