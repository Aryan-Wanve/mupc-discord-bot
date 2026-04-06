export type WebinarRow = {
  id: number;
  title: string;
  guild_id: string;
  channel_id: string;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  is_active: number;
};

export type AttendanceSessionRow = {
  id: number;
  webinar_id: number;
  user_id: string;
  username: string;
  joined_at: string;
  left_at: string | null;
};

export type WebinarReportRow = {
  user_id: string;
  username: string;
  total_seconds: number;
  sessions: string;
};
