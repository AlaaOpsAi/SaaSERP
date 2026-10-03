# Operations: database access, backups, restore

Everything below assumes the Docker set-up (`docker compose up -d`) on your Mac or a server, run from the `SaaSERP` folder.

## 1. Connecting to the database

The database is published on **this computer only** (`127.0.0.1`, port **5433**, so it can't clash with another Postgres). It isn't reachable from the network.

| Setting | Value |
|---|---|
| Host | `127.0.0.1` |
| Port | `5433` (change with `DB_PORT=…` in `.env`) |
| Database | `saaserp` |
| User / password | see the logins below |

### Which login to use

| Login | Password (default) | Use it for | Sees |
|---|---|---|---|
| `saaserp_readonly` | `saaserp_readonly` | **reporting, Excel, Power BI, Metabase, exploring** | every table of every workspace; **cannot change anything** |
| `saaserp_owner` | `saaserp_owner` | maintenance scripts, fixing data by hand (careful) | everything, can change everything |
| `postgres` | `POSTGRES_PASSWORD` (default `postgres`) | server administration only | everything |
| `saaserp_app` | `saaserp_app` | the application itself; don't use it in tools | nothing until a workspace is set, so tools show empty tables |

> **Created your stack before this version?** The `saaserp_readonly` login is created on first start only. Add it once with:
> ```bash
> docker compose exec db psql -U postgres -c "CREATE ROLE saaserp_readonly LOGIN PASSWORD 'saaserp_readonly' BYPASSRLS;"
> docker compose restart app   # re-runs migrations, which grant it read access
> ```

**On a server, don't use the default passwords.** Set `POSTGRES_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` and `DB_READONLY_PASSWORD` in `.env` **before the first start**; they're applied when the database is created (see [DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md)). To change one on an existing database, change it in the database first, then put the same value in `.env` and run `docker compose up -d`:
```bash
docker compose exec db psql -U postgres -c "ALTER ROLE saaserp_readonly PASSWORD 'something-long';"
```

### Tools

- **TablePlus / DBeaver / DataGrip / Postico:** new PostgreSQL connection with the values above.
- **pgAdmin in your browser** (optional):
  ```bash
  echo "PGADMIN_PASSWORD=choose-one" >> .env
  docker compose --profile tools up -d pgadmin
  open http://localhost:5050
  ```
  The **SaaSERP** server is pre-configured with the read-only login; enter its password when asked.
- **Command line:**
  ```bash
  docker compose exec db psql -U saaserp_readonly -d saaserp
  ```

### Useful queries

```sql
-- Workspaces and their size
SELECT t.name, t.status, t.plan, (SELECT count(*) FROM bookings b WHERE b.tenant_id = t.id) AS bookings FROM tenants t;

-- One workspace's definite revenue by month (finance figures come from the booking_finance view)
SELECT date_trunc('month', b.event_date) AS month, sum(f.revenue) AS revenue, sum(f.net_profit) AS net_profit
FROM bookings b JOIN booking_finance f ON f.booking_id = b.id JOIN tenants t ON t.id = b.tenant_id
WHERE t.slug = 'demo' AND b.status IN ('DEF','ACT') GROUP BY 1 ORDER BY 1;
```

Every table, column, view and function is described in [DATABASE.md](DATABASE.md). Inside a SQL tool you can also read the descriptions: `\d+ bookings` in psql, or the "Comment" column in TablePlus or DBeaver.

## 2. Backups

### Automatic, daily

The `backup` service in `docker-compose.yml` writes a full dump to **`./backups/saaserp-YYYYmmdd-HHMMSS.dump`** when the stack starts and then every 24 hours. It keeps **14 days**. Change this in `.env`:

```bash
BACKUP_KEEP_DAYS=30
BACKUP_INTERVAL_SECONDS=43200   # every 12 hours
```

Check that it works: `docker compose logs backup` shows "backup written…" lines.

### Now, on demand

```bash
./scripts/backup.sh          # -> backups/saaserp-20261002-101500.dump
```

### Keep a copy off the machine

A backup on the same disk doesn't protect against losing the disk. Copy `./backups` somewhere else regularly, for example:
- into iCloud Drive or Google Drive: `cp backups/*.dump ~/Library/Mobile\ Documents/com~apple~CloudDocs/SaaSERP-backups/`
- to S3: `aws s3 sync backups/ s3://your-bucket/saaserp/`

The dumps contain all customer data, including client phone numbers. Store them somewhere private.

### What a backup contains

Everything: all workspaces, users (with password hashes), settings, bookings, history, the schema, security policies and permissions. Restoring it gives an identical system.

For a **readable** copy of one workspace's data (Excel or JSON), an admin can use **Settings → Export → Full workspace export** in the app instead. It contains no password hashes.

## 3. Restore

```bash
./scripts/restore.sh backups/saaserp-20261002-101500.dump
```

The script:
1. asks you to type `RESTORE`
2. takes a **safety backup** of the current data first
3. stops the app, recreates the database from the dump, and starts the app again

It has been tested: a dump restored into a fresh database gave identical row counts in every table, and all security policies and permissions were restored.

**Restore to a different machine:** install the stack there, copy the `.dump` file into its `backups/` folder, then run the same command.

**Look inside a backup without restoring:** load it into a separate scratch database:
```bash
docker compose exec -T db psql -U postgres -c "CREATE DATABASE saaserp_check OWNER saaserp_owner;"
docker compose exec -T db pg_restore -U postgres -d saaserp_check --no-owner --role=saaserp_owner < backups/<file>.dump
docker compose exec db psql -U postgres -d saaserp_check      # look around, then:
docker compose exec -T db psql -U postgres -c "DROP DATABASE saaserp_check;"
```

## 4. On a hosted database (later)

If you move to a managed PostgreSQL (AWS RDS, DigitalOcean, Supabase, Neon…), turn on its automatic daily backups and point-in-time recovery; they replace the `backup` service. `pg_dump` and `scripts/restore.sh` still work against it when given its connection settings.
