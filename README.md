# MUPC Attendance Bot

A Discord attendance bot and dashboard for MUPC workshops. It tracks voice attendance across a server, lets members register enrollment numbers, helps admins clean registration data, and exports attendance plus user analytics from a local dashboard.

## What it does

- tracks attendance across all voice and stage channels in a Discord server
- stores per-server registration data mapped to enrollment numbers
- matches enrollment numbers against Excel student data in `stud_data`
- creates and syncs a green `registered` role for registered members
- shows mismatched registrations and supports bulk cleanup
- audits missing registered roles with `/show registered-role`
- renames eligible registered members to their student names with `/rename registered`
- refreshes old nickname formatting with `/rename update`
- writes attendance logs to `#attendance-logs`
- writes private registration logs to `#user-registry-logs`
- provides a password-protected dashboard for runs, users, exports, and analytics

## Slash commands

### Member commands

```text
/register enrollmentno:<your enrollment number>
/help
/ping
```

### Admin commands

```text
/tracking start [title]
/tracking stop
/tracking schedule title:<name> start:<HH:mm> end:<HH:mm>
/tracking schedule-start title:<name> start:<HH:mm>
/tracking cancel runid:<id>
/tracking status
/show mismatched
/show registered-role
/deregister member user:<user>
/deregister mismatched
/rename registered
/rename update
/help
/ping
```

## Registration workflow

1. Members register with `/register enrollmentno:<value>`.
2. The bot stores the registration per guild in SQLite.
3. Student names are resolved from Excel files in `stud_data`.
4. Admins can review problems with `/show mismatched`.
5. Admins can remove bad entries with `/deregister mismatched`.
6. The bot creates or reuses a `registered` role and syncs it to registered members.
7. Admins can audit role sync issues with `/show registered-role`.
8. Admins can rename eligible members with `/rename registered`.
9. Admins can refresh old all-caps or messy nickname formatting with `/rename update`.

`/rename registered` only attempts members who have no extra roles beyond `@everyone`, or exactly one extra role named `member`. It skips unmatched enrollments, unmanageable members, and members whose names are already correct.

`/rename update` is the safer cleanup command for older nickname formatting. It only updates registered members whose current nickname is already the same name in a stale format, such as all caps or inconsistent spacing.

## Tracking workflow

1. Start a run immediately with `/tracking start` or schedule it with `/tracking schedule`.
2. The bot watches every voice/stage channel in that server while the run is active.
3. Attendance sessions are recorded as members join, leave, or switch channels.
4. Stop the run with `/tracking stop`, or let a scheduled run stop automatically.
5. Review the run and exports from the dashboard.

## Dashboard

The dashboard runs on `http://localhost:3000` by default and is protected by the configured username and password.

Main areas:

- server overview
- run listing and run detail pages
- registered users and attendance analytics
- mismatched registration review
- Excel exports for runs and user views

## Student data

Put `.xlsx` files inside `stud_data`. Each sheet should contain headers that normalize to:

- `Student Name`
- `Enrollment No`

The bot reads all matching Excel files, builds an enrollment-to-name lookup, and uses that for registration validation, mismatch detection, exports, and `/rename registered`.

## Log channels

The bot creates these channels when possible:

- `#attendance-logs` for tracking start/stop/scheduler events
- `#user-registry-logs` for private registration, deregistration, mismatch cleanup, role-audit, and rename logs

The registry log channel is created with restricted visibility for admins and the bot.

## Registered role sync

The bot keeps a role named `registered` in sync with the enrollment registry.

- it creates the role automatically if it is missing
- it assigns the role during `/register`
- it removes the role during deregistration
- it backfills the role for existing registered users on startup
- `/show registered-role` explains who is still missing the role and why

## Requirements

- Node.js
- a Discord application with:
  - `SERVER MEMBERS INTENT`
  - `GUILD VOICE STATES INTENT`
- a bot invite that can:
  - view channels
  - send messages
  - read message history
  - manage roles if you want registered-role sync to work reliably
  - manage nicknames if you want `/rename registered` to work reliably

## Environment variables

Create a `.env` file with:

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
PORT=3000
SESSION_SECRET=change-me
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=change-me
DATABASE_PATH=./data/attendance.sqlite
```

## Local development

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Start the compiled app:

```bash
npm start
```

## Project structure

- `src/bot.ts` handles Discord login, logs, and voice attendance tracking
- `src/commands.ts` defines slash commands and registration admin flows
- `src/db.ts` owns SQLite schema setup and repositories
- `src/server.ts` serves the dashboard and exports
- `src/studentData.ts` loads Excel student data and enrollment matching
- `views/` contains dashboard templates
- `public/` contains dashboard assets
- `TUTORIAL.md` is the operator guide for club heads and cores

## Notes

- registrations are stored per Discord server
- slash commands are registered per guild on startup
- scheduled runs are checked periodically and start/stop automatically
- role sync and nickname updates can still be blocked by Discord role hierarchy
- if the bot cannot rename someone, the command summary will show it under `Not Manageable` or `Rename Failed`
