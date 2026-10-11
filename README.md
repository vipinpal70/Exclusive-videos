# Elefin Exclusive Mentorship

A Next.js app that verifies Elefin broker clients and delivers mentorship videos to eligible clients on Telegram. Everything except the database connection is managed from a built-in admin panel.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, MySQL (`mysql2`)
- **Integrations:** Elefin broker API, XM partners API, CoinSwitch affiliate leads API, Telegram Bot API plus Telegram Login (OpenID Connect), Resend (email OTP)

---

## How it works for clients

1. **Verify account.** The client enters their email. The server calls `GET {Elefin API base}/clients/lookup?email=…` with `Authorization: Bearer <token>` and checks the eligibility rules: minimum lots, and optionally affiliated, active status and minimum net deposit. Ineligible clients see why, with their lots against the minimum and a link to open an Elefin account.
2. **Confirm email (optional).** If email OTP is on, a 6-digit code is emailed through Resend.
3. **Connect Telegram.** The client clicks **Log in with Telegram** and approves on Telegram's page. The `telegram:bot_access` scope lets the bot message them. The server exchanges the code with your client ID and secret and verifies the signed ID token. Each email can be linked to one Telegram account, and each Telegram account to one email.
4. **Get videos.** The client sees the list of videos, each with a **Get** button, plus **Get all**. The bot sends each one with `copyMessage` from your private channel, with your custom caption. **Get all** also sends the optional intro and outro messages. Re-delivery and cooldown rules apply **per video**, so newly added videos can always be requested.
5. **Bot not started yet?** If Telegram answers _chat not found_ or _bot can't initiate conversation_, the website saves the request and sends the client to `t.me/<bot>?start=video`. When they press **Start**, the bot webhook sends the requested videos. In the bot, `/videos` shows the same list with inline **Get** buttons.

---

## Getting started

### Requirements

- Node.js 20 or newer
- A MySQL 8 database
- A Telegram bot from [@BotFather](https://t.me/botfather), and a private channel holding the videos
- An Elefin API base URL and token
- Optional: a [Resend](https://resend.com) account with a verified domain, for email OTP

### Install and run

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run db:migrate           # creates and updates the tables
npm run dev
```

Open `http://localhost:3000/admin`. The first visit goes to `/admin/setup`, where you create the first admin. That account is the **super admin**. The setup page locks after use.

> The app also creates any missing tables and columns automatically on its first database query, so `db:migrate` is optional. It just shows you the result up front.

### Environment (`.env.local`)

| Variable                                              | Required | Description                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` | Yes      | MySQL connection.                                                                                                                                                                                           |
| `SESSION_SECRET`                                      | Yes      | Long random string used to sign admin and client sessions. Changing it signs everyone out. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.                    |
| `DEV_EMAIL`                                           | No       | **Dev only.** When running `next dev`, every email (OTP codes, test emails) goes to this address instead of the real recipient, and the subject shows who it was meant for. It has no effect in production. |

Every other credential (Elefin token, bot token, Telegram Login secret, Resend key) is stored in the `settings` table and managed from **Admin → Settings**.

---

## Configuring the admin panel

Go to **Admin → Settings** and fill in each section. Each integration section has a **Test** button that uses the saved values.

| Section                | What to set                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Elefin API**         | API base URL, without a trailing slash (`/clients/lookup` is appended), and the API token.                                                                                                           |
| **Eligibility**        | Minimum lots, require affiliated, require active status, minimum net deposit (0 turns it off), and per-video re-delivery: whether each video can be requested again, and the cooldown before it can. |
| **Telegram bot**       | Bot token (the bot username fills in automatically), Login client ID and secret, test chat ID, messages before and after the videos, and content protection.                                         |
| **Email verification** | Turn OTP on or off, Resend API key, from email, from name, email header text, and OTP expiry.                                                                                                        |
| **Site**               | Site name (page header, browser tab, admin sidebar, email copyright), hero title and subtitle, sign-up/referral link, support link.                                                                  |

### Telegram setup

1. **Bot token:** create a bot with @BotFather and paste the token into Settings → Telegram bot.
2. **Telegram Login:** in [@BotFather](https://t.me/botfather?startapp), open your bot → **Login Widget**.
   - At the bottom of the page, click `Switch to OpenID Connect Login`
   - Copy the **client ID** (your bot's numeric ID) and the **client secret** into Settings.
   - Register the **Allowed URL** and **Redirect URI** shown at the top of Admin Panel Settings → Telegram bot, each with a Copy button. The redirect URI is `https://<your-domain>/api/telegram/callback`. Telegram only redirects to registered URLs.
3. **Video channel:** add the bot to your private video channel as an **administrator**.
4. **Webhook:** open the admin panel on your public HTTPS address (your domain, or ngrok in development) and click **Connect webhook** under Settings → Telegram bot. This points the bot at `/api/bot/webhook` with a secret token and sets the `/videos` command. Click **Reconnect** if you change the bot token or domain.
5. **Test:** click **Test bot**. It confirms the token works, checks the login client ID matches the bot, and sends a message to the test chat ID if you set one.

### Adding videos

> We will use telegram to host the videos files otherwise bot will not be able to send large files directly from your server. telegram bot api limit is 20 MB for a file if not hosted on telegra but using telegram's `copyMessage` method, we can bypass this.

1. Upload the video to your private channel.
2. Right-click the message → **Copy Post Link**. It looks like `https://t.me/c/1234567890/45`.
3. In **Admin → Videos**, click **Add video** and paste the link. Saving checks that the bot is an admin of the channel. With a test chat ID set, it also sends you a test copy to prove the message can be copied.
4. Optionally add a caption. It replaces the original caption and supports Telegram HTML (`<b>`, `<i>`, `<a href>`); leave it empty to keep the original.

Drag rows to reorder. Use the **⋯** menu to edit, re-check permissions, open in Telegram, activate or deactivate, move, or delete.

---

## XM broker (optional)

Turn on **Settings → XM broker → Allow XM clients** to let XM clients verify with their **MT5 account ID**. XM's API has no emails, so XM clients skip the email OTP step. Their Telegram account is still linked one-to-one.

| Setting                         | Meaning                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API base URL / token            | XM partners API (`https://mypartners.xm.com/api`), sent as `Authorization: Bearer <token>`. Stored only in the database.                                                          |
| Minimum lots + lots window      | Lots the account must have traded in the last N days (max 365). XM returns at most 93 days per request, so longer windows take a few requests.                                    |
| Reject archived                 | Uses the `archived` flag from XM's trader lookup. Accounts must always be `validated` (XM's affiliation flag); a non-validated account is treated as not under your partner link. |
| Require balance above threshold | Uses XM's balance threshold indicator. The threshold itself is agreed with XM.                                                                                                    |
| XM sign-up link                 | Shown to XM clients who aren't under your affiliation or aren't eligible yet.                                                                                                     |

XM endpoints used: `GET /traders/{loginId}` (affiliation check; 404 means not yours), `GET /trader-statistics/trades` (filtered by `traderIds`, at most 93 days per request) and `GET /trader-balance?traderIds=…`.

**Bulk block and unblock for XM** use a broker switch in the dialog. XM rules are **(hasn't) traded in the last N days** and **balance below / at or above XM's threshold**. They check only your XM members, in batches of 50 accounts. XM doesn't share deposit history, so there is no deposit rule for XM.

## CoinSwitch (optional)

Turn on **Settings → CoinSwitch → Allow CoinSwitch clients** to let CoinSwitch clients verify with their **client ID and phone number**. CoinSwitch's leads only include the last 4 digits of the phone, so the app matches the client ID and checks those digits. The full phone number is saved on the member. Both "unknown client ID" and "wrong phone" get the same message, so client IDs can't be probed.

**Access token (renew every 24 hours).** In Settings → CoinSwitch, click **Get access token**: enter your partner phone number, the SMS code, then your PIN. The token is saved in the database and lasts 24 hours; the PIN is never stored. The panel and the Overview page show when it expires. **Tip:** add a repeating reminder in your calendar app (or any reminder app) to go off every 20 to 23 hours, so you can refresh the token before it expires.

**Lead list.** CoinSwitch has no single-client lookup, so the app keeps a server-side copy of your leads (`cs_leads`, 500 per page from `GET https://coinswitch.co/pro/api/v1/affiliate/leads`). **Sync leads now** refreshes it with progress. When someone verifies and isn't in the saved list, the app fetches the latest leads first, if the list is older than the refresh setting. The website endpoint only ever returns the current user's own result. While the token is expired, clients already in the saved list can still verify.

**Eligibility switches:** require KYC completed, bank account added, a deposit, and/or a trade (trade is on by default). A step counts as **not done** when its status is `NOT_STARTED`, `PENDING`, contains `PROGRESS` (for example `IN_PROGRESS`), is `false`, `0`, `no` or `none`, or is empty. Any other status counts as completed. The panel lists the status values CoinSwitch actually sends.

**Bulk block and unblock for CoinSwitch:** rules are **no activity / activity in the last N days** (from `last_activity_date`), plus **hasn't deposited / has deposited** and **hasn't traded / has traded**. It refreshes the lead list first. If CoinSwitch can't be reached (for example an expired token), you can continue with the saved list.

## Admin panel

| Page              | What it does                                                                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**      | Key numbers, a setup checklist, eligibility checks over 14 days, the funnel (with a **?** that explains each stage), and recent deliveries.                                                                                                                                                                      |
| **Videos**        | The video list, with filters (All, Active, Inactive, Issues), search, drag-to-reorder and a **⋯** menu per row.                                                                                                                                                                                                  |
| **Members**       | Everyone who verified an email. Filter, search, view Elefin and Telegram details and delivery history. Actions: send videos now, refresh from Elefin, reset delivery, unlink Telegram, block or unblock, delete. Every action asks for confirmation. **Bulk send videos** sends to everyone at once (see below). |
| **Activity logs** | Every delivery (sent or failed, with the Telegram error) and every eligibility check (result, lots, IP address).                                                                                                                                                                                                 |
| **Settings**      | All integrations and rules (see above).                                                                                                                                                                                                                                                                          |
| **Admins**        | Admin accounts and their permissions, plus **Change my password**.                                                                                                                                                                                                                                               |

### Bulk send

**Members → Bulk send videos** sends videos to every eligible, unblocked member who has Telegram linked. It needs the **Bulk send videos** permission.

- **Send all videos** off (the default): each member gets only the videos they have never received.
- **Send all videos** on: every active video goes to everyone again, ignoring what they already received and any cooldown.
- The dialog shows how many members and messages are involved before you start, and the confirmation repeats it.
- Sending runs from your browser at **20 messages per second**, with live progress: sent, failed, bot not started and skipped counts, rate and time left. **Stop** ends it after the current batch.
- **Keep the tab open while it runs.** Closing the tab shows the browser's leave warning. The back button and sidebar links ask before leaving, and leaving stops the send.
- Members who haven't started the bot are counted as **Bot not started**. They can still get their videos from the website. Every message is recorded in **Activity logs**.

### Bulk block and bulk unblock

**Members → Bulk block** blocks members who have gone inactive at Elefin. It needs the **Edit members** permission.

1. Set one or both rules: **hasn't traded in the last N days** and **hasn't deposited in the last N days**. An empty field means the rule isn't used, and at least one is required. With both, choose whether a member must match **both** rules or **either** one. Members with no trade or deposit on record count as inactive.
2. **Collect data from Elefin** loads every funded client from `GET /clients?funded_only=1` (200 per page) with a progress bar. If a page fails, you can retry from that page.
3. Review the counts: **will be blocked**, **safe**, **not registered here** (Elefin clients who never verified on this site), **already blocked**, and members missing from Elefin's funded list (left unchanged). Change the rules to recount instantly, without loading again.
4. **Block N members** asks for confirmation, then blocks them. Unblock anyone from their ⋯ menu.

**Members → Bulk unblock** works the same way in reverse, for blocked members who are active again. Its rules are **traded in the last N days** and **deposited in the last N days**. It defaults to **either rule matches**, and members with no trade or deposit on record don't meet a rule. If nobody is blocked, it says so without loading anything from Elefin. If no blocked member meets the rules, the review says so too.

### Admins and permissions

Permissions are set per admin, not through roles. They're checked against the database on every request, so changes take effect immediately, even for admins who are signed in.

- **Super admin:** every permission, plus adding, editing and deleting any admin. The first admin created at setup is a super admin.
- **Read only** (the default for new admins): can view every page but can't change anything.
- **Edit permissions:** individual switches give limited edit access:
  - Edit Elefin API settings
  - Edit eligibility rules
  - Edit OTP email settings
  - Edit site settings
  - Edit Telegram bot settings
  - Add and edit videos
  - Edit members (send videos, reset delivery, unlink, block, delete)
  - Bulk send videos

To prevent lock-outs, you can't remove your own super admin access or delete yourself, and there is always at least one super admin. Pages hide or lock controls an admin can't use, and Settings sections they can't edit show **View only**.

### Signing in

- **Remember me** checked: stay signed in on that browser for 30 days.
- **Remember me** unchecked (the default): the login works only in the tab where you signed in. Other tabs are signed out, and the login ends when the browser closes (after 12 hours at most).
- Signing out asks for confirmation.

---

## Local development with Telegram Login

Telegram only redirects to a public HTTPS URL you've registered, so Telegram Login won't work on `http://localhost`. Use a tunnel such as [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

1. Add the tunnel's host to `allowedDevOrigins` in [next.config.mjs](next.config.mjs). Use the hostname only, without `https://`.
2. Open the **admin panel through the tunnel URL**. Settings → Telegram bot then shows the tunnel's Allowed URL and Redirect URI; register both in @BotFather.
3. Open the client page through the tunnel URL too. ngrok's free plan may show its own warning page first; click through it.

With `DEV_EMAIL` set, OTP emails go to your own inbox while you test.

---

## Deploying to production

```bash
npm install
npm run build
npm start          # serves on port 3000; set PORT to change
```

- Serve it over **HTTPS** on your real domain, and register that domain's Allowed URL and Redirect URI in @BotFather.
- Behind a reverse proxy (Nginx, Caddy, Cloudflare), forward `Host` and/or `X-Forwarded-Host` and `X-Forwarded-Proto`. The app uses them to build the Telegram redirect URI.
- `DEV_EMAIL` is ignored in production.
- Session cookies are `Secure` in production, so the site must be served over HTTPS.

---

## Security notes

- Secrets saved in Settings are never sent back to the browser; the admin panel shows them masked.
- Telegram Login uses the authorization code flow with PKCE, `state` and `nonce`. ID tokens are checked against Telegram's public keys, issuer, audience and expiry.
- Client email checks are rate-limited per IP. OTP codes are stored hashed, expire, allow 5 attempts, have a 60-second resend cooldown, and are limited to 5 per hour per email.
- Admin sign-in locks for 15 minutes after 5 failed attempts. Passwords are hashed with bcrypt.

---

## Database

Created and updated automatically (`npm run db:migrate`, or on first query):

| Table         | Contents                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings`    | Key/value store for every admin-panel setting.                                                                                                                         |
| `admins`      | Admin accounts, password hashes, `is_super` and `permissions`.                                                                                                         |
| `videos`      | Telegram message links, captions, order, active flag and the result of the last permission check.                                                                      |
| `members`     | Clients who verified: Elefin data, eligibility, linked Telegram account, delivery counts, videos waiting for the bot to be started, and the last admin delivery reset. |
| `otp_codes`   | Hashed one-time codes with expiry and attempt counts.                                                                                                                  |
| `deliveries`  | One row per video sent to a member (sent or failed, with the error).                                                                                                   |
| `lookup_logs` | Every eligibility check (email, result, lots, IP address).                                                                                                             |

---

## Project structure

```
src/
  app/
    page.tsx, flow.tsx            Client page (verify → OTP → Telegram → get videos)
    admin/login, admin/setup      Admin sign-in and first-time setup
    admin/(panel)/                Admin pages: overview, videos, members, logs, settings, admins
    api/verify/*                  Email check, OTP verify and resend
    api/telegram/start|callback   Telegram Login (OpenID Connect)
    api/videos, api/deliver       The client's video list, and sending selected videos (or all)
    api/bot/webhook               Telegram bot webhook (/start, /videos, inline Get buttons)
    api/admin/*                   Admin API (permission-checked)
  components/                     Shared UI: admin widgets, confirm dialog, toasts, tab guard
  lib/
    db.ts, schema.mjs             MySQL pool, schema and migrations
    settings.ts                   Setting definitions, defaults and help text
    permissions.ts                Admin permissions (used by server and browser)
    elefin.ts                     Elefin lookup and eligibility rules
    telegram.ts                   Bot API calls and video permission checks
    telegram-oauth.ts             Telegram Login: PKCE, token exchange, ID token check
    bot.ts                        Bot replies: video list, Get buttons, sending pending videos
    members.ts                    Member records, Telegram linking and video delivery
    email.ts, otp.ts              Resend emails and OTP codes
  proxy.ts                        Redirects signed-out visitors away from /admin
scripts/migrate.mjs               npm run db:migrate
```

---

## Troubleshooting

| Problem                                                    | Fix                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client page says Telegram login isn't available            | Set both **Login client ID** and **Login client secret** in Settings → Telegram bot, then refresh the page.                                                |
| Telegram shows an error about the redirect URI             | Register the exact **Redirect URI** from Settings → Telegram bot in @BotFather → Login Widget, and open the site on that same domain.                      |
| The bot doesn't reply to /start or /videos                 | Settings → Telegram bot → **Bot webhook** must say **Connected**. Open the admin through your public HTTPS address and click **Connect webhook**.          |
| A video shows **Needs attention**                          | Make sure the bot is an **administrator** of the channel, then click **Check permissions** in the video's ⋯ menu. The full error is in the status tooltip. |
| "The bot can't message you" during delivery                | The client must approve messages from the bot when logging in with Telegram, or open the bot and press **Start**.                                          |
| No OTP email arrives                                       | Check the Resend key and that the **From email** is on a domain verified in Resend. Use **Send test** in Settings. In dev, look in the `DEV_EMAIL` inbox.  |
| `npm run build` fails reading the config or tsconfig paths | Keep TypeScript on version 5 (`typescript@5`); Next 16 doesn't support TypeScript 7 yet.                                                                   |
