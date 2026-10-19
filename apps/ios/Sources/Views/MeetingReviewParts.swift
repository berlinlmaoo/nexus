import SwiftUI

// Meeting notes review, an action item's card (Berlin device review 19 Oct, R-16): the owner is a people chip
// and the due date a compact row with a date chip, no boxed fields.

/// The owner of a minutes action item: "+ Owner" when none, avatar + name when set. The menu lists the
/// project's members, takes another name typed in, or removes the owner. The minutes store a name, not an id.
struct MeetingOwnerChip: View {
    let owner: String?
    let members: [GideonTaskOptions.Member]
    let onChange: (String?) -> Void
    @State private var typing = false
    @State private var typed = ""

    var body: some View {
        Menu {
            ForEach(members) { member in
                Button { onChange(member.name) } label: {
                    Label(member.name ?? "—", systemImage: owner != nil && owner == member.name ? "checkmark" : "person")
                }
            }
            Button { typed = owner ?? ""; typing = true } label: { Label(T("Type a name…"), systemImage: "character.cursor.ibeam") }
            if owner != nil {
                Button(role: .destructive) { onChange(nil) } label: { Label(T("Remove owner"), systemImage: "person.badge.minus") }
            }
        } label: { chip }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .accessibilityLabel(owner.map { T("Owner") + ": " + $0 } ?? T("Owner"))
        .alert(T("Owner"), isPresented: $typing) {
            TextField(T("Name"), text: $typed)
            Button(T("Save")) {
                let name = typed.trimmingCharacters(in: .whitespacesAndNewlines)
                onChange(name.isEmpty ? nil : name)
            }
            Button(T("Cancel"), role: .cancel) {}
        }
    }

    private var chip: some View {
        HStack(spacing: 6) {
            if let owner {
                AvatarView(url: members.first { $0.name == owner }?.avatar, initial: String(owner.prefix(1)).uppercased(), size: 22)
                Text(owner).lineLimit(1)
            } else {
                Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                Text(T("Owner"))
            }
        }
        .font(NXFont.text(13, .medium))
        .foregroundStyle(owner == nil ? NX.mutedFg : NX.foreground)
        .padding(.leading, owner == nil ? 10 : 4).padding(.trailing, 10)
        .frame(minHeight: 30)
        .background(NX.muted, in: Capsule())
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// The small trash button in a card's top-right corner.
struct MeetingRemoveButton: View {
    let label: String
    let action: () -> Void
    var body: some View {
        Button(role: .destructive, action: action) {
            Image(systemName: "trash").font(.system(size: 13, weight: .medium)).foregroundStyle(NX.danger)
                .frame(width: 30, height: 30)
                .background(NX.danger.opacity(0.1), in: Circle())
                .touchTarget44(drawn: 30)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

#if DEBUG
/// Debug UI tour: a meeting ready for review, drawn from a fixture (`nexus://meetings/tour-review`), so the review
/// cards can be checked without uploading audio to the server. Nothing is saved: the tour only looks.
enum MeetingReviewTourFixture {
    static let id = "tour-review"
    static func meeting() -> MeetingNote? {
        guard TourMode.isActive else { return nil }
        let json = """
        {"id":"tour-review","title":"Meeting Notes QA","status":"READY","progress":1,"language":"auto","source":"upload",
         "projectId":"tour-project","project":{"id":"tour-project","name":"Finance PATS","icon":null},
         "createdBy":{"id":"tour"},"audio":{"name":"meeting.m4a","mime":"audio/mp4","bytes":32610713,"received":32610713,"available":false},
         "taskCount":0,"version":1,"createdAt":"2026-10-19T10:00:00Z","updatedAt":"2026-10-19T10:00:00Z",
         "can":{"edit":true,"apply":true,"delete":true,"retry":true},
         "overview":"Monthly finance sync: invoices, the office wifi contract and the Q4 budget.",
         "mom":{"attendees":["Rina","Bagas"],"topics":[{"title":"Office wifi","points":["Dedicated line renews in November"]}],
                "decisions":["Pay the wifi from the operations budget"],"openQuestions":[],
                "actionItems":[{"text":"Pay the dedicated wifi invoice","owner":"Rina","due":"2026-10-24"},
                               {"text":"Send the Q4 budget draft to the board","owner":null,"due":null}]},
         "proposals":[{"key":"p1","include":true,"title":"Pay the dedicated wifi invoice","description":"","assigneeIds":["m1"],"dueDate":"2026-10-24"},
                      {"key":"p2","include":true,"title":"Send the Q4 budget draft","description":"","assigneeIds":[],"dueDate":null}],
         "members":[{"id":"m1","name":"Rina","avatar":null},{"id":"m2","name":"Bagas","avatar":null}]}
        """
        return try? JSONDecoder().decode(MeetingNote.self, from: Data(json.utf8))
    }
}
#endif
