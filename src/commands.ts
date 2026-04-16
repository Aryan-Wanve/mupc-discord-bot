// Easter egg: This command board hides a tiny slate mark from Aryan, better known around edits as Oneway.
import {
  ChatInputCommandInteraction,
  DiscordAPIError,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import { config } from "./config";
import { registeredUserRepository } from "./db";
import {
  addRegisteredRoleForMember,
  cancelScheduledTrackingForGuild,
  getTrackingStatusForGuild,
  removeRegisteredRoleForMember,
  scheduleTrackingStartOnlyForGuild,
  scheduleTrackingForGuild,
  sendDirectMessage,
  sendRegistryLogForGuild,
  startTrackingForGuild,
  stopTrackingForGuild
} from "./bot";
import {
  formatStudentDisplayName,
  getStudentNameForEnrollment,
  isEnrollmentMatched,
  loadStudentNameLookup,
  normalizeEnrollmentNo
} from "./studentData";
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
  .setDescription("Remove registration data from this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("member")
      .setDescription("Remove one member's saved enrollment number.")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member whose registration should be removed")
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("mismatched")
      .setDescription("Remove every registered enrollment number that does not match student data.")
  );

const renameCommand = new SlashCommandBuilder()
  .setName("rename")
  .setDescription("Rename registered members using student data.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("registered")
      .setDescription("Rename eligible registered members to their student names.")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("update")
      .setDescription("Refresh registered member nicknames to the latest formatting.")
  );

const showCommand = new SlashCommandBuilder()
  .setName("show")
  .setDescription("Show admin views related to registrations and tracking.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("mismatched")
      .setDescription("Show members whose registered enrollment numbers do not match student data.")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("registered-role")
      .setDescription("Show registered members missing the registered role and likely reasons.")
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

const commands = [
  pingCommand,
  helpCommand,
  registerCommand,
  deregisterCommand,
  renameCommand,
  showCommand,
  trackingCommand
];

const privateResponse = { flags: MessageFlags.Ephemeral as const };

const isUnknownInteractionError = (error: unknown) =>
  error instanceof DiscordAPIError && error.code === 10062;

const canManageTracking = (interaction: ChatInputCommandInteraction) =>
  interaction.inCachedGuild() && Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

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

const exampleEnrollmentNo = "EN24CS3010238";

const buildMismatchReason = (enrollmentNo: string) =>
  `No student-data match was found for **${enrollmentNo}**.`;

const buildReregisterInstructions = () =>
  [
    "Your previous registration was removed because the enrollment number could not be matched with the current student data used for attendance exports.",
    "Please register again using your correct enrollment number.",
    `Example format: \`/register enrollmentno:${exampleEnrollmentNo}\``
  ].join("\n\n");

const getMismatchedRegistrations = async (guildId: string) => {
  const studentNamesByEnrollment = await loadStudentNameLookup();
  return registeredUserRepository
    .listByGuild(guildId)
    .filter((registration) => !isEnrollmentMatched(registration.enrollment_no, studentNamesByEnrollment))
    .map((registration) => ({
      ...registration,
      studentName: getStudentNameForEnrollment(registration.enrollment_no, studentNamesByEnrollment),
      mismatchReason: buildMismatchReason(registration.enrollment_no)
    }));
};

const getGuildMemberMap = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    return new Map<string, GuildMember>();
  }

  const members = await interaction.guild.members.fetch().catch(() => null);
  return new Map((members ? [...members.values()] : []).map((member) => [member.id, member]));
};

const memberRoleName = "member";
const registeredRoleName = "registered";

const getNonEveryoneRoleNames = (member: GuildMember) =>
  member.roles.cache
    .filter((role) => role.id !== member.guild.roles.everyone.id)
    .map((role) => role.name.toLowerCase());

const isEligibleForRegisteredRename = (member: GuildMember) => {
  const roleNames = getNonEveryoneRoleNames(member);
  return roleNames.length === 0 || (roleNames.length === 1 && roleNames[0] === memberRoleName);
};

const normalizeNicknameValue = (value: string) => value.trim().replace(/\s+/g, " ");

const needsRegisteredNameRefresh = (currentName: string, targetName: string) => {
  const normalizedCurrent = normalizeNicknameValue(currentName);
  const normalizedTarget = normalizeNicknameValue(targetName);

  if (currentName !== normalizedCurrent || targetName !== normalizedTarget) {
    return true;
  }

  if (normalizedCurrent !== normalizedTarget) {
    return true;
  }

  return formatStudentDisplayName(normalizedCurrent) !== normalizedTarget;
};

const canRefreshLegacyRegisteredFormatting = (currentName: string, targetName: string) => {
  const normalizedCurrent = normalizeNicknameValue(currentName);
  const normalizedTarget = normalizeNicknameValue(targetName);

  return (
    normalizedCurrent.length > 0 &&
    normalizedCurrent.toLowerCase() === normalizedTarget.toLowerCase() &&
    normalizedCurrent !== normalizedTarget
  );
};

const sendMismatchDm = async (
  member: GuildMember | null,
  enrollmentNo: string
) => {
  if (!member) {
    return false;
  }

  return sendDirectMessage(member.user, {
    title: "Registration Removed",
    description: buildReregisterInstructions(),
    color: 0xffb869,
    fields: [
      { name: "Removed Enrollment No", value: enrollmentNo, inline: true },
      { name: "Why", value: "It could not be matched with existing student data.", inline: true }
    ]
  });
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
                  "`/tracking start [title]`\nStart immediately.\n\n`/tracking stop`\nStop the active run.\n\n`/tracking schedule title:<name> start:<HH:mm> end:<HH:mm>`\nSchedule both start and stop.\n\n`/tracking schedule-start title:<name> start:<HH:mm>`\nSchedule only the start and stop it manually later.\n\n`/tracking cancel runid:<id>`\nCancel a scheduled run.\n\n`/tracking status`\nShow active and recent runs.\n\n`/show mismatched`\nList members whose enrollment numbers do not match student data.\n\n`/show registered-role`\nAudit who is registered but missing the `registered` role.\n\n`/deregister member user:<user>`\nRemove one member's saved enrollment number.\n\n`/deregister mismatched`\nBulk-remove mismatched registrations and DM those members.\n\n`/rename registered`\nRename eligible registered members to their student names.\n\n`/rename update`\nRefresh old registered nicknames to the latest formatting.\n\n`/help`\nShow this guide.\n\n`/ping`\nCheck whether the bot is online."
              },
              {
                name: "Recommended Workflow",
                value:
                  "1. Ask members to use `/register` in the same server.\n2. Review `/show mismatched` if enrollment cleanup is needed.\n3. Review `/show registered-role` if some registered users are missing the `registered` role.\n4. Use `/deregister mismatched` to remove bad registrations when needed.\n5. Use `/rename registered` for normal eligible nickname sync, and `/rename update` to clean old all-caps or messy formatting.\n6. Use `/tracking start` for immediate sessions, `/tracking schedule` for fixed windows, or `/tracking schedule-start` when the ending time is not fixed.\n7. Use `/tracking status` to confirm the run ID and state.\n8. Use `/tracking stop` when the workshop ends, or `/tracking cancel` if a scheduled run should not happen.\n9. Review the server-specific dashboard and exports."
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
                  "`/register enrollmentno:<your enrollment number>`\nRegister for this server so your attendance is matched correctly.\n\nFormat example: `EN24CS3010238`\n\n`/help`\nShows this guide."
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
  const studentNamesByEnrollment = await loadStudentNameLookup();
  const matched = isEnrollmentMatched(enrollmentNo, studentNamesByEnrollment);
  const matchedStudentName = matched
    ? getStudentNameForEnrollment(enrollmentNo, studentNamesByEnrollment)
    : null;
  const roleAssigned = await addRegisteredRoleForMember(interaction.guildId, userId);
  const roleNoticeField = roleAssigned
    ? []
    : [
        {
          name: "Role Notice",
          value:
            "Your registration was saved, but I could not assign the `registered` role. Please check the bot's Manage Roles permission and role hierarchy."
        }
      ];

  await sendRegistryLogForGuild(interaction.guildId, {
    title: "Member Registered",
    description: "A server member saved or updated their enrollment number for attendance exports.",
    color: 0x67f0aa,
    fields: [
      { name: "User", value: `${username}\n<@${userId}>`, inline: true },
      { name: "Enrollment No", value: registered?.enrollment_no ?? enrollmentNo, inline: true },
      { name: "Registered Role", value: roleAssigned ? "Assigned" : "Could not assign", inline: true }
    ]
  });

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: matched ? "Registration Complete" : "Registration Saved With Warning",
        description: matched
          ? `Your enrollment number is now saved as **${registered?.enrollment_no ?? enrollmentNo}**.`
          : `Your enrollment number is saved as **${registered?.enrollment_no ?? enrollmentNo}**, but it does not match the current student data yet. Please double-check the format.`,
        color: matched ? 0x67f0aa : 0xffd85a,
        fields: matched
          ? [
              {
                name: "Matched Student Name",
                value: `According to the student data, your name is **${matchedStudentName}**.`
              },
              ...roleNoticeField
            ]
          : [
              {
                name: "Correct Format Example",
                value: `/register enrollmentno:${exampleEnrollmentNo}`
              },
              ...roleNoticeField
            ]
      })
    ]
  });
}

async function handleDeregisterMember(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const member = interaction.options.getUser("user", true);
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
  const removedRole = await removeRegisteredRoleForMember(interaction.guildId, member.id);

  await sendRegistryLogForGuild(interaction.guildId, {
    title: "Member Deregistered",
    description: "A saved enrollment number was removed from the server registry.",
    color: 0xffb869,
    fields: [
      { name: "User", value: `${existing.username}\n<@${member.id}>`, inline: true },
      { name: "Enrollment No", value: existing.enrollment_no, inline: true },
      { name: "Registered Role", value: removedRole ? "Removed" : "Could not remove", inline: true },
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

async function handleDeregisterMismatched(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const mismatched = await getMismatchedRegistrations(interaction.guildId);
  if (mismatched.length === 0) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "No Mismatched Registrations",
          description: "Every saved enrollment number currently matches the student data for this server.",
          color: 0x67f0aa
        })
      ]
    });
    return;
  }

  const memberMap = await getGuildMemberMap(interaction);
  const removedCount = registeredUserRepository.deleteManyByUserIds(
    interaction.guildId,
    mismatched.map((entry) => entry.user_id)
  );

  let dmSentCount = 0;
  let dmFailedCount = 0;
  let roleRemovedCount = 0;
  let roleRemoveFailedCount = 0;

  for (const entry of mismatched) {
    const member = memberMap.get(entry.user_id) ?? null;
    const sent = await sendMismatchDm(member, entry.enrollment_no);
    if (sent) {
      dmSentCount += 1;
    } else {
      dmFailedCount += 1;
    }

    const removedRole = await removeRegisteredRoleForMember(interaction.guildId, entry.user_id);
    if (removedRole) {
      roleRemovedCount += 1;
    } else {
      roleRemoveFailedCount += 1;
    }
  }

  await sendRegistryLogForGuild(interaction.guildId, {
    title: "Mismatched Registrations Deregistered",
    description: "Bulk cleanup removed registrations that could not be matched with current student data.",
    color: 0xffb869,
    fields: [
      { name: "Removed", value: String(removedCount), inline: true },
      { name: "DM Sent", value: String(dmSentCount), inline: true },
      { name: "DM Failed", value: String(dmFailedCount), inline: true },
      { name: "Role Removed", value: String(roleRemovedCount), inline: true },
      { name: "Role Remove Failed", value: String(roleRemoveFailedCount), inline: true },
      {
        name: "Examples",
        value: mismatched
          .slice(0, 5)
          .map((entry) => `${entry.username} - ${entry.enrollment_no}`)
          .join("\n")
      }
    ]
  });

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: "Mismatched Members Deregistered",
        description:
          "Removed all registrations that could not be matched with the student data used for exports.",
        color: 0xffb869,
        fields: [
          { name: "Removed", value: String(removedCount), inline: true },
          { name: "DM Sent", value: String(dmSentCount), inline: true },
          { name: "DM Failed", value: String(dmFailedCount), inline: true },
          { name: "Role Removed", value: String(roleRemovedCount), inline: true },
          { name: "Role Remove Failed", value: String(roleRemoveFailedCount), inline: true },
          {
            name: "Re-register Example",
            value: `/register enrollmentno:${exampleEnrollmentNo}`
          }
        ]
      })
    ]
  });
}

async function handleShowMismatched(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    throw new Error("This command must be used inside a server.");
  }

  const mismatched = await getMismatchedRegistrations(interaction.guildId);
  if (mismatched.length === 0) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "No Mismatched Registrations",
          description: "Every saved enrollment number currently matches the student data for this server.",
          color: 0x67f0aa
        })
      ]
    });
    return;
  }

  const chunks: typeof mismatched[] = [];
  for (let index = 0; index < mismatched.length; index += 6) {
    chunks.push(mismatched.slice(index, index + 6));
  }

  await interaction.editReply({
    embeds: chunks.slice(0, 4).map((chunk, chunkIndex) =>
      buildEmbed({
        title: chunkIndex === 0 ? "Mismatched Registrations" : `Mismatched Registrations (${chunkIndex + 1})`,
        description:
          chunkIndex === 0
            ? "These members are registered, but their enrollment numbers could not be matched with student data."
            : undefined,
        color: 0xffd85a,
        fields: chunk.map((entry) => ({
          name: `${entry.username} (${entry.enrollment_no})`,
          value: `${entry.mismatchReason}\n<@${entry.user_id}>`,
          inline: false
        }))
      })
    )
  });
}

async function handleShowRegisteredRole(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.inCachedGuild()) {
    throw new Error("This command must be used inside a server.");
  }

  await interaction.guild.roles.fetch().catch(() => undefined);
  const registrations = registeredUserRepository.listByGuild(interaction.guildId);
  const memberMap = await getGuildMemberMap(interaction);
  const botMember = await interaction.guild.members.fetchMe().catch(() => null);
  const registeredRole = interaction.guild.roles.cache.find(
    (role) =>
      role.id !== interaction.guild.roles.everyone.id &&
      role.name.toLowerCase() === registeredRoleName
  );
  const hasManageRoles = Boolean(botMember?.permissions.has(PermissionFlagsBits.ManageRoles));
  const botHighestRolePosition = botMember?.roles.highest.position ?? -1;
  const canManageRegisteredRole = Boolean(
    registeredRole && botMember && registeredRole.position < botHighestRolePosition
  );

  const issues: Array<{
    userId: string;
    username: string;
    enrollmentNo: string;
    reason: string;
    roleSummary: string;
  }> = [];
  let assignedCount = 0;
  let missingMemberCount = 0;

  for (const registration of registrations) {
    const member = memberMap.get(registration.user_id);
    if (!member) {
      missingMemberCount += 1;
      issues.push({
        userId: registration.user_id,
        username: registration.username,
        enrollmentNo: registration.enrollment_no,
        reason: "The user is registered in the database but is no longer in this server.",
        roleSummary: "Not in server"
      });
      continue;
    }

    if (registeredRole && member.roles.cache.has(registeredRole.id)) {
      assignedCount += 1;
      continue;
    }

    const visibleRoles = member.roles.cache
      .filter((role) => role.id !== member.guild.roles.everyone.id)
      .map((role) => role.name)
      .slice(0, 5);
    const roleSummary = visibleRoles.length > 0 ? visibleRoles.join(", ") : "No extra roles";

    let reason = "Role assignment likely failed earlier; the bot should be able to sync it now.";
    if (!registeredRole) {
      reason = "The `registered` role does not exist in this server.";
    } else if (!botMember) {
      reason = "The bot member could not be fetched from this server.";
    } else if (!hasManageRoles) {
      reason = "The bot is missing the `Manage Roles` permission.";
    } else if (!canManageRegisteredRole) {
      reason =
        "The `registered` role is above or equal to the bot's highest role, so the bot cannot assign it.";
    } else if (member.id === interaction.guild.ownerId) {
      reason = "Discord does not let the bot manage the server owner's roles.";
    } else if (member.roles.highest.position >= botHighestRolePosition) {
      reason =
        "This member's highest role is above or equal to the bot's highest role, so the bot cannot manage their roles.";
    }

    issues.push({
      userId: registration.user_id,
      username: registration.username,
      enrollmentNo: registration.enrollment_no,
      reason,
      roleSummary
    });
  }

  const summaryFields = [
    { name: "Registered Users", value: String(registrations.length), inline: true },
    { name: "Role Present", value: String(assignedCount), inline: true },
    { name: "Missing Role", value: String(issues.length - missingMemberCount), inline: true },
    { name: "Not In Server", value: String(missingMemberCount), inline: true },
    {
      name: "Registered Role",
      value: registeredRole ? `<@&${registeredRole.id}>` : "Missing",
      inline: true
    },
    {
      name: "Bot Role Check",
      value: hasManageRoles
        ? canManageRegisteredRole || !registeredRole
          ? "Manage Roles looks OK"
          : "Role hierarchy blocks assignment"
        : "Missing `Manage Roles`",
      inline: true
    }
  ];

  if (issues.length === 0) {
    await interaction.editReply({
      embeds: [
        buildEmbed({
          title: "Registered Role Audit",
          description: "Every registered member currently has the `registered` role.",
          color: 0x67f0aa,
          fields: summaryFields
        })
      ]
    });
    return;
  }

  const chunks: typeof issues[] = [];
  for (let index = 0; index < issues.length; index += 5) {
    chunks.push(issues.slice(index, index + 5));
  }

  await interaction.editReply({
    embeds: chunks.slice(0, 4).map((chunk, chunkIndex) =>
      buildEmbed({
        title: chunkIndex === 0 ? "Registered Role Audit" : `Registered Role Audit (${chunkIndex + 1})`,
        description:
          chunkIndex === 0
            ? "These registered users are missing the `registered` role or are no longer in the server."
            : undefined,
        color: 0xffd85a,
        fields: [
          ...(chunkIndex === 0 ? summaryFields : []),
          ...chunk.map((issue) => ({
            name: `${issue.username} (${issue.enrollmentNo})`,
            value: `${issue.reason}\nRoles: ${issue.roleSummary}\n<@${issue.userId}>`,
            inline: false
          }))
        ]
      })
    )
  });
}

async function handleRenameRegistered(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.inCachedGuild()) {
    throw new Error("This command must be used inside a server.");
  }

  const studentNamesByEnrollment = await loadStudentNameLookup();
  const registrations = registeredUserRepository.listByGuild(interaction.guildId);
  const memberMap = await getGuildMemberMap(interaction);
  const botMember = await interaction.guild.members.fetchMe().catch(() => null);
  const missingManageNicknames = !botMember?.permissions.has(PermissionFlagsBits.ManageNicknames);

  let renamedCount = 0;
  let skippedRoleCount = 0;
  let skippedMissingNameCount = 0;
  let skippedUnmanageableCount = 0;
  let failedRenameCount = 0;
  let unchangedCount = 0;
  const examples: string[] = [];
  const failureReasonCounts = new Map<string, number>();
  const failureExamples: string[] = [];

  const recordFailureReason = (reason: string) => {
    failureReasonCounts.set(reason, (failureReasonCounts.get(reason) ?? 0) + 1);
  };

  for (const registration of registrations) {
    const member = memberMap.get(registration.user_id);
    if (!member) {
      continue;
    }

    const resolvedStudentName = getStudentNameForEnrollment(
      registration.enrollment_no,
      studentNamesByEnrollment
    );
    if (resolvedStudentName === "-" || resolvedStudentName === "Data not available") {
      skippedMissingNameCount += 1;
      continue;
    }

    const targetName = formatStudentDisplayName(resolvedStudentName);
    const currentName = member.nickname ?? member.user.globalName ?? member.user.username;
    const eligibleForRename = isEligibleForRegisteredRename(member);
    const canFixLegacyFormatting =
      !eligibleForRename && canRefreshLegacyRegisteredFormatting(currentName, targetName);

    if (!eligibleForRename && !canFixLegacyFormatting) {
      skippedRoleCount += 1;
      continue;
    }

    if (!member.manageable) {
      skippedUnmanageableCount += 1;
      continue;
    }

    if (!needsRegisteredNameRefresh(currentName, targetName)) {
      unchangedCount += 1;
      continue;
    }

    const renameError = await member
      .setNickname(targetName, "Renamed from registered enrollment number")
      .then(() => null)
      .catch((error) => error);
    if (renameError) {
      failedRenameCount += 1;
      const reason =
        renameError instanceof DiscordAPIError
          ? `${renameError.code}: ${renameError.message}`
          : renameError instanceof Error
            ? renameError.message
            : "Unknown nickname update error";
      recordFailureReason(reason);

      if (failureExamples.length < 5) {
        failureExamples.push(`${currentName} -> ${targetName}: ${reason}`);
      }

      continue;
    }

    renamedCount += 1;

    if (examples.length < 5) {
      examples.push(`${currentName} -> ${targetName} (${registration.enrollment_no})`);
    }
  }

  await sendRegistryLogForGuild(interaction.guildId, {
    title: "Registered Members Renamed",
    description: "Eligible registered members were renamed using student names mapped from enrollment numbers.",
    color: 0x67f0aa,
    fields: [
      { name: "Renamed", value: String(renamedCount), inline: true },
      { name: "Skipped Roles", value: String(skippedRoleCount), inline: true },
      { name: "Missing Student Name", value: String(skippedMissingNameCount), inline: true },
      { name: "Not Manageable", value: String(skippedUnmanageableCount), inline: true },
      { name: "Rename Failed", value: String(failedRenameCount), inline: true },
      { name: "Already Matching", value: String(unchangedCount), inline: true },
      {
        name: "Bot Permission Check",
        value: missingManageNicknames ? "Missing `Manage Nicknames` permission" : "Manage Nicknames is present",
        inline: false
      },
      {
        name: "Failure Reasons",
        value:
          failureReasonCounts.size > 0
            ? [...failureReasonCounts.entries()]
                .map(([reason, count]) => `${count}x ${reason}`)
                .join("\n")
            : "No rename failures."
      },
      {
        name: "Renamed By",
        value: `${await getInteractionDisplayName(interaction)}\n<@${interaction.user.id}>`,
        inline: true
      },
      {
        name: "Examples",
        value: examples.length > 0 ? examples.join("\n") : "No nickname changes were needed."
      },
      {
        name: "Failure Examples",
        value: failureExamples.length > 0 ? failureExamples.join("\n") : "No per-member rename failures."
      }
    ]
  });

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: renamedCount > 0 ? "Registered Members Renamed" : "No Members Renamed",
        description:
          missingManageNicknames
            ? "The bot is missing the `Manage Nicknames` permission, so nickname updates will fail until that is fixed."
            : "Only members with no extra roles or only the `member` role were considered for renaming.",
        color: renamedCount > 0 ? 0x67f0aa : 0xffd85a,
        fields: [
          { name: "Renamed", value: String(renamedCount), inline: true },
          { name: "Skipped Roles", value: String(skippedRoleCount), inline: true },
          { name: "Missing Student Name", value: String(skippedMissingNameCount), inline: true },
          { name: "Not Manageable", value: String(skippedUnmanageableCount), inline: true },
          { name: "Rename Failed", value: String(failedRenameCount), inline: true },
          { name: "Already Matching", value: String(unchangedCount), inline: true },
          {
            name: "Top Failure Reason",
            value:
              failureReasonCounts.size > 0
                ? [...failureReasonCounts.entries()]
                    .sort((left, right) => right[1] - left[1])[0][0]
                : "None"
          }
        ]
      })
    ]
  });
}

async function handleRenameUpdate(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.inCachedGuild()) {
    throw new Error("This command must be used inside a server.");
  }

  const studentNamesByEnrollment = await loadStudentNameLookup();
  const registrations = registeredUserRepository.listByGuild(interaction.guildId);
  const memberMap = await getGuildMemberMap(interaction);
  const botMember = await interaction.guild.members.fetchMe().catch(() => null);
  const missingManageNicknames = !botMember?.permissions.has(PermissionFlagsBits.ManageNicknames);

  let updatedCount = 0;
  let skippedNotFormattingCount = 0;
  let skippedMissingNameCount = 0;
  let skippedUnmanageableCount = 0;
  let failedUpdateCount = 0;
  let alreadyCurrentCount = 0;
  const examples: string[] = [];
  const failureReasonCounts = new Map<string, number>();
  const failureExamples: string[] = [];

  const recordFailureReason = (reason: string) => {
    failureReasonCounts.set(reason, (failureReasonCounts.get(reason) ?? 0) + 1);
  };

  for (const registration of registrations) {
    const member = memberMap.get(registration.user_id);
    if (!member) {
      continue;
    }

    const resolvedStudentName = getStudentNameForEnrollment(
      registration.enrollment_no,
      studentNamesByEnrollment
    );
    if (resolvedStudentName === "-" || resolvedStudentName === "Data not available") {
      skippedMissingNameCount += 1;
      continue;
    }

    const targetName = formatStudentDisplayName(resolvedStudentName);
    const currentName = member.nickname ?? member.user.globalName ?? member.user.username;

    if (!needsRegisteredNameRefresh(currentName, targetName)) {
      alreadyCurrentCount += 1;
      continue;
    }

    if (!canRefreshLegacyRegisteredFormatting(currentName, targetName)) {
      skippedNotFormattingCount += 1;
      continue;
    }

    if (!member.manageable) {
      skippedUnmanageableCount += 1;
      continue;
    }

    const renameError = await member
      .setNickname(targetName, "Refresh registered nickname formatting")
      .then(() => null)
      .catch((error) => error);
    if (renameError) {
      failedUpdateCount += 1;
      const reason =
        renameError instanceof DiscordAPIError
          ? `${renameError.code}: ${renameError.message}`
          : renameError instanceof Error
            ? renameError.message
            : "Unknown nickname update error";
      recordFailureReason(reason);

      if (failureExamples.length < 5) {
        failureExamples.push(`${currentName} -> ${targetName}: ${reason}`);
      }

      continue;
    }

    updatedCount += 1;
    if (examples.length < 5) {
      examples.push(`${currentName} -> ${targetName} (${registration.enrollment_no})`);
    }
  }

  await sendRegistryLogForGuild(interaction.guildId, {
    title: "Registered Nicknames Updated",
    description: "Registered members with outdated nickname formatting were refreshed to the latest student-name style.",
    color: 0x67f0aa,
    fields: [
      { name: "Updated", value: String(updatedCount), inline: true },
      { name: "Not Formatting Only", value: String(skippedNotFormattingCount), inline: true },
      { name: "Missing Student Name", value: String(skippedMissingNameCount), inline: true },
      { name: "Not Manageable", value: String(skippedUnmanageableCount), inline: true },
      { name: "Update Failed", value: String(failedUpdateCount), inline: true },
      { name: "Already Current", value: String(alreadyCurrentCount), inline: true },
      {
        name: "Bot Permission Check",
        value: missingManageNicknames ? "Missing `Manage Nicknames` permission" : "Manage Nicknames is present",
        inline: false
      },
      {
        name: "Failure Reasons",
        value:
          failureReasonCounts.size > 0
            ? [...failureReasonCounts.entries()]
                .map(([reason, count]) => `${count}x ${reason}`)
                .join("\n")
            : "No update failures."
      },
      {
        name: "Updated By",
        value: `${await getInteractionDisplayName(interaction)}\n<@${interaction.user.id}>`,
        inline: true
      },
      {
        name: "Examples",
        value: examples.length > 0 ? examples.join("\n") : "No nickname formatting changes were needed."
      },
      {
        name: "Failure Examples",
        value: failureExamples.length > 0 ? failureExamples.join("\n") : "No per-member update failures."
      }
    ]
  });

  await interaction.editReply({
    embeds: [
      buildEmbed({
        title: updatedCount > 0 ? "Registered Nicknames Updated" : "No Nickname Updates Needed",
        description: missingManageNicknames
          ? "The bot is missing the `Manage Nicknames` permission, so nickname updates will fail until that is fixed."
          : "This command only refreshes outdated nickname formatting for already-registered names.",
        color: updatedCount > 0 ? 0x67f0aa : 0xffd85a,
        fields: [
          { name: "Updated", value: String(updatedCount), inline: true },
          { name: "Not Formatting Only", value: String(skippedNotFormattingCount), inline: true },
          { name: "Missing Student Name", value: String(skippedMissingNameCount), inline: true },
          { name: "Not Manageable", value: String(skippedUnmanageableCount), inline: true },
          { name: "Update Failed", value: String(failedUpdateCount), inline: true },
          { name: "Already Current", value: String(alreadyCurrentCount), inline: true }
        ]
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
    const shouldReplyPrivately = interaction.commandName !== "show";
    await interaction.deferReply(shouldReplyPrivately ? privateResponse : undefined);

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

      const subcommand = interaction.options.getSubcommand(true);
      if (subcommand === "mismatched") {
        await handleDeregisterMismatched(interaction);
        return;
      }

      await handleDeregisterMember(interaction);
      return;
    }

    if (interaction.commandName === "rename") {
      if (!(await ensureStaffAccess(interaction))) {
        return;
      }

      const subcommand = interaction.options.getSubcommand(true);
      if (subcommand === "update") {
        await handleRenameUpdate(interaction);
        return;
      }

      if (subcommand !== "registered") {
        return;
      }

      await handleRenameRegistered(interaction);
      return;
    }

    if (interaction.commandName === "show") {
      if (!(await ensureStaffAccess(interaction))) {
        return;
      }

      const subcommand = interaction.options.getSubcommand(true);
      if (subcommand === "registered-role") {
        await handleShowRegisteredRole(interaction);
        return;
      }

      await handleShowMismatched(interaction);
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
