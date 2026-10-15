import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Who may open a vault folder or file, and who may add to a folder (9 Oct 2026). The server has had
// the thresholds since the vault began (PATCH minReadRole / minWriteRole, BoD only — the listing's
// `canManageAccess`); this is the first screen on the phone that sets them. Same three choices as the
// web: the server stores "everyone" as no lock of its own, which means "as the folder above" — at the
// top level that is everyone.
// ─────────────────────────────────────────────────────────────────────────────

struct VaultAccessSheet: View {
    let item: VaultItem
    var onDone: (_ saved: Bool) -> Void

    /// "" = no lock of its own (inherit). The other two are the server's values.
    @State private var readRole: String
    @State private var write: String
    @State private var busy = false
    @State private var problem: String?

    init(item: VaultItem, onDone: @escaping (_ saved: Bool) -> Void) {
        self.item = item
        self.onDone = onDone
        _readRole = State(initialValue: item.minReadRole ?? "")
        _write = State(initialValue: item.minWriteRole ?? "")
    }

    private var changed: Bool {
        readRole != (item.minReadRole ?? "") || (item.isFolder && write != (item.minWriteRole ?? ""))
    }

    var body: some View {
        Form {
            Section {
                picker(item.isFolder ? T("Who can open it") : T("Who can open this file"), selection: $readRole)
            } footer: {
                Text(item.isFolder
                     ? T("A lock applies to everything inside this folder. Something inside it can be locked further, never opened wider.")
                     : T("Who in the company can see and open this file."))
            }
            if item.isFolder {
                Section {
                    picker(T("Who can add files"), selection: $write)
                } footer: {
                    Text(T("Whoever uploaded a file can still rename, move or delete it."))
                }
            }
            Section {
                Text(T("Links already sent follow the lock too: an outside link shows only what its maker may still see."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            if let problem {
                Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
        }
        .navigationTitle(T("Access"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { onDone(false) } }
            ToolbarItem(placement: .confirmationAction) {
                Button(T("Save")) { Task { await save() } }.disabled(!changed || busy)
            }
        }
    }

    private func picker(_ title: String, selection: Binding<String>) -> some View {
        Picker(title, selection: selection) {
            Text(item.parentId == nil ? T("Everyone in the company") : T("Same as the folder above")).tag("")
            Text(T("Managers and above")).tag("MANAGER_PLUS")
            Text(T("Board and above")).tag("BOD_PLUS")
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        problem = nil
        do {
            try await APIClient.shared.vaultSetAccess(
                item.id,
                read: readRole != (item.minReadRole ?? "") ? .some(readRole.isEmpty ? nil : readRole) : .none,
                write: item.isFolder && write != (item.minWriteRole ?? "") ? .some(write.isEmpty ? nil : write) : .none)
            onDone(true)
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the access")
        }
    }
}
