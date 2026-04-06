# Discord Webinar Attendance Bot

This project combines:

- A Discord bot that listens for voice channel join and leave events.
- A built-in SQLite database for attendance storage.
- A password-protected dashboard for creating webinars, starting and stopping tracking, and exporting CSV attendance reports.

## Features

- Track attendance only while a webinar is active.
- Automatically record join and leave timestamps for members in the target voice channel.
- Show total attendance time per user in the dashboard.
- Export CSV files with total duration and marked timing ranges.
- Persist all data locally in SQLite.

## Stack

- Node.js
- TypeScript
- discord.js
- better-sqlite3
- Express
- EJS

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in your Discord bot token and client ID.
3. Set a dashboard username and password.
4. Install dependencies:

```bash
npm install
```

5. Start the app in development mode:

```bash
npm run dev
```

6. Open the dashboard at `http://localhost:3000`.

## Required Discord Bot Permissions

Enable these intents in the Discord developer portal:

- `SERVER MEMBERS INTENT`
- `GUILD VOICE STATES INTENT`

And invite the bot with permissions that allow it to:

- View channels
- Read member information

The bot does not need moderation permissions for attendance tracking alone.

## Typical Workflow

1. Create a webinar in the dashboard using the Discord server ID and voice channel ID.
2. Click `Start tracking` right before the webinar begins.
3. Let the webinar run while the bot records voice activity.
4. Click `Stop tracking` when the webinar ends.
5. Download the CSV from the webinar card.

## CSV Output

Each export includes:

- User ID
- Username
- Total seconds
- Total formatted duration
- Marked timings in `joined_at -> left_at` format

## Notes

- The dashboard uses HTTP Basic Auth from your `.env` credentials.
- The database file defaults to `./data/attendance.sqlite`.
- If members are already inside the channel when tracking starts, they are picked up immediately.
