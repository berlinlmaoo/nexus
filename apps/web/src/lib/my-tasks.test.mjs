// node --experimental-strip-types src/lib/my-tasks.test.mjs
import assert from "node:assert/strict";
import { groupMyTasks, isOverdueAt, daysLate } from "./my-tasks.ts";

// 13 Oct 2026, 20:30 WIB
const now = Date.parse("2026-10-13T13:30:00Z");
const t = (id, dueDate, extra = {}) => ({ id, title: id, status: "TODO", priority: "NONE", dueDate, ...extra });

// Date-only due today (both storage shapes) is not overdue; yesterday is.
assert.equal(isOverdueAt("2026-10-13T00:00:00.000Z", now), false);
assert.equal(isOverdueAt("2026-10-12T17:00:00.000Z", now), false); // 00:00 WIB 13 Oct
assert.equal(isOverdueAt("2026-10-12T00:00:00.000Z", now), true);
// Timed: 13 Oct 10:00 WIB has passed at 20:30 WIB.
assert.equal(isOverdueAt("2026-10-13T03:00:00.000Z", now), true);
assert.equal(isOverdueAt("2026-10-13T14:00:00.000Z", now), false);
assert.equal(daysLate("2026-10-11T00:00:00.000Z", now), 2);

const rows = [
  t("later-19", "2026-10-19T00:00:00.000Z"),
  t("soon-15", "2026-10-15T00:00:00.000Z"),
  t("soon-14", "2026-10-14T00:00:00.000Z"),
  t("over-11-urgent", "2026-10-11T00:00:00.000Z", { priority: "URGENT" }),
  t("over-12", "2026-10-12T00:00:00.000Z"),
  t("soon-16-end", "2026-10-16T16:59:00.000Z"), // 23:59 WIB on the 3rd day ahead → still "soon"
  t("later-17", "2026-10-17T00:00:00.000Z"),
  t("nodate-low", null, { priority: "LOW" }),
  t("nodate-urgent", null, { priority: "URGENT" }),
  t("today", "2026-10-13T00:00:00.000Z"),
  t("done-old", "2026-10-01T00:00:00.000Z", { status: "DONE", completedAt: "2026-10-01T00:00:00Z" }),
  t("done-new", null, { status: "DONE", completedAt: "2026-10-13T01:00:00Z" }),
  t("cancelled", "2026-10-01T00:00:00.000Z", { status: "CANCELLED" }),
];
const g = Object.fromEntries(groupMyTasks(rows, now).map((x) => [x.key, x.items.map((i) => i.id)]));
assert.deepEqual(g.overdue, ["over-11-urgent", "over-12"]);
assert.deepEqual(g.soon, ["today", "soon-14", "soon-15", "soon-16-end"]);
assert.deepEqual(g.later, ["later-17", "later-19", "nodate-urgent", "nodate-low"]);
assert.deepEqual(g.done, ["done-new"]);

// 40 open tasks: nothing dropped by the grouping (the screen pages them).
const many = Array.from({ length: 40 }, (_, i) => t(`n${i}`, null));
assert.equal(groupMyTasks(many, now)[0].items.length, 40);
console.log("my-tasks: ok");
