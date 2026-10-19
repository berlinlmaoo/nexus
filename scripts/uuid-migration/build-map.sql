-- Included by convert.sql and inventory.sql (inside their transaction). Fills public.legacy_id_map.
-- 2. The map: one new UUIDv7 per old id, timestamp = createdAt (else the cuid's own ms, else now),
--    sequence within the same ms keeps the old (createdAt, id) order.
create temp table new_map (old_id text, new_id text, model text, ts_source text) on commit drop;
do $$ declare r record; begin
  for r in select * from uuid_mig.id_tables order by tbl loop
    execute format($q$
      insert into new_map
      select id, uuid_mig.uuid7(ms, (row_number() over (partition by ms order by id) - 1)::int), %L, src
      from (
        select t.id,
               coalesce(%s, uuid_mig.cuid_ms(t.id), (extract(epoch from now()) * 1000)::bigint) as ms,
               case when %s is not null then 'createdAt' when uuid_mig.cuid_ms(t.id) is not null then 'cuid' else 'now' end as src
        from %s t
        where not uuid_mig.is_uuid(t.id)
          and not exists (select 1 from uuid_mig.keep_rule k where k.tbl in (%L, '*') and t.id ~ k.pattern)
          and not exists (select 1 from public.legacy_id_map m where m.old_id = t.id)
      ) x $q$,
      r.tbl,
      case when r.has_created then '(extract(epoch from t."createdAt") * 1000)::bigint' else 'null::bigint' end,
      case when r.has_created then 't."createdAt"' else 'null' end,
      r.rel, r.tbl);
  end loop;
end $$;

update new_map n set new_id = p.new_id from uuid_mig.pin p where p.old_id = n.old_id;

do $$ declare d text; begin
  select string_agg(old_id || ' in ' || models, '; ') into d from (
    select old_id, string_agg(model, ',') models from new_map group by old_id having count(*) > 1) x;
  if d is not null then raise exception 'old id shared by two tables, cannot map globally: %', d; end if;
end $$;

-- 2b. Ids of rows deleted before the run that history rows still name (DeletionSnapshot payloads,
--     AuditLog/ActivityLog metadata, Notification links, chat text...). They get a UUID too, so a
--     restore from Audit re-creates rows with UUIDs and every reference inside one snapshot stays
--     consistent. Only cuid-looking tokens with a plausible timestamp qualify.
insert into public.legacy_id_map (old_id, new_id, model, ts_source)
select old_id, new_id, model, ts_source from new_map;
analyze public.legacy_id_map;

create temp table orphan_tok (tok text primary key) on commit drop;
do $$ declare r record; begin
  for r in select tc.* from uuid_mig.text_columns tc
           where not exists (select 1 from uuid_mig.id_tables i where i.rel = tc.rel and tc.col = 'id')
             and not exists (select 1 from uuid_mig.fk_columns f where f.rel = tc.rel and f.col = tc.col) loop
    execute format($q$
      insert into orphan_tok select distinct x.tok from %s t, uuid_mig.cuid_tokens(%I::text) x(tok)
      where %I::text ~ 'c[a-z0-9]{24}'
      on conflict do nothing $q$, r.rel, r.col, r.col);
  end loop;
end $$;
insert into public.legacy_id_map (old_id, new_id, model, ts_source)
select tok, uuid_mig.uuid7(uuid_mig.cuid_ms(tok), null), '(deleted)', 'cuid'
from orphan_tok where not exists (select 1 from public.legacy_id_map m where m.old_id = tok);
analyze public.legacy_id_map;
