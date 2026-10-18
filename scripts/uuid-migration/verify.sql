-- NEXUS UUIDv7 conversion: verification, run AFTER convert.sql committed (read-only).
-- Prints one line per check, "PASS"/"FAIL", plus details for failures. Exit status 3 if any check fails.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
create temp table result (check_name text, ok boolean, detail text);

-- 1. Row counts identical (CollabState is emptied on purpose: a reseedable Yjs cache).
insert into result
select 'rowcount ' || b.tbl, (a.n = b.n) or (b.tbl = 'CollabState' and a.n = 0), format('before %s after %s', b.n, a.n)
from uuid_mig.snap_before b
cross join lateral (select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', b.tbl), false, true, '')))[1]::text::bigint as n) a;

-- 2. Lossless: every table, with every minted UUID mapped back to its old id, hashes exactly as before.
insert into result
select 'checksum ' || b.tbl, b.checksum = uuid_mig.table_checksum(format('%I', b.tbl)::regclass, true) or b.tbl = 'CollabState', ''
from uuid_mig.snap_before b;

-- 3. Every FK resolves.
do $$ declare r record; n bigint; begin
  for r in select k.conrelid::regclass rel, a.attname col, k.confrelid::regclass trel, ta.attname tcol, k.conname
           from pg_constraint k
           join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
           join pg_attribute ta on ta.attrelid = k.confrelid and ta.attnum = k.confkey[1]
           where k.contype = 'f' and k.connamespace = 'public'::regnamespace loop
    execute format('select count(*) from %s t where t.%I is not null and not exists (select 1 from %s x where x.%I = t.%I)',
                   r.rel, r.col, r.trel, r.tcol, r.col) into n;
    insert into result values ('fk ' || r.conname, n = 0, n || ' dangling');
  end loop;
end $$;

-- 4. No old id left in any text/json/array column of any table (map hits, same tokenizer as the run).
do $$ declare r record; n bigint; ex text; begin
  for r in select * from uuid_mig.text_columns loop
    execute format('select count(*), min(o) from (%s) h, unnest(h.olds) o', uuid_mig.hits_sql(r.rel, r.col)) into n, ex;
    if n > 0 then insert into result values (format('leftover old id %s.%s', r.tbl, r.col), false, n || ' e.g. ' || ex); end if;
  end loop;
  insert into result select 'leftover old ids (all columns)', not exists (select 1 from result where check_name like 'leftover old id %'), '';
end $$;

-- 5. No cuid-looking token left anywhere (catches ids the map never knew).
do $$ declare r record; n bigint; ex text; begin
  for r in select * from uuid_mig.text_columns loop
    execute format($q$select count(*), min(x.tok) from %s t, uuid_mig.cuid_tokens(t.%I::text) x(tok) where t.%I::text ~ 'c[a-z0-9]{24}'$q$, r.rel, r.col, r.col) into n, ex;
    if n > 0 then insert into result values (format('cuid-looking token %s.%s', r.tbl, r.col), false, n || ' e.g. ' || ex); end if;
  end loop;
  insert into result select 'cuid-looking tokens (all columns)', not exists (select 1 from result where check_name like 'cuid-looking token %'), '';
end $$;

-- 6. Primary keys: every id is a UUID, except the documented natural keys (uuid_mig.keep_rule).
do $$ declare r record; n bigint; ex text; begin
  for r in select * from uuid_mig.id_tables loop
    execute format('select count(*), min(id) from %s t where not uuid_mig.is_uuid(t.id) and not exists (select 1 from uuid_mig.keep_rule k where k.tbl in (%L, ''*'') and t.id ~ k.pattern)', r.rel, r.tbl) into n, ex;
    insert into result values ('pk uuid ' || r.tbl, n = 0, coalesce(n || ' e.g. ' || ex, ''));
  end loop;
end $$;

-- 7. UUIDv7 really: version nibble 7, variant 10xx, and the embedded time equals createdAt (ms) where there is one.
do $$ declare r record; n bigint; begin
  for r in select * from uuid_mig.id_tables where has_created loop
    execute format($q$select count(*) from %s t join public.legacy_id_map m on m.new_id = t.id
      where m.ts_source = 'createdAt' and (substr(t.id, 15, 1) <> '7' or substr(t.id, 20, 1) not in ('8','9','a','b')
        or ('x' || lpad(replace(substr(t.id, 1, 13), '-', ''), 16, '0'))::bit(64)::bigint <> (extract(epoch from t."createdAt") * 1000)::bigint)$q$, r.rel) into n;
    insert into result values ('uuid7 time ' || r.tbl, n = 0, n || ' mismatched');
  end loop;
end $$;

-- 8. Order kept: within each table, ordering by new id = ordering by (createdAt, old id).
do $$ declare r record; n bigint; begin
  for r in select * from uuid_mig.id_tables where has_created loop
    execute format($q$select count(*) from (
        select t.id, lag(t.id) over (order by t."createdAt", m.old_id) prev
        from %s t join public.legacy_id_map m on m.new_id = t.id where m.ts_source = 'createdAt') x
      where prev is not null and prev > id$q$, r.rel) into n;
    insert into result values ('order ' || r.tbl, n = 0, n || ' out of order');
  end loop;
end $$;

-- 9. The map: unique both ways, every converted PK present in it.
insert into result select 'map old unique', count(*) = count(distinct old_id), count(*) || ' rows' from public.legacy_id_map;
insert into result select 'map new unique', count(*) = count(distinct new_id), '' from public.legacy_id_map;

select case when ok then 'PASS' else 'FAIL' end, check_name, detail from result where not ok order by check_name;
select 'SUMMARY', count(*) filter (where ok) || ' pass', count(*) filter (where not ok) || ' fail' from result;
select count(*) filter (where not ok) = 0 as all_ok from result \gset
\if :all_ok
\echo VERIFY OK
\else
\echo VERIFY FAILED
select 1/0 as verify_failed;
\endif
