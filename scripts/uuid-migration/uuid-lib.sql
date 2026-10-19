-- NEXUS cuid -> UUIDv7 conversion: library (functions + permanent map table).
-- Idempotent. Creates schema uuid_mig (working functions/tables, dropped at the end of a real run is NOT
-- required: it is small and the verifier needs it) and table public.legacy_id_map (PERMANENT: the server
-- resolves old ids through it forever).
--
-- Nothing here changes application data. See convert.sql for the run and docs/internal/UUID-MIGRATION.md.

create schema if not exists uuid_mig;

-- Permanent map. old_id is globally unique (checked before insert: two tables never share an old id).
create table if not exists public.legacy_id_map (
  old_id       text primary key,
  new_id       text not null unique,
  model        text not null,             -- table name, or '(deleted)' for ids only seen in history rows
  ts_source    text not null,             -- createdAt | cuid | now
  converted_at timestamptz(6) not null default now()
);
create index if not exists legacy_id_map_model_idx on public.legacy_id_map (model);

-- ---------------------------------------------------------------------------------------------
-- UUIDv7 (RFC 9562): 48-bit unix ms | ver 7 | 12-bit rand_a (we put a per-ms sequence there, method 1,
-- so ids minted for rows created in the same millisecond keep their creation order) | variant | 62 random bits.
-- Randomness comes from gen_random_uuid() (crypto-strong, built in since PG13).
create or replace function uuid_mig.uuid7(ms bigint, seq int default null) returns text
language plpgsql volatile as $$
declare r text := replace(gen_random_uuid()::text, '-', ''); s text; a text;
begin
  -- r[13] is the v4 version nibble and r[17] its variant nibble: never use those two positions.
  a := case when seq is null then substr(r, 1, 3) else lpad(to_hex(seq & 4095), 3, '0') end;
  s := lpad(to_hex(ms), 12, '0')
       || '7' || a
       || to_hex(8 | (('x' || substr(r, 4, 1))::bit(4)::int & 3)) || substr(r, 5, 3)
       || substr(r, 8, 5) || substr(r, 18, 7);
  return substr(s, 1, 8) || '-' || substr(s, 9, 4) || '-' || substr(s, 13, 4) || '-' || substr(s, 17, 4) || '-' || substr(s, 21, 12);
end $$;

-- public.nexus_uuid7() (the NEXUS DB default for new rows) comes from
-- prisma/sql/2026-10-18-uuid-legacy-id-map.sql; convert.sql step 7 requires it unless -v no_db_default=1.

-- cuid v1 = 'c' + 8 base36 chars of unix ms + counter + fingerprint + random.
create or replace function uuid_mig.cuid_ms(id text) returns bigint language plpgsql immutable as $$
declare s text; v bigint := 0; ch int; i int;
begin
  if id !~ '^c[a-z0-9]{24}$' then return null; end if;
  s := substr(id, 2, 8);
  for i in 1..8 loop
    ch := ascii(substr(s, i, 1));
    v := v * 36 + case when ch between 48 and 57 then ch - 48 else ch - 87 end;
  end loop;
  -- plausible window: 2019-01-01 .. 2030-01-01
  if v < 1546300800000 or v > 1893456000000 then return null; end if;
  return v;
end $$;

create or replace function uuid_mig.is_uuid(t text) returns boolean language sql immutable as $$
  select t ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- A "real" cuid token (not a 25-char run of hex from an md5 that happens to start with c): valid
-- timestamp prefix and at least one letter beyond f.
create or replace function uuid_mig.looks_cuid(t text) returns boolean language sql immutable as $$
  select t ~ '^c[a-z0-9]{24}$' and t ~ '[g-z]' and uuid_mig.cuid_ms(t) is not null
$$;

-- ---------------------------------------------------------------------------------------------
-- Which tables/rows are converted.
--   * every public table with a single-column text primary key named "id" (Prisma models), except the
--     map itself, the SQL ledger and the ad-hoc _bak_* copies (those are only rewritten as text);
--   * every value that is not already a UUID and not a code-derived natural key (keep list below).
-- Natural keys that stay as they are (their EMBEDDED ids are still rewritten as text):
create table if not exists uuid_mig.keep_rule (tbl text not null, pattern text not null, why text not null);
truncate uuid_mig.keep_rule;
insert into uuid_mig.keep_rule values
  ('CustomField', '^legalcf_',  'scripts/legal-cleanup-old-intake.ts selects id startsWith legalcf_ (run it BEFORE the conversion; then none are left)'),
  ('Form',        '^legalform_', 'scripts/legal-cleanup-old-intake.ts selects id startsWith legalform_'),
  ('*',           ':',           'composite natural keys built by code, e.g. PATS Setting "CITY:<cityId>:minAge", LeaderboardSnapshot "<at>:<cityId>:<period>", Notification "claim:<id>" (dedupe key). Kept; the ids inside are rewritten as text');

-- Pinned new ids: rows whose id the code names literally (src/lib/org.ts ORG_WORKSPACE_ID_V7). The UUIDs
-- were minted once (UUIDv7 of the row's createdAt) and are the same on prod and dev (dev is a prod copy).
create table if not exists uuid_mig.pin (old_id text primary key, new_id text not null unique, why text not null);
insert into uuid_mig.pin values
  ('cmmroq7dk0001vewe92nk1g0w', '019cf14d-ebd8-7000-b947-67d4138beaf3', 'company workspace "Z Networks" (src/lib/org.ts)')
on conflict (old_id) do update set new_id = excluded.new_id, why = excluded.why;

create or replace view uuid_mig.id_tables as
select c.oid::regclass as rel, c.relname::text as tbl,
       exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'createdAt' and not a.attisdropped) as has_created
from pg_class c
join pg_constraint p on p.conrelid = c.oid and p.contype = 'p' and array_length(p.conkey, 1) = 1
join pg_attribute a on a.attrelid = c.oid and a.attnum = p.conkey[1]
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and a.attname = 'id' and a.atttypid in ('text'::regtype, 'varchar'::regtype)
  and c.relname not like '\_bak%' and c.relname not in ('legacy_id_map', 'nexus_sql_ledger', '_prisma_migrations');

-- Every text-like column outside the id tables' own PK, for the generic rewrite + scans.
create or replace view uuid_mig.text_columns as
select c.oid::regclass as rel, c.relname::text as tbl, a.attname::text as col,
       format_type(a.atttypid, a.atttypmod) as typ
from pg_class c join pg_attribute a on a.attrelid = c.oid
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  and a.attgenerated = ''
  and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'json'::regtype, 'jsonb'::regtype,
                     'text[]'::regtype, 'varchar[]'::regtype)
  and c.relname not in ('legacy_id_map', '_prisma_migrations');

-- Single-column FKs whose target is an id table's "id".
create or replace view uuid_mig.fk_columns as
select k.conname::text, k.conrelid::regclass as rel, cr.relname::text as tbl, a.attname::text as col,
       k.confrelid::regclass as target_rel, ct.relname::text as target_tbl
from pg_constraint k
join pg_class cr on cr.oid = k.conrelid
join pg_class ct on ct.oid = k.confrelid
join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
join pg_attribute ta on ta.attrelid = k.confrelid and ta.attnum = k.confkey[1]
where k.contype = 'f' and k.connamespace = 'public'::regnamespace and array_length(k.conkey, 1) = 1
  and ta.attname = 'id';

-- ---------------------------------------------------------------------------------------------
-- Text rewrite. Tokens = maximal runs of [A-Za-z0-9_-]. A token that IS an old id is replaced; otherwise,
-- a long token is split on _ and - and each alnum part that is an old id is replaced (ids embedded in
-- derived keys: "sr_<sheetId>_10", "gc_legacy_<userId>", "doc:<docId>", file names "<userId>-<ts>.jpg").
-- Only exact map hits are replaced, so md5/hex strings that merely look like a cuid are never touched.
create or replace function uuid_mig.remap_text(t text) returns text
language plpgsql stable strict as $$
declare
  res text := ''; m text[]; tok text; nid text; p text[]; part text; sub text; hit boolean := false;
begin
  if t !~ '[A-Za-z0-9_-]{6}' then return t; end if;
  for m in select regexp_matches(t, '([A-Za-z0-9_-]+)|([^A-Za-z0-9_-]+)', 'g') loop
    tok := m[1];
    if tok is null then res := res || m[2]; continue; end if;
    if length(tok) >= 6 then
      select new_id into nid from public.legacy_id_map where old_id = tok;
      if found then res := res || nid; hit := true; continue; end if;
      if length(tok) >= 21 and tok ~ '[_-]' then
        sub := '';
        for p in select regexp_matches(tok, '([A-Za-z0-9]+)|([_-]+)', 'g') loop
          part := coalesce(p[1], p[2]);
          if p[1] is not null and length(part) >= 20 then
            select new_id into nid from public.legacy_id_map where old_id = part;
            if found then part := nid; hit := true; end if;
          end if;
          sub := sub || part;
        end loop;
        res := res || sub; continue;
      end if;
    end if;
    res := res || tok;
  end loop;
  if hit then return res; end if;
  return t;
end $$;


-- Replace the given old ids inside one text, respecting token boundaries: an old id is replaced where it is
-- a whole [A-Za-z0-9_-] token ("fcat_1" never hits inside "fcat_10"), or a whole alnum run inside a longer
-- token ("sr_<id>_10", "gc_legacy_<id>", "checkin-<id>-<ts>"); never inside a longer alnum run (a hash).
create or replace function uuid_mig.apply_hits(t text, olds text[]) returns text
language plpgsql stable as $$
declare mp jsonb; out text[] := '{}'; m text[]; tok text; nid text; p text[]; q text[]; part text;
begin
  select jsonb_object_agg(old_id, new_id) into mp from public.legacy_id_map where old_id = any(olds);
  if mp is null then return t; end if;
  -- one pass over the text: tokens are maximal [A-Za-z0-9_-] runs, everything else is copied as is.
  -- Pieces go into an array (appended in place) and are joined once: string concatenation in a loop is
  -- quadratic on the large DeletionSnapshot payloads.
  -- A percent-escape ("%2F" in a URL-encoded key: photos%2F<memberId>%2F…) is a separator too, or the id
  -- would be glued to the escape's hex digits ("2Fcmv…").
  for m in select regexp_matches(t, '(%[0-9A-Fa-f]{2})|([A-Za-z0-9_-]+)|([^A-Za-z0-9_%-]+|%)', 'g') loop
    if m[2] is null then out := out || coalesce(m[1], m[3]); continue; end if;
    tok := m[2];
    nid := mp ->> tok;
    if nid is not null then out := out || nid; continue; end if;
    if tok ~ '[_-]' then
      -- a composite token ("folder-<folderId>", "sr_<sheetId>_10", "checkin-<userId>-<ts>-<rand>"):
      -- pieces between '-' first (ids may contain '_': "cm_jagain_folder"), then pieces between '_'.
      for p in select regexp_matches(tok, '([A-Za-z0-9_]+)|(-+)', 'g') loop
        part := coalesce(p[1], p[2]);
        nid := case when p[1] is not null then mp ->> part end;
        if nid is not null then out := out || nid; continue; end if;
        if p[1] is not null and part ~ '_' then
          for q in select regexp_matches(part, '([A-Za-z0-9]+)|(_+)', 'g') loop
            out := out || coalesce(case when q[1] is not null then mp ->> q[1] end, q[1], q[2]);
          end loop;
        else
          out := out || part;
        end if;
      end loop;
    else
      out := out || tok;
    end if;
  end loop;
  return array_to_string(out, '');
end $$;

-- SQL fragment: the (ctid, old ids) of rows of rel whose column col mentions old ids. Candidate tokens are
-- the maximal [A-Za-z0-9_-]{6,} runs, the maximal [A-Za-z0-9_]{6,} runs inside them (pieces between '-')
-- the maximal alnum runs of 20+ chars (pieces between '_' or '-'), and runs right after a percent-escape.
create or replace function uuid_mig.hits_sql(rel regclass, col text) returns text
language sql immutable as $$
  select format($q$
    select tid, array_agg(distinct m.old_id) as olds from (
      select t.ctid as tid, (regexp_matches(t.%1$I::text, '[A-Za-z0-9_-]{6,}', 'g'))[1] as tok from %2$s t where t.%1$I is not null
      union all
      select t.ctid, (regexp_matches(t.%1$I::text, '[A-Za-z0-9_]{6,}', 'g'))[1] from %2$s t where t.%1$I is not null and t.%1$I::text ~ '[A-Za-z0-9_]-|-[A-Za-z0-9_]'
      union all
      select t.ctid, (regexp_matches(t.%1$I::text, '[A-Za-z0-9]{20,}', 'g'))[1] from %2$s t where t.%1$I is not null and t.%1$I::text ~ '[A-Za-z0-9]_|_[A-Za-z0-9]|[A-Za-z0-9]-|-[A-Za-z0-9]'
      union all
      select t.ctid, (regexp_matches(t.%1$I::text, '%%[0-9A-Fa-f]{2}([A-Za-z0-9_-]{6,})', 'g'))[1] from %2$s t where t.%1$I is not null and t.%1$I::text ~ '%%[0-9A-Fa-f]{2}[A-Za-z0-9_-]{6}'
    ) x join public.legacy_id_map m on m.old_id = x.tok group by tid $q$, col, rel)
$$;

-- Reverse (verification only): every UUIDv7 we minted -> its old id.
create or replace function uuid_mig.unmap_text(t text) returns text
language plpgsql stable strict as $$
declare u text; o text;
begin
  if t !~ '[0-9a-f]{8}-[0-9a-f]{4}-7' then return t; end if;
  for u in select distinct (regexp_matches(t, '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', 'g'))[1] loop
    select old_id into o from public.legacy_id_map where new_id = u;
    if found then t := replace(t, u, o); end if;
  end loop;
  return t;
end $$;

-- Find old-id tokens in a text (inventory / leftover scan): returns the old ids present.
create or replace function uuid_mig.old_ids_in(t text) returns setof text
language sql stable strict as $$
  select distinct m.old_id
  from (select (regexp_matches(t, '[A-Za-z0-9_-]{6,}', 'g'))[1] as tok) x
  cross join lateral (select x.tok union all select (regexp_matches(x.tok, '[A-Za-z0-9]{20,}', 'g'))[1]) s(cand)
  join public.legacy_id_map m on m.old_id = s.cand
$$;

-- cuid-looking tokens (orphans: ids of rows deleted before the run, still named in history rows).
create or replace function uuid_mig.cuid_tokens(t text) returns setof text
language sql stable strict as $$
  select distinct c from (select (regexp_matches(t, '(?:^|[^a-z0-9])(c[a-z0-9]{24})(?![a-z0-9])', 'g'))[1] c) x
  where uuid_mig.looks_cuid(c)
$$;

-- Column expression used by the checksums: the value as text, optionally with new ids mapped back.
create or replace function uuid_mig.col_expr(col text, typ text, unmap boolean) returns text
language sql immutable as $$
  select case
    when typ = 'jsonb' and unmap then format('uuid_mig.unmap_text(%I::text)::jsonb::text', col)
    when typ = 'jsonb' then format('%I::text', col)
    when typ in ('text','character varying','json','text[]','character varying[]') and unmap then format('uuid_mig.unmap_text(%I::text)', col)
    else format('%I::text', col) end
$$;

-- Order-independent checksum of a whole table (all columns). With unmap=true every minted UUID is
-- mapped back to its old id first, so before(old db) = after(new db, unmap) proves the conversion is
-- lossless and touched nothing but ids.
create or replace function uuid_mig.table_checksum(rel regclass, unmap boolean) returns text
language plpgsql as $$
declare cols text; r text;
begin
  select string_agg(format('coalesce(%s, %L)', uuid_mig.col_expr(a.attname, format_type(a.atttypid, a.atttypmod), unmap), E'\\N'), $s$ || '|' || $s$ order by a.attnum)
    into cols
  from pg_attribute a where a.attrelid = rel and a.attnum > 0 and not a.attisdropped;
  execute format('select md5(coalesce(string_agg(h, %L order by h), %L)) from (select md5(%s) h from %s) x', ',', '', cols, rel) into r;
  return r;
end $$;
