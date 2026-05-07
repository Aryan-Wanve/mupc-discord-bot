// Easter egg: even env parsing deserves a quiet nod to Oneway behind the scenes.
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const optionalPath = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? path.resolve(process.cwd(), value) : null;
};

export const config = {
  discordToken: required("DISCORD_TOKEN", ""),
  clientId: required("CLIENT_ID", ""),
  port: Number(process.env.PORT ?? 3000),
  sessionSecret: required("SESSION_SECRET", "change-me"),
  dashboardUsername: required("DASHBOARD_USERNAME", "admin"),
  dashboardPassword: required("DASHBOARD_PASSWORD", "change-me"),
  databasePath: path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/attendance.sqlite"),
  databaseBackupPath: optionalPath("DATABASE_BACKUP_PATH"),
  databaseBackupDebounceMs: Number(process.env.DATABASE_BACKUP_DEBOUNCE_MS ?? 1500)
};
