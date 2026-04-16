# MUPC Attendance Bot Tutorial

This file is meant for club cores and heads who will actually use the bot during workshops.

The bot has two parts:

- the Discord bot, which tracks the attendance in voice channels
- the dashboard, where the core/head can review and export the records

If you are a student attending a workshop, you will mostly use one command: `/register`.

If you are managing the workshop, you will use the tracking commands and the dashboard.

## What the bot is used for

The bot records attendance for voice-based workshops held in Discord.

Once tracking is active, it keeps a record of:

- who joined
- when they joined
- when they left
- how long they stayed

After the session, the dashboard can be used to review the attendance and export it.

## Two roles: members and the core/head

Most people using this bot fall into one of these two groups.

### Members

Members are the students attending the session. They only need to:

1. register their enrollment number once
2. join the voice channel when the workshop starts
3. stay in the channel while attending

### the core/head

the core/head are the people running the session. They need to:

1. start or schedule tracking
2. stop tracking when the workshop ends if needed
3. open the dashboard
4. review and export the attendance

## Part 1: What members need to do

### Register your enrollment number

Before attendance can be exported properly, every student should register their enrollment number in the server.

Use this command:

```text
/register enrollmentno:<your enrollment number>
```

Example:

```text
/register enrollmentno:<your actual enrollment number>
```

This links your Discord account to your enrollment number for that server.
The bot saves enrollment numbers in uppercase automatically, so `en24cs3010238` becomes `EN24CS3010238`.
Use the same enrollment number format that appears in the student data sheets. Example: `EN24CS3010238`.

You only need to do this once per server unless something changes.

If the bot says the enrollment number is already taken, it means that number is already linked to another Discord account in the same server.

### Check whether the bot is online

If you want to check whether the bot is responding, use:

```text
/ping
```

If the bot replies, it is working.

### Get the built-in help message

Use:

```text
/help
```

This gives a short explanation of the commands available to you.

### During the workshop

Once the coordinator has started attendance tracking, members do not need to keep entering commands.

Just:

1. join the correct voice channel
2. stay in the voice channel while attending
3. leave when the session is over

The bot handles the attendance automatically.

## Part 2: What the core/head need to do

To use the tracking commands, you need the `Manage Server` permission in Discord.

### Start tracking immediately

If the workshop is starting right now, use:

```text
/tracking start
```

You can also add a title:

```text
/tracking start title:Web Development Workshop
```

This creates a new tracking run and starts recording attendance immediately.

### Stop the active tracking run

When the workshop ends, use:

```text
/tracking stop
```

This closes the current run so the final attendance can be reviewed in the dashboard.

### Schedule a workshop with both start and end time

If you already know the full time window, use:

```text
/tracking schedule title:<name> start:<HH:mm> end:<HH:mm>
```

Example:

```text
/tracking schedule title:DSA Workshop start:14:00 end:16:00
```

This tells the bot to start and stop automatically.

### Schedule only the start time

Sometimes the start time is fixed but the end time is uncertain. In that case, use:

```text
/tracking schedule-start title:<name> start:<HH:mm>
```

Example:

```text
/tracking schedule-start title:Placement Seminar start:10:00
```

This starts the run automatically at the given time, but you will still need to stop it manually with:

```text
/tracking stop
```

### Cancel a scheduled run

If a workshop is postponed or the wrong schedule was created, use:

```text
/tracking cancel runid:<id>
```

Example:

```text
/tracking cancel runid:12
```

To find the run ID, use `/tracking status`.

### Check the current tracking status

Use:

```text
/tracking status
```

This shows:

- the active run, if there is one
- recent runs
- scheduled runs
- run IDs

This command is especially useful before cancelling a scheduled run or checking whether tracking is already active.

### Show mismatched registrations

If you want to review members whose saved enrollment numbers do not match the current student data, use:

```text
/show mismatched
```

This shows an admin-only embed with the members who need to fix their registration.
It posts the list in Discord as embeds so the core/head can review it quickly.

### Deregister a member

If a member registered the wrong enrollment number or needs to be removed, an admin can use:

```text
/deregister member user:<user>
```

This removes that member's saved enrollment number for the current server.

### Deregister all mismatched registrations

If you want to bulk-remove only the registrations that do not match the student data, use:

```text
/deregister mismatched
```

This does three things:

1. removes those mismatched registrations from the current server
2. sends each affected member a direct message explaining why
3. tells them to register again using the correct format

### Open the help message

Use:

```text
/help
```

For the core/head, the help command includes the full admin command set.

## Recommended workshop flow

This is the easiest way to use the bot during a real session.

### Before the workshop

1. Ask students to register using `/register enrollmentno:<their enrollment number>`
2. Confirm that the bot is online with `/ping`
3. Start or schedule tracking

### During the workshop

1. Students join the voice channel
2. The bot records attendance in the background
3. If needed, check progress using `/tracking status`

### After the workshop

1. Stop the run with `/tracking stop` if it was not already scheduled to end
2. Open the dashboard
3. Review the attendance
4. Export the final file
5. If needed, use the mismatched export to clean incorrect registrations

## Part 3: Using the dashboard

The dashboard is the admin side of the project. It is where attendance is reviewed after the bot has done the tracking.

### Opening the dashboard

If you are running the project locally, open:

```text
http://localhost:3000
```

If the project is hosted online, open the deployed URL instead.

### Users DB page

The Users DB page now shows:

- registered members
- unmatched registrations
- raw session rows
- user attendance summaries

It also has two export buttons:

- `Download Users Excel`
- `Download Mismatched Data`

For example:

```text
https://your-app.up.railway.app
```

When you open the dashboard, the browser will ask for login credentials.

Use:

- the dashboard username
- the dashboard password

These are the values set in the environment variables as `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`.

### Main dashboard pages

The dashboard is simple, but it helps to know what each page is for.

#### 1. Server page

This is the first page you see.

It shows:

- the Discord servers that already have attendance data
- recent activity
- active runs

Use this page to choose which server you want to inspect.

#### 2. Runs page

After opening a server, you will see its runs.

This page shows:

- all workshop runs for that server
- whether a run is active, scheduled, or completed
- participant counts
- total run duration

Use this page to pick a specific workshop.

#### 3. Run detail page

This is the most important page after a session.

It shows:

- all participants in that run
- how long each person attended
- how many sessions they had
- channel-wise details
- top attendees and participation patterns

Use this page when you want to review a single workshop carefully.

#### 4. Users page

This page shows the broader attendance history for the server.

It includes:

- registered users
- enrollment numbers
- tracked sessions
- user analytics across runs

Use this page when you want to check whether someone registered correctly or review attendance across multiple workshops.

## Part 4: Exporting attendance

The dashboard supports two main exports.

### Export user analytics as CSV

From the users page, you can export the server's user attendance summary as CSV.

This is useful when you want:

- a spreadsheet-friendly summary
- a quick report for records
- attendance data across multiple runs

### Export a specific run as Excel

From the run detail page, you can export that workshop as an Excel file.

This is useful when you want:

- the final attendance sheet for one event
- a workshop-specific report
- a file that can be shared directly with the core/head or faculty

## A complete example

Here is a typical example of how the bot would be used for a real workshop.

### Before the session

Students register:

```text
/register enrollmentno:<your actual enrollment number>
```

Coordinator checks the bot:

```text
/ping
```

Coordinator schedules the workshop:

```text
/tracking schedule title:UI UX Workshop start:15:00 end:17:00
```

### During the session

- students join the voice channel
- the bot records attendance
- the coordinator can check the run using `/tracking status`

### After the session

- if needed, the coordinator stops tracking manually
- the coordinator opens the dashboard
- the coordinator opens the run
- the attendance is reviewed
- the file is exported

## Quick command reference

### Member commands

```text
/register enrollmentno:<your enrollment number>
/help
/ping
```

### Coordinator commands

```text
/tracking start [title]
/tracking stop
/tracking schedule title:<name> start:<HH:mm> end:<HH:mm>
/tracking schedule-start title:<name> start:<HH:mm>
/tracking cancel runid:<id>
/tracking status
/deregister member:<user>
/help
/ping
```

## Common doubts

### Do students need to keep using commands during the workshop?

No. After registration, students only need to be in the right voice channel while tracking is active.

### Do all students need to register?

Yes, if you want the exported attendance to map cleanly to enrollment numbers.

### What if a coordinator forgets the run ID?

Use:

```text
/tracking status
```

That will show recent runs and their IDs.

### What if the workshop start time is known but the ending time is not?

Use:

```text
/tracking schedule-start
```

and stop it manually later with:

```text
/tracking stop
```

## Final note

The easiest way to think about this bot is:

- students register once and then just join the voice channel
- the core/head start or schedule the run
- the dashboard is used afterward to review and export attendance

If everyone follows that flow, the bot is straightforward to use.
