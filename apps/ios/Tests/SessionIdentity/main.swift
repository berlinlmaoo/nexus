import Foundation
let old = Session(token: "unchanged-test-token", cookieName: "session", userId: "qadevuser00000000000005", userName: "Old", userEmail: "qa5@dev.invalid")
let uuid = "01a12d57-8a97-7004-bfb0-f6729f9cce12"
let current = old.refreshedIdentity(id: uuid, name: "QA Dev 5", email: "qa5@dev.invalid")!
precondition(current.userId == uuid && current.userName == "QA Dev 5")
precondition(current.token == old.token && current.cookieName == old.cookieName)
precondition(current.cookieHeader == old.cookieHeader)
precondition(current.refreshedIdentity(id: uuid, name: nil, email: nil) == current)
precondition(current.refreshedIdentity(id: "", name: nil, email: nil) == nil)
precondition(current.refreshedIdentity(id: "  ", name: nil, email: nil) == nil)
let roundtrip = try JSONDecoder().decode(Session.self, from: JSONEncoder().encode(current))
precondition(roundtrip == current)
precondition(roundtrip.refreshedIdentity(id: old.userId, name: nil, email: nil)?.userId == old.userId)
print("8 persisted identity migration checks passed (credentials preserved, opaque IDs, invalid profile, round trip)")
