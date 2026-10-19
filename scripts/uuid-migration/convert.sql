-- NEXUS cuid -> UUIDv7 conversion: THE RUN. One transaction; any error rolls everything back.
--   psql -v ON_ERROR_STOP=1 -f uuid-lib.sql -f convert.sql
-- Preconditions (runbook L.23): app slots stopped (no writers), fresh pg_dump taken, VPS watchdog paused.
-- psql variables: -v mode=apply (default) | -v mode=dryrun (does everything, then ROLLBACK)
\set ON_ERROR_STOP 1
\timing on
\if :{?mode}
\else
  \set mode apply
\endif

begin;
-- No FK triggers, no user triggers (Task_completion_stamp / Task_updatedAt_monotonic / sheet_row_revisions
-- must not fire: nothing but ids changes). FKs are re-checked explicitly below before COMMIT.
set local session_replication_role = replica;
set local work_mem = '256MB';
set local lock_timeout = '10s';

-- 0. Lock every table we touch against stray writers.
do $$ declare r record; begin
  for r in select distinct rel from uuid_mig.text_columns loop
    execute format('lock table %s in exclusive mode', r.rel);
  end loop;
end $$;

-- 1. Before-image: row counts + order-independent checksums of every table (verify.sql compares).
create table if not exists uuid_mig.snap_before (tbl text primary key, n bigint, checksum text, taken_at timestamptz default now());
truncate uuid_mig.snap_before;
do $$ declare r record; n bigint; begin
  for r in select c.oid::regclass rel, c.relname::text tbl from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'legacy_id_map' loop
    execute format('select count(*) from %s', r.rel) into n;
    insert into uuid_mig.snap_before values (r.tbl, n, uuid_mig.table_checksum(r.rel, false));
  end loop;
end $$;

\ir build-map.sql

-- 3. Primary keys.
do $$ declare r record; n bigint; begin
  for r in select * from uuid_mig.id_tables loop
    execute format('update %s t set id = m.new_id from public.legacy_id_map m where m.old_id = t.id and m.model = %L', r.rel, r.tbl);
  end loop;
end $$;

-- 4. Foreign keys (exact, by the target table's map rows).
do $$ declare r record; begin
  for r in select * from uuid_mig.fk_columns loop
    execute format('update %s t set %I = m.new_id from public.legacy_id_map m where m.old_id = t.%I and m.model = %L',
                   r.rel, r.col, r.col, r.target_tbl);
  end loop;
end $$;

-- 5. Every other text / varchar / json / jsonb / text[] column in every table (soft references such as
--    AuditLog.entityId, Notification.link, view configs, block docs, DeletionSnapshot payloads, _bak_ copies).
create temp table rewrite_log (tbl text, col text, typ text, rows_changed bigint, took interval) on commit drop;
do $$ declare r record; n bigint; expr text; t0 timestamptz; begin
  -- (id columns are included: a kept natural key such as PATS "Setting".id = "CITY:<cityId>:minAge" still
  --  has its embedded ids rewritten; for a converted id this is a no-op, UUIDs are never in the map)
  for r in select tc.* from uuid_mig.text_columns tc
           where not exists (select 1 from uuid_mig.fk_columns f where f.rel = tc.rel and f.col = tc.col) loop
    t0 := clock_timestamp();
    expr := case
      when r.typ = 'jsonb' then format('uuid_mig.apply_hits(t.%I::text, h.olds)::jsonb', r.col)
      when r.typ = 'json'  then format('uuid_mig.apply_hits(t.%I::text, h.olds)::json', r.col)
      when r.typ in ('text[]', 'character varying[]') then format('uuid_mig.apply_hits(t.%I::text, h.olds)::%s', r.col, r.typ)
      else format('uuid_mig.apply_hits(t.%I, h.olds)', r.col) end;
    execute format('update %s t set %I = %s from (%s) h where t.ctid = h.tid', r.rel, r.col, expr, uuid_mig.hits_sql(r.rel, r.col));
    get diagnostics n = row_count;
    if n > 0 then insert into rewrite_log values (r.tbl, r.col, r.typ, n, clock_timestamp() - t0); end if;
  end loop;
end $$;

-- 6. Yjs live-editing state is binary (ids inside cannot be rewritten in place). It is a cache: the
--    server reseeds a room from Doc.content / TaskBody.doc when no matching state is kept
--    (src/lib/collab-rooms.ts loadRoom). Drop it.
do $$ begin if to_regclass('public."CollabState"') is not null then delete from "CollabState"; end if; end $$;

-- 7. New rows: DB default for raw-SQL inserts (Prisma mints uuid(7) itself). Skipped with -v no_db_default=1
--    (PATS: no raw-SQL inserts of ids, and Prisma migrate must not see a default it did not write).
\if :{?no_db_default}
\echo 'step 7 skipped (no_db_default)'
\else
do $$ declare r record; begin
  if to_regprocedure('public.nexus_uuid7()') is null then
    raise exception 'apply prisma/sql/2026-10-18-uuid-legacy-id-map.sql first (public.nexus_uuid7)';
  end if;
  for r in select * from uuid_mig.id_tables loop
    execute format('alter table %s alter column id set default public.nexus_uuid7()', r.rel);
  end loop;
end $$;
\endif

-- 8. Re-check every FK (triggers were off) — must be zero dangling references.
set local session_replication_role = origin;
do $$ declare r record; n bigint; bad text := ''; begin
  for r in select k.conrelid::regclass rel, a.attname col, k.confrelid::regclass trel, ta.attname tcol, k.conname
           from pg_constraint k
           join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
           join pg_attribute ta on ta.attrelid = k.confrelid and ta.attnum = k.confkey[1]
           where k.contype = 'f' and k.connamespace = 'public'::regnamespace loop
    execute format('select count(*) from %s t where t.%I is not null and not exists (select 1 from %s x where x.%I = t.%I)',
                   r.rel, r.col, r.trel, r.tcol, r.col) into n;
    if n > 0 then bad := bad || format('%s.%s->%s: %s; ', r.rel, r.col, r.trel, n); end if;
  end loop;
  if bad <> '' then raise exception 'dangling foreign keys after conversion: %', bad; end if;
end $$;

select 'mapped' as what, model, count(*) from public.legacy_id_map group by model order by 3 desc;
select 'rewritten' as what, tbl, col, typ, rows_changed, took from rewrite_log order by took desc;

select :'mode' = 'dryrun' as is_dry \gset
\if :is_dry
rollback;
\echo 'DRY RUN: rolled back'
\else
commit;
\echo 'COMMITTED'
\endif
