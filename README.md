# MUPC Discord Webinar Attendance Bot

A production-style Discord attendance system built to track webinar presence inside voice channels and give organizers a clean way to review and export timed attendance records.

This project is meant for a practical use case: running webinars in Discord and measuring how long each participant actually stayed in the voice channel. Instead of manually checking names or screenshots, the bot records join and leave windows, stores them in a local database, and exposes the data through a simple dashboard where attendance can be reviewed and exported as CSV.

The goal was to make something operational, not just experimental. So rather than building only a Discord bot, I built a small full-stack tool around it:

- a Discord bot that listens for voice channel activity
- a built-in SQLite database for storing webinar sessions and attendance logs
- a browser dashboard for creating webinars, starting and stopping tracking, and downloading attendance sheets

## Project Purpose

This bot is designed to solve a real attendance problem:

- track who joined a webinar voice channel
- measure how long each person stayed
- keep exact marked timings for join and leave windows
- make attendance easy to review after the session
- export records into CSV format for admin work, reporting, or proof of participation

Instead of treating attendance as a one-off manual task, this project approaches it like a small internal product:

- clear separation between bot logic, storage, and dashboard
- reliable local persistence through SQLite
- start and stop controls so only the actual webinar window is counted
- exportable reporting for practical use after the event

## What The System Includes

### 1. Discord voice attendance tracking

The bot listens for voice state changes in Discord and watches a configured voice channel for a specific webinar. When a user joins while the webinar is active, the bot records a session start. When the user leaves, it records the session end.

This makes it possible to calculate actual voice attendance instead of relying on static member lists.

### 2. Webinar-based session management

Attendance is grouped per webinar. Each webinar has:

- a title
- a Discord server ID
- a target voice channel ID
- optional notes
- start and stop state

This keeps separate events isolated from each other so you can run multiple webinar records over time without mixing attendance data.

### 3. Built-in SQLite database

The project uses SQLite through `better-sqlite3`, which keeps setup simple while still giving permanent storage for:

- webinar definitions
- attendance sessions
- active and completed attendance windows

Because the database is local, this is easy to run for small to medium use cases without deploying a separate database server.

### 4. Dashboard for admins

The dashboard provides a browser-based control panel where you can:

- create a webinar
- enter the Discord guild ID and voice channel ID
- start tracking when the webinar begins
- stop tracking when the webinar ends
- review the attendance summary for each user
- download CSV exports

The dashboard is protected with HTTP Basic Auth using credentials from the environment file.

### 5. CSV export with marked timings

Each webinar can be exported as a CSV attendance sheet. The export includes:

- user ID
- username
- total seconds attended
- formatted total duration
- marked timing windows in `joined_at -> left_at` format

This makes it useful for attendance verification, internal record keeping, or follow-up reporting after the webinar.

## Tech Stack

- Node.js
- TypeScript
- Discord.js
- Express
- EJS
- SQLite
- better-sqlite3

## Architecture Notes

### App structure

- `src/index.ts`
  Starts both the Discord bot and the web dashboard.

- `src/bot.ts`
  Handles Discord login, voice state listeners, and start/stop webinar tracking behavior.

- `src/attendanceTracker.ts`
  Coordinates active attendance sessions and keeps open session tracking consistent.

- `src/db.ts`
  Creates the SQLite schema and contains the database queries for webinars and attendance sessions.

- `src/server.ts`
  Runs the Express dashboard, webinar actions, and CSV export endpoints.

- `views/index.ejs`
  Main dashboard UI for webinar creation, attendance review, and downloads.

- `public/styles.css`
  Styling for the dashboard interface.

## How Attendance Works

The workflow is intentionally simple:

1. Create a webinar from the dashboard.
2. Enter the Discord server ID and voice channel ID you want to monitor.
3. Click `Start tracking` when the webinar begins.
4. Let the session run while the bot records joins and leaves.
5. Click `Stop tracking` when the webinar ends.
6. Download the CSV report from the dashboard.

If members are already inside the voice channel when tracking starts, the bot picks them up immediately and starts their session from that point onward.

## Required Discord Configuration

To run properly, the Discord application should have the following privileged intents enabled in the Discord Developer Portal:

- `SERVER MEMBERS INTENT`
- `GUILD VOICE STATES INTENT`

The bot should also be invited with enough permissions to:

- view channels
- read basic member information

No moderation permissions are required for basic attendance tracking.

## Local Development

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Start the compiled app:

```bash
npm start
```

The dashboard runs by default at:

```text
http://localhost:3000
```

## Environment Variables

Create a local environment file:

```bash
.env
```

Expected variables:

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
PORT=3000
SESSION_SECRET=change-me
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=change-me
DATABASE_PATH=./data/attendance.sqlite
```

Notes:

- `DISCORD_TOKEN` is required for the bot to log in
- `CLIENT_ID` should match your Discord application
- `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` protect the dashboard
- `DATABASE_PATH` controls where the SQLite file is stored locally

## Why I Built It This Way

The useful part of this project is that it connects three things that often get handled separately:

- live Discord activity
- persistent attendance storage
- admin-friendly reporting

A lot of small internal bots stop at logging events into the console or dumping rough data into chat. I wanted this one to go further and feel like a proper tool someone could actually use during real webinar operations.

That is why the project combines a bot with a small web dashboard and export flow instead of treating attendance tracking as only a background script.

## Current Product Direction

This project is currently focused on being:

- simple to run locally
- reliable for webinar attendance counting
- practical for admins who need exportable records
- structured well enough to grow into a more polished internal tool

## Future Improvements

- slash commands for creating and controlling webinars from Discord
- role-based dashboard auth instead of basic auth
- better webinar filtering and search in the dashboard
- hosted deployment configuration
- automatic participant summaries or attendance thresholds
- cleaner analytics and visual charts for attendance trends

## Author

**Aryan Wanve**

Engineering student building practical software projects and systems with real use cases.

GitHub: [Aryan-Wanve](https://github.com/Aryan-Wanve)

## Status

Active project and working first version for Discord webinar voice attendance tracking.
