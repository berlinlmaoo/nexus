import Foundation
var checks = 0
func check(_ value: @autoclosure () -> Bool, _ name: String) { precondition(value(), name); checks += 1 }
func obj(_ s: String) -> FormCoedit.Object { FormCoedit.decodeObject(try! JSONSerialization.jsonObject(with: Data(s.utf8))) }
let base = obj(#"{"name":"Original","description":null,"isPublic":true,"requireAuth":true,"fields":[{"id":"a","label":"A","required":true,"future":{"keep":1}},{"id":"b","label":"B"},{"id":"c","label":"C"}],"settings":{"submitLabel":"Send","responseLimit":10},"branding":{"icon":"X","cover":"old"}}"#)
check(FormCoedit.diff(base, base).isEmpty, "unchanged has no writes")
var mine = base; mine["name"] = .string("Mine")
var theirs = base; theirs["description"] = .string("Their description")
let merged = FormCoedit.rebase(base, mine, theirs)
check(merged["name"] == mine["name"], "unsaved title survives")
check(merged["description"] == theirs["description"], "independent remote description appears")
check(FormCoedit.diff(theirs, merged).count == 1, "only unsaved title sent")
var m = FormCoedit.rows(base["fields"]), t = m
m[0]["label"] = .string("Mine A"); t[0]["required"] = .bool(false)
mine = base; theirs = base; mine["fields"] = .array(m.map(FormJSON.object)); theirs["fields"] = .array(t.map(FormJSON.object))
let row = FormCoedit.rows(FormCoedit.rebase(base, mine, theirs)["fields"])[0]
check(row["label"] == .string("Mine A"), "same question local key survives")
check(row["required"] == .bool(false), "same question remote key survives")
check(row["future"] == m[0]["future"], "unknown JSON survives")
let updates = FormCoedit.diff(base, mine)
check(updates.count == 1 && updates[0]["fields"]?.object?.count == 1, "only changed question key is sent")
check(FormCoedit.applying(updates, to: base) == mine, "question ops reproduce draft")
for removedByMine in [false,true] {
 var a = mine, b = theirs
 if removedByMine { a["fields"] = .array(m.dropFirst().map(FormJSON.object)) } else { b["fields"] = .array(t.dropFirst().map(FormJSON.object)) }
 check(!FormCoedit.rows(FormCoedit.rebase(base,a,b)["fields"]).contains { FormCoedit.id($0) == "a" }, "delete wins over edit on either side")
}
mine = base; theirs = base
mine["settings"] = .object(["submitLabel":.string("Go"),"responseLimit":.number(10)])
theirs["settings"] = .object(["submitLabel":.string("Send"),"responseLimit":.number(20)])
let settings = FormCoedit.rebase(base,mine,theirs)["settings"]?.object
check(settings?["submitLabel"] == .string("Go") && settings?["responseLimit"] == .number(20), "settings merge per key")
check(FormCoedit.diff(base,mine)[0]["settings"]?.object?.count == 1, "settings op is a key patch")
for order in [[2,0,1],[1,2,0],[2,1,0],[0,2,1]] {
 mine = base; mine["fields"] = .array(order.map { .object(m[$0]) })
 check(FormCoedit.applying(FormCoedit.diff(base,mine),to:base) == mine, "minimal moves reproduce each permutation")
}
mine = base; theirs = base
var added = FormCoedit.rows(base["fields"]);added.insert(["id":.string("mine"),"label":.string("New")],at:1);mine["fields"] = .array(added.map(FormJSON.object))
var remote = FormCoedit.rows(base["fields"]);remote.insert(["id":.string("theirs")],at:2);theirs["fields"] = .array(remote.map(FormJSON.object))
let ids = FormCoedit.rows(FormCoedit.rebase(base,mine,theirs)["fields"]).map(FormCoedit.id)
check(ids.contains("mine") && ids.contains("theirs"), "concurrent additions both survive")
check(FormCoedit.applying(FormCoedit.diff(base,mine),to:base) == mine, "addition anchor reproduces draft")
let bigBase:FormCoedit.Object = ["fields":.array((0..<500).map { .object(["id":.string("q\($0)"),"label":.string("old")]) })]
var bigMine = bigBase; bigMine["fields"] = .array(FormCoedit.rows(bigBase["fields"]).map { var r=$0;r["label"] = .string("new");return .object(r) })
var ack = bigBase; var loops=0
while ack != bigMine && loops < 4 { let ops=FormCoedit.diff(ack,bigMine);ack=FormCoedit.applying(Array(ops.prefix(200)),to:ack);loops+=1 }
check(ack == bigMine && loops == 3, "500 changes drain in bounded 200-op batches")
let part=FormCoedit.applying(Array(FormCoedit.diff(bigBase,bigMine).prefix(200)),to:bigBase)
check(FormCoedit.diff(part,FormCoedit.rebase(part,bigMine,part)).count == 300, "acknowledging first chunk retains all 300 unsent edits")
print("Form co-editing: \(checks) field merge, deletion, order, unknown JSON and chunking checks passed")
