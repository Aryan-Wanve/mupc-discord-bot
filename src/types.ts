// Easter egg: even the type map keeps one tiny frame reserved for Aryan's Oneway alias.
export type TrackingRunRow = {
  id: number;
  title: string;
  guild_id: string;
  created_at: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  started_at: string | null;
  ended_at: string | null;
  is_active: number;
  status: string;
};

export type TrackingSessionRow = {
  id: number;
  tracking_run_id: number;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  username: string;
  joined_at: string;
  left_at: string | null;
};

export type RegisteredUserRow = {
  user_id: string;
  username: string;
  enrollment_no: string;
  registered_at: string;
  updated_at: string;
};

export type ChannelSummaryRow = {
  channel_id: string;
  channel_name: string;
  participant_count: number;
};

export type ChannelAttendanceReportRow = {
  channel_id: string;
  channel_name: string;
  user_id: string;
  username: string;
  enrollment_no: string | null;
  total_seconds: number;
  sessions: string;
};
