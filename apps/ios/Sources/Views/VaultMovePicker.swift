import SwiftUI
import Observation

// ─────────────────────────────────────────────────────────────────────────────
// "Move to…" for one vault item or several (owner, 9 Oct 2026: the INTOO folder had to come out of
// LOGO; several since multi-select, the same day).
//
// The vault's folders, browsed one level at a time exactly like the vault itself: a NavigationStack
// in a sheet, opening where the items are now, with the path above it to walk back up. "Move here"
// moves them into the folder on screen; the first level is the top of the vault.
//
// The items themselves are never listed, so neither they nor anything inside them can be picked.
// The server refuses that anyway, along with a folder the person may not write in. With one item its
// refusal is shown here and the picker stays open; with several, the ones that moved are moved, and
// the screen behind says which did not and why ("2 of 3 moved…").
// ─────────────────────────────────────────────────────────────────────────────

/// What a move did: the items as the server answered (a name may have become "INTOO (2)"), the ones
/// it refused with its reason, and where they went.
struct VaultMoveOutcome {
    let moved: [VaultItem]
    let failed: [VaultBatch.Failure]
    let destination: String
}

struct VaultMovePicker: View {
    let items: [VaultItem]
    var onMoved: (VaultMoveOutcome) -> Void
    var onCancel: () -> Void

    @State private var path: [VaultCrumb]
    @State private var state = VaultMoveState()

    /// `trail`: where the items are now, from the top down (a listing's breadcrumb). Empty opens at
    /// the top.
    init(items: [VaultItem], trail: [VaultCrumb],
         onMoved: @escaping (VaultMoveOutcome) -> Void, onCancel: @escaping () -> Void) {
        self.items = items
        self.onMoved = onMoved
        self.onCancel = onCancel
        // Never open inside one of the items itself (or below it).
        let ids = Set(items.map(\.id))
        let cut = trail.firstIndex(where: { ids.contains($0.id) }) ?? trail.count
        _path = State(initialValue: Array(trail.prefix(cut)))
    }

    var body: some View {
        NavigationStack(path: $path) {
            level(nil)
                .navigationDestination(for: VaultCrumb.self) { crumb in level(crumb) }
        }
    }

    private func level(_ folder: VaultCrumb?) -> some View {
        VaultMoveLevel(folder: folder, items: items, state: state, onCancel: onCancel) {
            Task { await move(to: folder) }
        }
    }

    private func move(to folder: VaultCrumb?) async {
        state.busy = true
        state.problem = nil
        defer { state.busy = false }
        let destination = folder?.name ?? T("Vault")
        // Already there: nothing to send for those.
        let going = items.filter { $0.parentId != folder?.id }
        let target = folder?.id
        let result = await VaultBatch.run(going) { item in
            try await APIClient.shared.vaultMove(item.id, to: target)
        }
        if result.done.isEmpty, let first = result.failed.first {
            // Nothing moved: the reason belongs here, where the person can pick another folder.
            state.problem = result.failed.count == 1 ? first.reason
                : "\(String(format: T("None of the %d items moved."), result.failed.count)) \(first.reason)"
            return
        }
        onMoved(VaultMoveOutcome(moved: result.done, failed: result.failed, destination: destination))
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
    let items: [VaultItem]
    let state: VaultMoveState
    let onCancel: () -> Void
    let onMoveHere: () -> Void

    @State private var folders: [VaultItem] = []
    @State private var canWrite = false
    @State private var loaded = false
    @State private var loadProblem: String?

    /// Where the items already are: moving them here would change nothing.
    private var isHome: Bool { items.allSatisfy { $0.parentId == folder?.id } }

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
                Text(items.count == 1 ? String(format: T("Moving “%@”"), items[0].name)
                     : String(format: T("Moving %d items"), items.count)).lineLimit(1)
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
            let moving = Set(items.map(\.id))
            folders = listing.items.filter { $0.isFolder && !moving.contains($0.id) }
            canWrite = listing.canWrite
            loadProblem = nil
        } catch {
            loadProblem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
        }
        loaded = true
    }
}
