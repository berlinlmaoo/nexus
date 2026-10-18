import Foundation
let old = Data(#"{"scope":"me","units":[],"people":[],"projects":[],"priorities":[],"hideDone":false,"overdueOnly":false}"#.utf8)
var filters = try JSONDecoder().decode(CalFilters.self, from: old)
precondition(filters.folders.isEmpty && filters.scope == .me)
filters.folders = ["019a12d5-0000-7000-8000-000000000001", "legacy-cuid"]
precondition(filters.activeCount == 1)
let roundtrip = try JSONDecoder().decode(CalFilters.self, from: JSONEncoder().encode(filters))
precondition(roundtrip == filters)
precondition(filters.cleared().folders.isEmpty && filters.cleared().scope == .me)
let structure = try JSONDecoder().decode(CalStructure.self, from: Data(#"{"v":1,"access":"all","units":[],"people":[],"folders":[{"id":"019a12d5-0000-7000-8000-000000000001","name":"Parent","depth":0},{"id":"child","name":"Child","parentId":"019a12d5-0000-7000-8000-000000000001","depth":1}]}"#.utf8))
precondition(structure.folders?.last?.depth == 1)
print("5 calendar folder compatibility checks passed")
