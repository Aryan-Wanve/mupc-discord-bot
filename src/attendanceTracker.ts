import { Client, VoiceBasedChannel } from "discord.js";
import { attendanceRepository, webinarRepository } from "./db";
import { nowIso } from "./utils";

const makeSessionKey = (webinarId: number, userId: string) => `${webinarId}:${userId}`;

export class AttendanceTracker {
  private openSessions = new Set<string>();

  async hydrateFromDatabase() {
    for (const webinar of webinarRepository.list().filter((row) => row.is_active === 1)) {
      for (const session of attendanceRepository.listByWebinar(webinar.id)) {
        if (!session.left_at) {
          this.openSessions.add(makeSessionKey(webinar.id, session.user_id));
        }
      }
    }
  }

  startTracking(webinarId: number, userId: string, username: string) {
    const key = makeSessionKey(webinarId, userId);
    if (this.openSessions.has(key)) {
      return false;
    }

    attendanceRepository.createSession({
      webinarId,
      userId,
      username,
      joinedAt: nowIso()
    });
    this.openSessions.add(key);
    return true;
  }

  stopTracking(webinarId: number, userId: string) {
    const key = makeSessionKey(webinarId, userId);
    if (!this.openSessions.has(key)) {
      return false;
    }

    attendanceRepository.closeSession({
      webinarId,
      userId,
      leftAt: nowIso()
    });
    this.openSessions.delete(key);
    return true;
  }

  stopTrackingForWebinar(webinarId: number) {
    attendanceRepository.closeAllOpenSessionsForWebinar({
      webinarId,
      leftAt: nowIso()
    });

    for (const key of this.openSessions) {
      if (key.startsWith(`${webinarId}:`)) {
        this.openSessions.delete(key);
      }
    }
  }

  syncCurrentChannelMembers(webinarId: number, channel: VoiceBasedChannel) {
    for (const [memberId, member] of channel.members) {
      const displayName = member.user.globalName ?? member.user.username;
      this.startTracking(webinarId, memberId, displayName);
    }
  }

  async syncAllActiveWebinars(client: Client) {
    for (const webinar of webinarRepository.list().filter((row) => row.is_active === 1)) {
      const channel = await client.channels.fetch(webinar.channel_id).catch(() => null);
      if (channel && channel.isVoiceBased()) {
        this.syncCurrentChannelMembers(webinar.id, channel);
      }
    }
  }
}
