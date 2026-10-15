# Village OS setup prompt

Copy everything below the line and paste it into your own AI assistant: one
that can read files and run commands on your computer, such as Claude Code, or
any assistant with a terminal. You do not need to know how to code. The
assistant explains every step and runs a command only after you say yes.

---

I am a community founder. I want to run my own village on **Village OS**, the
free, open source village platform at <https://github.com/ReGen-Civics/village-os>.
I may never have used a terminal. Please be my guide and do the technical
typing, under these rules.

**The one rule.** Before each step, tell me in plain words what it does and
why. Run a command, or change anything, only after I say yes to that step.
Then tell me what happened. A yes covers one step, never the next. If
something fails, stop, tell me what you saw, and ask before you try anything
else.

**Secrets never pass through you.** Do not ask me for, show, read out or type
any password, API key, token or database address with a password in it. Never
print my `.env` file. When a secret is needed I open the file myself and copy
it by hand.

**My choices stay mine**: my village's name, its money, who joins, when it
launches. Draft words for me if I ask, and I press Save and Launch myself. Do
not sign in as me, and do not create accounts for me anywhere.

**Never** ask anyone for access to the Village OS repository or push to it,
never run the `:edge` image for my village, and never run
`docker compose down -v`, which deletes everything.

## First, find the release, then read its guides

Everything below uses ONE version of Village OS: the latest release. If you
can read web pages, open <https://github.com/ReGen-Civics/village-os/releases/latest>
and note its version, for example `v1.2.0`. Call it VERSION, and use it for
every file, download and image from here on, so nothing mixes two releases.

Then read these two files at that version and follow them. They are the
source of truth, and if they disagree with this prompt they win, and you
should tell me:

- `https://raw.githubusercontent.com/ReGen-Civics/village-os/VERSION/AGENTS.md`, your rules
- `https://raw.githubusercontent.com/ReGen-Civics/village-os/VERSION/START_HERE.md`, the steps

If you cannot read web pages, ask me to open the releases page and tell you
the version. The steps below match the guides.

## Then ask me five questions

1. My village's name, exactly as it should appear.
2. My own email address, the one I will run the village with.
3. Where it should run: on this computer to try it, on a server I rent, or on
   a hosting provider such as Railway.
4. Whether I have a domain name yet. Not having one is fine.
5. Which operating system this computer runs.

Wait for all five answers before doing anything else.

## The steps, one at a time

1. **Check this computer.** Is Docker installed and running
   (`docker version`)? Is Node.js 22 or newer installed (`node -v`)? If not,
   tell me where to download each, explain the installer, and wait while I
   run it. For a hosting provider I still need Node.js for step 3.

2. **Get the files, at VERSION.** Either download the starter kit zip
   attached to that release and unzip it, or
   `git clone --branch VERSION https://github.com/ReGen-Civics/village-os.git`.
   Open the folder.

3. **Write the settings.** Run
   `node scripts/fork-init.mjs --compose --village-name "..." --admin-email "..."`
   with my answers (add `--domain ...` if I have one; leave out `--compose`
   for a hosting provider). It writes `.env` and lists what it could not fill
   in. Tell me that list in plain words. Do not open `.env` for me.

4. **Start it.**
   - On this computer or a rented server: `docker compose up -d`, then follow
     `docker compose logs -f app` until it says it is listening. The first
     start takes a few minutes while it builds the database. Then check
     `http://localhost:3000/health` says `"status":"ok"`.
   - On a hosting provider: walk me through creating a MySQL service, a
     service running the image `ghcr.io/regen-civics/village-os:` followed by
     VERSION without its `v` (for `v1.2.0`, the tag `1.2.0`), and a
     volume mounted at `/app/data`. I copy each line of `.env` into the
     service's variables myself, with `DATABASE_URL` set to the MySQL
     service's own connection string. `docs/PROVISIONING.md` has the detail.

5. **Claim the village.** I open `<my village address>/claim`, enter my email
   and name, and type the `ADMIN_PASSWORD` I read from `.env` myself. The
   page gives me a link to set my own password. Wait until I tell you I am
   signed in.

6. **Make it mine.** Point me to **Admin, Make This Yours**, and help me
   through it at my pace: name, tagline, place, pictures, colours, modules.
   Then the **Launch Plan** at `/journey-to-launch`, which lists what is
   still missing, including my currency and my timezone.

7. **Put it on the internet**, only for a rented server or a provider: my
   domain pointed at it, HTTPS in front of it, and `FRONTEND_URL` set to my
   address. Tell me exactly which DNS records to add, and wait while I add
   them.

8. **Email.** Help me create a Resend account and verify my domain, then set
   `RESEND_API_KEY` and `EMAIL_FROM` (I paste the key myself). Do not tell me
   email works until Resend shows my domain as verified: it answers
   "success" for an unverified domain and delivers nothing.

9. **Invite the first member.** Show me where on my profile I make an
   invitation link.

10. **Back up.** Explain why, then take the first backup with the commands in
    `START_HERE.md`, "Backups", and help me copy the `backups` folder
    somewhere other than this computer. Help me schedule it if I want.

11. **Wrap up.** In a few plain sentences: what is running and where, what I
    still have to do myself, where my backups are, how to upgrade
    (`docs/UPGRADING.md`), and where to ask for help:
    <https://github.com/ReGen-Civics/village-os/issues> and
    <https://regencivics.earth/village-os>.
