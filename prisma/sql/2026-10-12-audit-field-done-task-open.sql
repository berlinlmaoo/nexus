-- DEV ONLY (owner, 12 Oct 2026). Finance PATS Entertainment: 5 tasks had the custom Status = "Done" while
-- the task itself was NOT checked done (prod: status TODO, sitting in the "Done" section). The first
-- --unify-status run followed the field and closed them. The Done checkbox wins both ways: they go back
-- to open, in the "To Do" column. Idempotent: only touches these ids while they are still DONE with no completer.
WITH ids(id) AS (VALUES ('cmtlxq07i02gu01vuwl0icuxl'), ('cmtlw3gs202b201vupvu7dtcj'), ('cmtlw4f5602fu01vucnzcskmg'), ('cmtwmhszm049701kekimhi0qq'), ('cmtsncz8600dr01szmub6kqr3')),
todo AS (SELECT id FROM "TaskList" WHERE "projectId" = 'e377c25d8baf4aec95471663780fb198' AND "taskStatus" = 'TODO' ORDER BY position LIMIT 1),
base AS (SELECT coalesce(max(t.position), -1) AS p FROM "Task" t, todo WHERE t."taskListId" = todo.id),
pick AS (SELECT t.id, row_number() OVER (ORDER BY t."createdAt") AS rn FROM "Task" t JOIN ids USING (id) WHERE t.status = 'DONE' AND t."completedById" IS NULL)
UPDATE "Task" t SET status = 'TODO', "completedAt" = NULL, "taskListId" = todo.id, position = base.p + pick.rn, "updatedAt" = now()
FROM pick, todo, base WHERE t.id = pick.id;
