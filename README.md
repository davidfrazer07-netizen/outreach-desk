# Outreach Desk

Cold email sequences sent from your own mailboxes. It has A/B templates, follow-ups that branch on opened or not opened, a daily limit per mailbox, and an alert for every reply.

- **Dashboard**: a static site on GitHub Pages (`app/`)
- **Engine**: a GitHub Actions job that runs every 15 minutes (`engine/`). It sends over SMTP, checks each inbox over IMAP for replies and bounces, and emails you (plus an optional ntfy push) for each reply
- **Open tracking and unsubscribes**: a small Cloudflare Worker on the free plan (`worker/`)
- **Data**: `data/*.enc.json`, encrypted with AES-256-GCM using your passphrase. The repo is public, so nothing readable is committed. Mailbox passwords go into GitHub Actions secrets, never into the repo

## Setup (about 15 minutes)

1. **Token.** Create a fine-grained personal access token at GitHub → Settings → Developer settings. Limit it to this repository, with **Contents**, **Actions** and **Secrets** set to read and write.
2. **Open the dashboard** at `https://<owner>.github.io/outreach-desk/`. Enter the token and choose a passphrase of 12 or more characters. The dashboard creates your encrypted config and saves the passphrase as the `OUTREACH_PASSPHRASE` secret for the engine.
3. **Add mailboxes** (Mailboxes → Add mailbox). For Gmail or Workspace, turn on 2-step verification and create an app password. The password is stored in a numbered secret (`MAILBOX_1` to `MAILBOX_20`), so up to 20 mailboxes are supported.
4. **Open tracking** (optional, but the opened and not-opened branches need it):
   ```sh
   cd worker
   npx wrangler login
   npx wrangler kv namespace create EVENTS   # paste the id into wrangler.toml
   npx wrangler deploy                       # prints https://outreach-tracker.<you>.workers.dev
   ```
   In Settings, paste that URL into Tracker URL, then click **Create token** and run the `wrangler secret put TRACKER_TOKEN` command it shows.
5. Upload a CSV with the columns `First name, Last name, company, email, Industry, Phone num`. Write templates, build a sequence, set it to Active, and use **Dry run** in Settings to check the plan before anything is sent.

## How sending works

- The send window and days are set in Settings, in your time zone.
- Each run spreads the rest of each mailbox's daily limit over the hours left in the window, and sends follow-ups before new contacts.
- After the first email, a contact who opens moves to the **If opened** track, which waits its own delay from the last email. If there is no open after the first **If not opened** delay, the contact moves to that track instead.
- A reply, bounce or unsubscribe stops the sequence. Out-of-office auto-replies are logged, and the sequence carries on.
- Leave a follow-up template's subject blank to send it as a reply in the same thread.

## Limits worth knowing

- GitHub's scheduled runs can start a few minutes late, and they pause after 60 days without repo activity. Engine commits count as activity.
- Apple Mail Privacy Protection opens tracking pixels automatically, so open rates for Apple Mail users read high.
- Cloudflare KV's free tier allows 1,000 writes a day, which is roughly 1,000 opens and unsubscribes a day.
- Follow the cold email laws that apply to you: keep the unsubscribe line on and add your postal address in Settings.

## Development

```sh
npm install
npm test          # core + engine tests
npm run build     # syntax and import check
npm run serve     # http://localhost:5173, use "Try with sample data"
```
