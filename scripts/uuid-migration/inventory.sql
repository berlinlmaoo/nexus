-- Inventory (read-only in effect: everything runs in a transaction that is rolled back).
-- Where do old ids live? One row per (table, column): rows holding at least one old id, how many
-- distinct old ids, and which kinds (target models) they point to; FK columns flagged.
\set ON_ERROR_STOP 1
\timing on
begin;
\ir build-map.sql
create temp table inv (tbl text, col text, typ text, is_pk bool, is_fk bool, rows_with_ids bigint, distinct_ids bigint, models text);
do $$ declare r record; begin
  for r in select * from uuid_mig.text_columns loop
    execute format($q$
      insert into inv
      select %L, %L, %L,
             exists (select 1 from uuid_mig.id_tables i where i.rel = %L::regclass and %L = 'id'),
             exists (select 1 from uuid_mig.fk_columns f where f.rel = %L::regclass and f.col = %L),
             count(distinct h.tid), count(distinct o), string_agg(distinct m.model, ',')
      from (%s) h cross join unnest(h.olds) o join public.legacy_id_map m on m.old_id = o
      having count(*) > 0 $q$, r.tbl, r.col, r.typ, r.rel::text, r.col, r.rel::text, r.col, uuid_mig.hits_sql(r.rel, r.col));
  end loop;
end $$;
\pset format unaligned
\pset fieldsep '\t'
select 'INV', tbl, col, typ, case when is_pk then 'PK' when is_fk then 'FK' else 'soft' end kind, rows_with_ids, distinct_ids, models from inv order by kind, tbl, col;
select 'SUMMARY', case when is_pk then 'PK' when is_fk then 'FK' else 'soft' end kind, count(*) cols, sum(rows_with_ids) from inv group by 2;
select 'MAP', model, ts_source, count(*) from public.legacy_id_map group by 2,3 order by 4 desc;
rollback;
