# Elefin Exclusive Mentorship

A Next.js app that verifies Elefin broker clients and delivers mentorship videos to eligible clients on Telegram. Everything except the database connection is managed from a built-in admin panel.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, MySQL (`mysql2`)
- **Integrations:** Elefin broker API, Telegram Bot API plus Telegram Login (OpenID Connect), Resend (email OTP)

---

## How it works for clients

1. **Verify account.** The client enters their email. The server calls `GET {Elefin API base}/clients/lookup?email=…` with `Authorization: Bearer <token>` and checks the eligibility rules: minimum lots, and optionally affiliated, active status and minimum net deposit. Ineligible clients see why, with their lots against the minimum and a link to open an Elefin account.
2. **Confirm email (optional).** If email OTP is on, a 6-digit code is emailed through Resend.
3. **Connect Telegram.** The client clicks **Log in with Telegram** and approves on Telegram's page. The `telegram:bot_access` scope lets the bot message them. The server exchanges the code with your client ID and secret and verifies the signed ID token. Each email can be linked to one Telegram account, and each Telegram account to one email.
4. **Get videos.** The bot sends every active video with `copyMessage` from your private channel, in order, with your custom caption. An optional intro and outro message wrap the videos. Content protection can stop clients forwarding or saving them.

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

| Variable | Required | Description |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` | Yes | MySQL connection. |
| `SESSION_SECRET` | Yes | Long random string used to sign admin and client sessions. Changing it signs everyone out. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `DEV_EMAIL` | No | **Dev only.** When running `next dev`, every email (OTP codes, test emails) goes to this address instead of the real recipient, and the subject shows who it was meant for. It has no effect in production. |

Every other credential (Elefin token, bot token, Telegram Login secret, Resend key) is stored in the `settings` table and managed from **Admin → Settings**.

---

## Configuring the admin panel

Go to **Admin → Settings** and fill in each section. Each integration section has a **Test** button that uses the saved values.

| Section | What to set |
| --- | --- |
| **Elefin API** | API base URL, without a trailing slash (`/clients/lookup` is appended), and the API token. |
| **Eligibility** | Minimum lots, require affiliated, require active status, minimum net deposit (0 turns it off), allow re-delivery and the re-delivery cooldown. |
| **Telegram bot** | Bot token (the bot username fills in automatically), Login client ID and secret, test chat ID, messages before and after the videos, and content protection. |
| **Email verification** | Turn OTP on or off, Resend API key, from email, from name, email header text, and OTP expiry. |
| **Site** | Site name (page header, browser tab, admin sidebar, email copyright), hero title and subtitle, sign-up/referral link, support link. |

### Telegram setup

1. **Bot token:** create a bot with @BotFather and paste the token into Settings → Telegram bot.
2. **Telegram Login:** in [@BotFather](https://t.me/botfather?startapp), open your bot → **Login Widget**.
   - At the bottom of the page, click `Switch to OpenID Connect Login`
   - Copy the **client ID** (your bot's numeric ID) and the **client secret** into Settings.
   - Register the **Allowed URL** and **Redirect URI** shown at the top of Admin Panel Settings → Telegram bot, each with a Copy button. The redirect URI is `https://<your-domain>/api/telegram/callback`. Telegram only redirects to registered URLs.
3. **Video channel:** add the bot to your private video channel as an **administrator**.
4. **Test:** click **Test bot**. It confirms the token works, checks the login client ID matches the bot, and sends a message to the test chat ID if you set one.

### Adding videos

> We will use telegram to host the videos files otherwise bot will not be able to send large files directly from your server. telegram bot api limit is 20 MB for a file if not hosted on telegra but using telegram's `copyMessage` method, we can bypass this.

1. Upload the video to your private channel.
2. Right-click the message → **Copy Post Link**. It looks like `https://t.me/c/1234567890/45`.
3. In **Admin → Videos**, click **Add video** and paste the link. Saving checks that the bot is an admin of the channel. With a test chat ID set, it also sends you a test copy to prove the message can be copied.
4. Optionally add a caption. It replaces the original caption and supports Telegram HTML (`<b>`, `<i>`, `<a href>`); leave it empty to keep the original.

Drag rows to reorder. Use the **⋯** menu to edit, re-check permissions, open in Telegram, activate or deactivate, move, or delete.

---

## Admin panel

| Page | What it does |
| --- | --- |
| **Overview** | Key numbers, a setup checklist, eligibility checks over 14 days, the funnel (with a **?** that explains each stage), and recent deliveries. |
| **Videos** | The video list, with filters (All, Active, Inactive, Issues), search, drag-to-reorder and a **⋯** menu per row. |
| **Members** | Everyone who verified an email. Filter, search, view Elefin and Telegram details and delivery history. Actions: send videos now, refresh from Elefin, reset delivery, unlink Telegram, block or unblock, delete. Every action asks for confirmation. |
| **Activity logs** | Every delivery (sent or failed, with the Telegram error) and every eligibility check (result, lots, IP address). |
| **Settings** | All integrations and rules (see above). |
| **Admins** | Admin accounts and their permissions, plus **Change my password**. |

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

| Table | Contents |
| --- | --- |
| `settings` | Key/value store for every admin-panel setting. |
| `admins` | Admin accounts, password hashes, `is_super` and `permissions`. |
| `videos` | Telegram message links, captions, order, active flag and the result of the last permission check. |
| `members` | Clients who verified: Elefin data, eligibility, linked Telegram account and delivery counts. |
| `otp_codes` | Hashed one-time codes with expiry and attempt counts. |
| `deliveries` | One row per video sent to a member (sent or failed, with the error). |
| `lookup_logs` | Every eligibility check (email, result, lots, IP address). |

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
    api/deliver                   Sends the videos to the signed-in client
    api/admin/*                   Admin API (permission-checked)
  components/                     Shared UI: admin widgets, confirm dialog, toasts, tab guard
  lib/
    db.ts, schema.mjs             MySQL pool, schema and migrations
    settings.ts                   Setting definitions, defaults and help text
    permissions.ts                Admin permissions (used by server and browser)
    elefin.ts                     Elefin lookup and eligibility rules
    telegram.ts                   Bot API calls and video permission checks
    telegram-oauth.ts             Telegram Login: PKCE, token exchange, ID token check
    members.ts                    Member records, Telegram linking and video delivery
    email.ts, otp.ts              Resend emails and OTP codes
  proxy.ts                        Redirects signed-out visitors away from /admin
scripts/migrate.mjs               npm run db:migrate
```

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Client page says Telegram login isn't available | Set both **Login client ID** and **Login client secret** in Settings → Telegram bot, then refresh the page. |
| Telegram shows an error about the redirect URI | Register the exact **Redirect URI** from Settings → Telegram bot in @BotFather → Login Widget, and open the site on that same domain. |
| A video shows **Needs attention** | Make sure the bot is an **administrator** of the channel, then click **Check permissions** in the video's ⋯ menu. The full error is in the status tooltip. |
| "The bot can't message you" during delivery | The client must approve messages from the bot when logging in with Telegram, or open the bot and press **Start**. |
| No OTP email arrives | Check the Resend key and that the **From email** is on a domain verified in Resend. Use **Send test** in Settings. In dev, look in the `DEV_EMAIL` inbox. |
| `npm run build` fails reading the config or tsconfig paths | Keep TypeScript on version 5 (`typescript@5`); Next 16 doesn't support TypeScript 7 yet. |
# Exclusive-videos
