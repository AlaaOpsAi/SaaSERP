# Deploying on Hostinger

SaaSERP runs as Docker containers (the app, PostgreSQL, backups and an HTTPS proxy), so it needs a **Hostinger VPS**.

**Shared, Cloud and WordPress hosting plans can't run it.** They don't offer Docker or PostgreSQL. If that's all you have, add a VPS to the account. Your domain can stay where it is.

## 1. Choose the VPS

| Plan | Fits |
|---|---|
| **KVM 1** (1 vCPU, 4 GB RAM) | a pilot with one or two companies |
| **KVM 2** (2 vCPU, 8 GB RAM), **recommended** | several companies and room to grow |

- **Operating system:** choose **Ubuntu 24.04 with Docker** under *OS with application* if it's offered. Plain **Ubuntu 24.04** also works, because the setup script below installs Docker.
- **Location:** pick the data centre closest to your customers.
- **SSH key:** add one when hPanel asks, or set a strong root password.

## 2. Point a domain at it

In hPanel, go to **Domains → your domain → DNS / Nameservers** and add an **A record**:

| Type | Name | Points to | TTL |
|---|---|---|---|
| A | `app` (gives `app.yourdomain.com`) or `@` for the bare domain | the VPS IP from **VPS → Overview** | 300 |

It usually works within minutes. Check with `ping app.yourdomain.com`; it should show the VPS IP.

## 3. Prepare the server (once)

```bash
ssh root@<VPS-IP>
git clone https://github.com/AlaaOpsAi/SaaSERP.git && cd SaaSERP
git checkout claude/affectionate-sagan-hru2m7
bash deploy/server-setup.sh
```

The script does four things:
- installs Docker if it's missing
- turns on the firewall, leaving only SSH, HTTP and HTTPS open
- turns on automatic security updates
- adds swap memory so the build doesn't run out of RAM

The repository is private, so `git clone` asks you to sign in. Use your GitHub username and a **personal access token** (GitHub → Settings → Developer settings → Fine-grained tokens, read-only access to this repository) as the password.

> **Hostinger firewall:** if you've turned on the firewall in hPanel (**VPS → Security → Firewall**), add rules there that allow TCP 80 and 443. Otherwise the HTTPS certificate can't be issued.

## 4. Configure and start

Create `.env` in the `SaaSERP` folder. Each secret is generated randomly:

```bash
cat > .env <<EOF
DOMAIN=app.yourdomain.com
ACME_EMAIL=you@yourdomain.com
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
DB_OWNER_PASSWORD=$(openssl rand -hex 16)
DB_APP_PASSWORD=$(openssl rand -hex 16)
DB_READONLY_PASSWORD=$(openssl rand -hex 16)
EOF
chmod 600 .env
```

Then start everything:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy app   # Ctrl+C to stop watching
```

The first build takes a few minutes. Caddy then fetches a free Let's Encrypt certificate and renews it automatically. Open **https://app.yourdomain.com**.

Create your operator account so you can approve workspaces at `/platform`:

```bash
docker compose exec app node apps/api/dist/scripts/create-platform-admin.js you@yourdomain.com 'a-long-password' "Your Name"
```

> **Tip:** run `echo 'alias dc="docker compose -f docker-compose.yml -f docker-compose.prod.yml"' >> ~/.bashrc && source ~/.bashrc`. From then on `dc up -d`, `dc logs -f app` and the other commands are shorter.

## 5. Bring your data from the Mac (optional)

If you've already used SaaSERP on your Mac:

1. **On the Mac:** run `./scripts/backup.sh`. It creates a file in `backups/`.
2. **Copy it to the server:**
   ```bash
   scp backups/<file>.dump root@<VPS-IP>:/root/SaaSERP/backups/
   ```
3. **On the server:** run `./scripts/restore.sh backups/<file>.dump`.

The restore keeps the server's new passwords, because the logins aren't part of the backup.

## 6. Day-to-day

| Task | Command (on the server, in `SaaSERP`) |
|---|---|
| Update to the latest version | `git pull && dc up -d --build` (migrations run automatically) |
| Logs | `dc logs -f app` |
| Restart | `dc restart app` |
| Back up now | `./scripts/backup.sh` |
| Database console | `dc exec db psql -U postgres saaserp` |

**Backups:**
- They run every night into `/root/SaaSERP/backups` and are kept for 14 days. They sit **on the same server**, though, so copy them somewhere else too.
- Either add Hostinger's weekly **VPS backups / snapshots** in hPanel, or copy the folder to your Mac now and then:
  ```bash
  scp -r root@<VPS-IP>:/root/SaaSERP/backups ./server-backups
  ```

**Database tools from your Mac:**
- The database isn't reachable from the internet. Open an SSH tunnel and connect through it:
  ```bash
  ssh -L 5433:127.0.0.1:5433 root@<VPS-IP>
  ```
- Leave that window open. In TablePlus or DBeaver, connect to `127.0.0.1:5433` as `saaserp_readonly`, with the `DB_READONLY_PASSWORD` from the server's `.env`.

**Mobile app:** on the sign-in screen, set **Server address** to `https://app.yourdomain.com`. This also meets the App Store and Google Play requirement for an HTTPS server.

## Security checklist

- [ ] Strong unique secrets in `.env` (step 4), and `chmod 600 .env`
- [ ] Only ports 22, 80 and 443 open (the setup script does this)
- [ ] SSH key login. After that, disable password login: `PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `systemctl restart ssh`
- [ ] Backups copied off the server (Hostinger snapshots or `scp`)
- [ ] Operator account created with a long password, and the demo seed **not** run on the server

## Troubleshooting

- **The site doesn't load or there's a certificate error:**
  - Check that the A record points to the VPS IP.
  - Check that ports 80 and 443 are open (ufw, and the hPanel firewall if it's on).
  - Run `dc logs caddy` to see the error.
- **`DOMAIN` error when starting:** `.env` is missing `DOMAIN=…`, or you ran the command outside the `SaaSERP` folder.
- **The build is killed (out of memory):** the setup script adds swap. On KVM 1, rerun the build once the swap is active.
- **Changing the database passwords later:** the `DB_*_PASSWORD` values only apply when the database is first created. To change one afterwards, update it in the database first, then update `.env`, then restart:
  ```bash
  dc exec db psql -U postgres -c "ALTER ROLE saaserp_app PASSWORD 'new-value';"
  dc up -d
  ```
