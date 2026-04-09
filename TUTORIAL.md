# How To Use The MUPC Bot

This tutorial is for actually using the bot after it is already running.

It focuses on:

- what members do inside Discord
- what admins do inside Discord
- what each slash command does
- how to open and use the dashboard
- how to export attendance

## What The Bot Does

The bot tracks voice attendance for workshops, webinars, and similar Discord sessions.

It works like this:

- members register their enrollment number with the bot
- an admin starts or schedules attendance tracking
- members join the server's voice channels
- the bot records join and leave times
- admins review everything in the dashboard

## Who Uses What

There are two types of users:

- `Members`
- `Admins`

Members usually only need:

- `/register`
- `/help`
- joining the correct voice channel during the workshop

Admins usually use:

- `/tracking start`
- `/tracking stop`
- `/tracking schedule`
- `/tracking schedule-start`
- `/tracking cancel`
- `/tracking status`
- the dashboard

## Member Guide

### 1. Register your enrollment number

Before attendance can be exported correctly, each member should register.

Use:

```text
/register enrollmentno:<your enrollment number>
```

Example:

```text
/register enrollmentno:23BCE1234
```

What this does:

- links your Discord account to your enrollment number
- makes your attendance exports easier to identify
- saves the registration only for the current server

Important:

- if your enrollment number is already linked to another Discord account in the same server, registration will fail
- if you already registered, the bot will tell you your current saved enrollment number

### 2. Check if the bot is working

Use:

```text
/ping
```

This confirms the bot is online and responding.

### 3. Read the built-in help message

Use:

```text
/help
```

For regular members, this explains the basic usage flow.

### 4. Join the workshop voice channel

When the workshop starts:

- join the correct voice channel in the Discord server
- stay connected for as long as you are attending
- leave when you are done

The bot automatically records:

- when you joined
- when you left
- how long you stayed

If the workshop is scheduled by an admin, you do not need to do anything special besides joining at the right time.

## Admin Guide

Admins need the `Manage Server` permission to use tracking commands.

### 1. Start attendance immediately

Use:

```text
/tracking start
```

You can also give the run a title:

```text
/tracking start title:Web Development Workshop
```

What it does:

- starts attendance tracking immediately
- begins recording attendance across all voice channels in that server
- creates a tracking run you can later review in the dashboard

Use this when:

- the workshop is starting right now
- you do not need to schedule it in advance

### 2. Stop the active run

Use:

```text
/tracking stop
```

What it does:

- stops the active tracking run
- closes the attendance window
- makes the final export ready in the dashboard

Use this when:

- the workshop is over
- you want final attendance totals

### 3. Schedule both start and end time

Use:

```text
/tracking schedule title:<name> start:<HH:mm> end:<HH:mm>
```

Example:

```text
/tracking schedule title:DSA Workshop start:14:00 end:16:00
```

What it does:

- creates a scheduled run
- starts automatically at the given time
- stops automatically at the given time

Use this when:

- the event has a fixed start and end time

### 4. Schedule only the start time

Use:

```text
/tracking schedule-start title:<name> start:<HH:mm>
```

Example:

```text
/tracking schedule-start title:Placement Seminar start:10:00
```

What it does:

- starts attendance automatically at the given time
- keeps tracking active until you manually stop it

Use this when:

- you know when the session starts
- you do not know exactly when it will end

### 5. Cancel a scheduled run

Use:

```text
/tracking cancel runid:<id>
```

Example:

```text
/tracking cancel runid:12
```

What it does:

- cancels a scheduled run before it starts

Use this when:

- the workshop is postponed
- the wrong schedule was created

### 6. Check the current status

Use:

```text
/tracking status
```

What it shows:

- the active run, if there is one
- recent runs
- run IDs
- whether runs are active, scheduled, or completed

Use this before cancelling or checking whether a session is currently being tracked.

### 7. Open the command help

Use:

```text
/help
```

For admins, this includes the full tracking command workflow.

## Recommended Discord Workflow

This is the cleanest way to use the bot during a real workshop.

### For members

1. Use `/register enrollmentno:<your enrollment number>`
2. Wait for the workshop to begin
3. Join the correct voice channel
4. Stay connected while attending
5. Leave when done

### For admins

1. Make sure the bot is online
2. Ask members to register before the event
3. Start tracking with `/tracking start` or schedule it beforehand
4. Let the event run normally
5. Stop tracking with `/tracking stop` if needed
6. Open the dashboard
7. Review attendance and export the report

## How To Open The Dashboard

The dashboard is a browser-based admin panel.

If you are running locally, open:

```text
http://localhost:3000
```

If you are using Railway or another host, open your public app URL, for example:

```text
https://your-app.up.railway.app
```

The dashboard is protected with login via browser auth.

You must enter:

- `DASHBOARD_USERNAME`
- `DASHBOARD_PASSWORD`

## Dashboard Pages

Once you open the dashboard, these are the important pages.

### 1. Server selection page

Route:

```text
/
```

What it shows:

- tracked Discord servers
- active runs
- recent activity
- tracked participant counts

Use this page to choose which server you want to inspect.

### 2. Server runs page

Route:

```text
/servers/:guildId
```

What it shows:

- all runs for that server
- scheduled runs
- active runs
- completed runs
- total participants
- total run duration

Use this page to:

- review workshop history
- open a specific run

### 3. Run detail page

Route:

```text
/servers/:guildId/runs/:id
```

What it shows:

- participants in that run
- total attendance per user
- sessions per user
- channel breakdown
- top attendees
- earliest arrivals
- latest leavers

Use this page to:

- inspect one workshop in detail
- see who actually attended
- decide what to export

### 4. Users page

Route:

```text
/servers/:guildId/users
```

What it shows:

- registered users
- enrollment numbers
- all tracked sessions
- user analytics across runs

Use this page to:

- verify registration data
- inspect attendance history across workshops

## How To Use The Dashboard

### Check whether a run was recorded

1. Open the dashboard
2. Select the server
3. Open the runs page
4. Look for the workshop title or run ID

### Inspect one workshop

1. Open the run detail page
2. Review participant summaries
3. Check total duration per participant
4. Check channel movement if needed

### Verify whether a member was registered

1. Open the users page
2. Search the registration list
3. Confirm their enrollment number

### Review attendance history across multiple workshops

1. Open the users page
2. Look at total workshops joined
3. Check average attendance percentage
4. Check total sessions and total duration

## How To Export Attendance

There are two main export types.

### 1. Export user analytics as CSV

From the users page:

- export the server user attendance summary as `CSV`

This is useful for:

- admin review
- spreadsheet work
- attendance records

### 2. Export one run as Excel

From the run detail page:

- export the workshop as `XLSX`

This is useful for:

- sharing final attendance sheets
- workshop records
- channel-by-channel breakdowns

## Real Example

Here is a practical example of how to use the system.

### Before the workshop

1. Members run:

```text
/register enrollmentno:23BCE1234
```

2. Admin checks the bot:

```text
/ping
```

3. Admin schedules the session:

```text
/tracking schedule title:UI UX Workshop start:15:00 end:17:00
```

### During the workshop

1. Members join the voice channel
2. The bot records attendance automatically
3. Admin can check progress with:

```text
/tracking status
```

### After the workshop

1. If needed, admin stops the run manually:

```text
/tracking stop
```

2. Admin opens the dashboard
3. Admin opens the workshop run
4. Admin reviews attendance
5. Admin exports the final sheet

## Common Questions

### Do members need to keep using commands during the workshop?

No. After registration, members mostly just need to join the correct voice channel while tracking is active.

### Does every member need to register?

It is strongly recommended. Without registration, attendance may still be tracked, but exports may show them as not registered instead of mapping them to enrollment numbers.

### Who can use tracking commands?

Only users with the `Manage Server` permission.

### What if an admin does not know the run ID?

Use:

```text
/tracking status
```

That shows recent runs and their IDs.

### What if the workshop start time is fixed but the ending time is not?

Use:

```text
/tracking schedule-start
```

and stop it later with:

```text
/tracking stop
```

## Quick Command Reference

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
/help
/ping
```

## Best Practices

- ask members to register before the workshop starts
- use clear run titles so exports are easy to identify
- use `/tracking status` before cancelling scheduled runs
- stop the run after the event if it was not auto-scheduled to end
- review the dashboard before exporting the final sheet

## Final Flow In One Minute

If you want the shortest possible version:

1. Members use `/register`
2. Admin uses `/tracking start` or `/tracking schedule`
3. Members join the workshop voice channel
4. Admin uses `/tracking stop` if needed
5. Admin opens the dashboard
6. Admin reviews attendance
7. Admin exports CSV or Excel
