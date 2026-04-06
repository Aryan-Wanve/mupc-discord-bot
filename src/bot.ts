import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Interaction,
  Partials,
  VoiceState
} from "discord.js";
import { config } from "./config";
import { webinarRepository } from "./db";
import { AttendanceTracker } from "./attendanceTracker";
import { handleSlashCommand, registerSlashCommands } from "./commands";

const tracker = new AttendanceTracker();

const getDisplayName = (state: VoiceState) =>
  state.member?.user.globalName ?? state.member?.user.username ?? state.id;

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

async function handleVoiceLeave(state: VoiceState) {
  const guildId = state.guild.id;
  const channelId = state.channelId;
  if (!channelId) {
    return;
  }

  const webinars = webinarRepository.findActiveByChannel(guildId, channelId);
  for (const webinar of webinars) {
    tracker.stopTracking(webinar.id, state.id);
  }
}

async function handleVoiceJoin(state: VoiceState) {
  const guildId = state.guild.id;
  const channelId = state.channelId;
  if (!channelId) {
    return;
  }

  const webinars = webinarRepository.findActiveByChannel(guildId, channelId);
  for (const webinar of webinars) {
    tracker.startTracking(webinar.id, state.id, getDisplayName(state));
  }
}

discordClient.once("ready", async () => {
  await tracker.hydrateFromDatabase();
  await tracker.syncAllActiveWebinars(discordClient);
  await registerSlashCommands([...discordClient.guilds.cache.keys()]);
  console.log(`Discord bot logged in as ${discordClient.user?.tag}`);
});

discordClient.on("guildCreate", async (guild) => {
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

  await handleVoiceLeave(oldState);
  await handleVoiceJoin(newState);
});

export async function loginBot() {
  await discordClient.login(config.discordToken);
}

export async function startWebinarTracking(webinarId: number) {
  const webinar = webinarRepository.findById(webinarId);
  if (!webinar) {
    throw new Error("Webinar not found.");
  }

  webinarRepository.markStarted(webinarId, new Date().toISOString());

  const channel = await discordClient.channels.fetch(webinar.channel_id);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    if (!channel || !channel.isVoiceBased()) {
      throw new Error("Configured channel is not a voice-based channel.");
    }
  }

  if (channel && channel.isVoiceBased()) {
    tracker.syncCurrentChannelMembers(webinarId, channel);
  }
}

export function stopWebinarTracking(webinarId: number) {
  const webinar = webinarRepository.findById(webinarId);
  if (!webinar) {
    throw new Error("Webinar not found.");
  }

  webinarRepository.markStopped(webinarId, new Date().toISOString());
  tracker.stopTrackingForWebinar(webinarId);
}
