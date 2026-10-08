import SwiftUI
import Observation

// ─────────────────────────────────────────────────────────────────────────────
// "Move to…" for one vault item (owner, 9 Oct 2026: the INTOO folder had to come out of LOGO).
//
// The vault's folders, browsed one level at a time exactly like the vault itself: a NavigationStack
// in a sheet, opening where the item is now, with the path above it to walk back up. "Move here"
// moves it into the folder on screen; the first level is the top of the vault.
//
// The item itself is never listed, so neither it nor anything inside it can be picked. The server
// refuses that anyway, along with a folder the person may not write in, and when it refuses, its
// reason is what is shown.
// ─────────────────────────────────────────────────────────────────────────────

struct VaultMovePicker: View {
    let item: VaultItem
    var onMoved: (VaultItem, String) -> Void
    var onCancel: () -> Void

    @State private var path: [VaultCrumb]
    @State private var state = VaultMoveState()

    /// `trail`: where the item is now, from the top down (a listing's breadcrumb). Empty opens at
    /// the top.
    init(item: VaultItem, trail: [VaultCrumb],
         onMoved: @escaping (VaultItem, String) -> Void, onCancel: @escaping () -> Void) {
        self.item = item
        self.onMoved = onMoved
        self.onCancel = onCancel
        // Never open inside the item itself (or below it).
        let cut = trail.firstIndex(where: { $0.id == item.id }) ?? trail.count
        _path = State(initialValue: Array(trail.prefix(cut)))
    }

    var body: some View {
        NavigationStack(path: $path) {
            level(nil)
                .navigationDestination(for: VaultCrumb.self) { crumb in level(crumb) }
        }
    }

    private func level(_ folder: VaultCrumb?) -> some View {
        VaultMoveLevel(folder: folder, item: item, state: state, onCancel: onCancel) {
            Task { await move(to: folder) }
        }
    }

    private func move(to folder: VaultCrumb?) async {
        state.busy = true
        state.problem = nil
        defer { state.busy = false }
        do {
            let moved = try await APIClient.shared.vaultMove(item.id, to: folder?.id)
            onMoved(moved, folder?.name ?? T("Vault"))
        } catch {
            state.problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
        }
    }
}

/// Shared by every level of the picker, so the one that is on screen shows the request in flight
/// and the server's refusal however deep the stack is.
@Observable
final class VaultMoveState {
    var busy = false
    var problem: String?
}

private struct VaultMoveLevel: View {
    /// nil = the top of the vault.
    let folder: VaultCrumb?
    let item: VaultItem
    let state: VaultMoveState
    let onCancel: () -> Void
    let onMoveHere: () -> Void

    @State private var folders: [VaultItem] = []
    @State private var canWrite = false
    @State private var loaded = false
    @State private var loadProblem: String?

    /// Where the item already is: moving it here would change nothing.
    private var isHome: Bool { folder?.id == item.parentId }

    var body: some View {
        List {
            Section {
                if !loaded {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if let loadProblem {
                    Text(loadProblem).font(NXFont.text(13)).foregroundStyle(NX.danger)
                } else if folders.isEmpty {
                    Text(T("No folders in here.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                } else {
                    ForEach(folders) { f in
                        NavigationLink(value: VaultCrumb(id: f.id, name: f.name)) {
                            Label {
                                Text(f.name).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                            } icon: {
                                Image(systemName: "folder.fill").foregroundStyle(NX.violetText)
                            }
                        }
                    }
                }
            } header: {
                Text(String(format: T("Moving “%@”"), item.name)).lineLimit(1)
            } footer: {
                if isHome {
                    Text(T("It's already in this folder."))
                } else if loaded && loadProblem == nil && !canWrite {
                    Text(T("You can't add to this folder."))
                }
            }
            if let problem = state.problem {
                Section {
                    Text(problem).font(NXFont.text(13)).foregroundStyle(NX.danger)
                }
            }
        }
        .navigationTitle(folder?.name ?? T("Vault"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(T("Cancel"), action: onCancel)
            }
            ToolbarItem(placement: .confirmationAction) {
                if state.busy {
                    ProgressView()
                } else {
                    Button(T("Move here"), action: onMoveHere)
                        .disabled(isHome || !loaded || loadProblem != nil || !canWrite)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let listing = try await APIClient.shared.vaultList(parentId: folder?.id)
            folders = listing.items.filter { $0.isFolder && $0.id != item.id }
            canWrite = listing.canWrite
            loadProblem = nil
        } catch {
            loadProblem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
        }
        loaded = true
    }
}
