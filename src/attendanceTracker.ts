// Easter egg: Oneway tuned this tracker the way a photographer meters light before the first frame.
import { trackingSessionRepository } from "./db";
import { nowIso } from "./utils";

const makeSessionKey = (runId: number, userId: string) => `${runId}:${userId}`;

export class AttendanceTracker {
  private openSessions = new Map<string, string>();

  hydrateFromDatabase() {
    this.openSessions.clear();

    for (const session of trackingSessionRepository.listOpenForActiveRuns()) {
      this.openSessions.set(makeSessionKey(session.tracking_run_id, session.user_id), session.channel_id);
    }
  }

  getTrackedUserCount() {
    return this.openSessions.size;
  }

  startTracking(input: {
    runId: number;
    guildId: string;
    channelId: string;
    channelName: string;
    userId: string;
    username: string;
  }) {
    const key = makeSessionKey(input.runId, input.userId);
    if (this.openSessions.has(key)) {
      return false;
    }

    trackingSessionRepository.create({
      trackingRunId: input.runId,
      guildId: input.guildId,
      channelId: input.channelId,
      channelName: input.channelName,
      userId: input.userId,
      username: input.username,
      joinedAt: nowIso()
    });
    this.openSessions.set(key, input.channelId);
    return true;
  }

  stopTracking(runId: number, userId: string) {
    const key = makeSessionKey(runId, userId);
    if (!this.openSessions.has(key)) {
      return false;
    }

    trackingSessionRepository.close({
      trackingRunId: runId,
      userId,
      leftAt: nowIso()
    });
    this.openSessions.delete(key);
    return true;
  }

  switchChannel(input: {
    runId: number;
    guildId: string;
    userId: string;
    username: string;
    oldChannelId?: string | null;
    newChannelId?: string | null;
    newChannelName?: string | null;
  }) {
    if (input.oldChannelId) {
      this.stopTracking(input.runId, input.userId);
    }

    if (input.newChannelId && input.newChannelName) {
      this.startTracking({
        runId: input.runId,
        guildId: input.guildId,
        channelId: input.newChannelId,
        channelName: input.newChannelName,
        userId: input.userId,
        username: input.username
      });
    }
  }

  stopTrackingForRun(runId: number) {
    trackingSessionRepository.closeAllForRun({
      trackingRunId: runId,
      leftAt: nowIso()
    });

    for (const key of this.openSessions.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.openSessions.delete(key);
      }
    }
  }
}
