# MUPC Bot Tutorial

This guide walks through the full setup and usage of the MUPC Discord Webinar Attendance Bot and its dashboard.

It covers:

- what the bot does
- how to create the Discord application
- how to run the bot locally
- how to use the dashboard
- how to deploy it on Railway
- how to stop the bot when you do not need it

## 1. What this project does

This project is a combined system made of:

- a `Discord bot` that watches voice channel activity
- an `Express dashboard` for admins
- a local `SQLite` database that stores attendance data

You use it when you want to:

- track attendance for Discord webinars or workshops
- see who joined which voice channel
- measure how long each member stayed
- export attendance sheets

## 2. What you need before starting

Make sure you have:

- `Node.js` installed
- a `Discord account`
- a `Discord server` where you can invite a bot
- the bot token and client ID from the Discord Developer Portal

## 3. Create the Discord bot

### Step 1: Create an application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click `New Application`
3. Give it a name
4. Open the new application

### Step 2: Create the bot user

1. Open the `Bot` section
2. Click `Add Bot`
3. Copy the bot token and keep it private

Important:

- never share the token publicly
- if the token is ever exposed, regenerate it immediately

### Step 3: Enable required intents

In the `Bot` page, enable:

- `Server Members Intent`
- `Guild Voice States Intent`

These are required for attendance tracking.

### Step 4: Invite the bot to your server

In the `OAuth2` -> `URL Generator` section:

1. Select the `bot` scope
2. Select the `applications.commands` scope
3. Give it permissions such as `View Channels`, `Send Messages`, and `Read Message History`

Then open the generated invite link and add the bot to your server.

## 4. Local project setup

### Step 1: Install dependencies

From the project folder, run:

```bash
npm install
```

### Step 2: Configure environment variables

Create a `.env` file in the project root with:

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
PORT=3000
SESSION_SECRET=replace-with-a-long-random-secret
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=replace-with-a-strong-password
DATABASE_PATH=./data/attendance.sqlite
```

What each variable does:

- `DISCORD_TOKEN`: logs the bot into Discord
- `CLIENT_ID`: used for Discord application command registration
- `PORT`: dashboard port
- `SESSION_SECRET`: internal secret value for the app
- `DASHBOARD_USERNAME`: dashboard login username
- `DASHBOARD_PASSWORD`: dashboard login password
- `DATABASE_PATH`: SQLite file location

### Step 3: Run in development

```bash
npm run dev
```

### Step 4: Build and run in production mode

```bash
npm run build
npm start
```

If everything is correct:

- the bot logs into Discord
- the dashboard starts on `http://localhost:3000`

## 5. How to open the dashboard

The dashboard is protected with `HTTP Basic Auth`.

When you visit:

```text
http://localhost:3000
```

your browser will ask for:

- username = `DASHBOARD_USERNAME`
- password = `DASHBOARD_PASSWORD`

After login, the dashboard shows tracked servers and attendance data.

## 6. How to use the bot and dashboard

This is the normal workflow for a webinar.

### Step 1: Add the bot to the server

Make sure the bot has joined the server where your webinar voice channels exist.

### Step 2: Start the app

Run the project locally or from Railway so both the bot and dashboard are online.

### Step 3: Open the dashboard

Visit:

```text
http://localhost:3000
```

or your Railway public URL if deployed online.

### Step 4: Log into the dashboard

Enter the dashboard username and password from your environment variables.

### Step 5: Create or select a tracking run

Inside the dashboard, you can manage webinar runs for a server.

You should:

- choose the correct Discord server
- create or schedule a run
- make sure the webinar is associated with the intended voice activity

### Step 6: Start tracking

When the webinar begins:

- start tracking from the dashboard or command flow supported by the app
- the bot begins recording joins, leaves, and channel movement

What gets tracked:

- user ID
- username
- channel name
- join time
- leave time
- total attendance duration

### Step 7: Let the webinar run

While the session is active:

- members who join voice channels are recorded
- members who leave are closed out in the database
- users moving across channels are tracked properly

### Step 8: Stop tracking

When the webinar ends:

- stop the active run
- attendance is finalized

### Step 9: Review attendance

Use the dashboard to inspect:

- recent runs
- per-run attendance
- participant summaries
- user analytics
- channel summaries

### Step 10: Export attendance

The dashboard supports exports such as:

- `CSV` for user attendance summaries
- `XLSX` for per-run attendance exports

This is useful for:

- admin records
- proof of participation
- reporting
- sharing attendance sheets with coordinators

## 7. Example webinar workflow

Here is a simple real-world usage flow:

1. Start the bot and dashboard
2. Open the dashboard in the browser
3. Log in with the dashboard credentials
4. Pick the Discord server
5. Create or start a run for the webinar
6. Let attendees join the voice channels
7. Stop the run after the event
8. Open the run details page
9. Export attendance as CSV or Excel

## 8. Hosting on Railway

This project can be hosted on Railway as a single service.

### Step 1: Push the code to GitHub

Make sure your project is in a GitHub repository.

### Step 2: Create a Railway project

1. Sign in to [Railway](https://railway.com/)
2. Create a new project
3. Deploy from GitHub
4. Select this repository

### Step 3: Add Railway variables

In the Railway service variables, add:

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
SESSION_SECRET=replace-with-a-long-random-secret
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=replace-with-a-strong-password
DATABASE_PATH=./data/attendance.sqlite
PORT=3000
```

### Step 4: Deploy

Railway should build and start the app automatically.

When successful:

- the bot comes online
- the dashboard is available on the Railway public domain

### Step 5: Open the hosted dashboard

Use the generated Railway URL, for example:

```text
https://your-service.up.railway.app/
```

Then log in with:

- `DASHBOARD_USERNAME`
- `DASHBOARD_PASSWORD`

## 9. Important hosting note

This project uses:

- a long-running Discord gateway connection
- a local SQLite database

That means:

- it is better suited to always-on hosting
- free sleeping hosts may disconnect the bot
- Railway is a better fit than services that idle aggressively

## 10. How to stop the bot

If you are running locally:

- stop the terminal process with `Ctrl + C`

If you are running on Railway:

- stop the service from Railway if available
- or remove the `DISCORD_TOKEN` temporarily and redeploy
- or scale the service down if your plan supports it

## 11. Common problems

### Missing `DISCORD_TOKEN`

If you see:

```text
Missing required environment variable: DISCORD_TOKEN
```

it means your env vars are not configured correctly.

Fix:

- check `.env` locally
- check Railway variables if hosted
- redeploy after changing variables

### Dashboard asks for login repeatedly

This usually means:

- the username is wrong
- the password is wrong

Use the values from:

- `DASHBOARD_USERNAME`
- `DASHBOARD_PASSWORD`

### Bot is online but nothing is tracked

Check:

- the bot is in the correct server
- required Discord intents are enabled
- members are joining voice channels
- tracking is actually active for the webinar

### Bot stops working on cheap or free hosting

This usually happens because:

- the host sleeps the app
- the service crashed
- the usage limit was reached

## 12. Recommended security basics

- keep `.env` out of GitHub
- never commit bot tokens
- use a strong dashboard password
- rotate the token if it is ever exposed

## 13. Quick start summary

If you want the shortest version:

1. Create the Discord bot
2. Enable required intents
3. Invite the bot to your server
4. Add your `.env` values
5. Run `npm install`
6. Run `npm run build`
7. Run `npm start`
8. Open `http://localhost:3000`
9. Log into the dashboard
10. Start tracking your webinar

## 14. Final note

This project works best when treated like a small attendance platform, not just a chat bot.

Run the bot, keep the dashboard credentials safe, start tracking before the webinar begins, and export the report once the session is over.
