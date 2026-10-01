# Restore drill

A backup you never restored is a lottery ticket, not a backup.
And a replica is not a backup: replication copies your mistakes faithfully.
The only proof is to restore into a clean target and compare — that is what `scripts/restore-drill.sh` does, and this file records the run.

## How the drill works

`scripts/restore-drill.sh`:

1. reads the checksum of the **live** DB through PgBouncer — `count(*) || '|' || sum(total_cents)`
   over the key table `orders`;
2. takes the latest `backups/*.dump`;
3. drops the `restore` container **and its volume** from any previous run, then brings up a fresh,
   empty `postgres:17` (compose service `restore`, profile `drill`, on its own volume);
4. `pg_restore --no-owner --no-privileges` into it and re-reads the checksum;
5. prints **MATCH** if before == after, else exits non-zero;
6. tears the throwaway container down again — so a second run also starts clean and also prints MATCH.

Run it:

```bash
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/appdb
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh   # -> MATCH
```

## Last drill result

| Field                     | Value                                                                |
|---------------------------|----------------------------------------------------------------------|
| Date                      | 2026-09-28                                                           |
| Dump file                 | `backups/appdb-2026-09-28_115252.dump`                               |
| Dump format               | `pg_dump -Fc` (custom, gzip), 51 TOC entries                         |
| Dump size                 | 18 936 bytes (~19 KB)                                                |
| Key table                 | `orders`                                                             |
| Checksum before (live)    | `22\|2074600` (`count \| sum(total_cents)`)                          |
| Checksum after (restored) | `22\|2074600`                                                        |
| Result                    | **MATCH**                                                            |
| `pg_restore` time         | **~0.15 s**                                                          |
| Full-drill wall-clock     | **~3.8 s** (stand up a clean Postgres + restore + verify + teardown) |

## RTO / RPO

- **RTO (Recovery Time Objective) ≈ 4 seconds** for this dataset. The restore itself is **~0.15 s**;
  the rest is bringing a clean Postgres container up. On a real, larger DB RTO grows with dump
  size and, for physical/PITR recovery, with WAL replay — measure it, never guess.
- **RPO (Recovery Point Objective) = up to 24 hours.** `backup.cron` runs `pg_dump` nightly at
  02:30, so a failure just before the next run loses everything written since the last one — at
  most one day. A tighter RPO (minutes) requires continuous WAL archiving + PITR (lecture 15,
  step 11); RPO ≈ 0 requires synchronous replication.

Both numbers are **measured**, not declared — that is the whole point of running the drill.