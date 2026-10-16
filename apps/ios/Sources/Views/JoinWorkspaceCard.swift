import SwiftUI

/// "Join your company's workspace" (owner, 16 Oct 2026, item 5; web Settings › Profile): an account whose only
/// workspace is its own personal one enters the company's workspace code here. Joining DELETES the personal
/// workspace with everything in it, so a centred alert says so first. Shown only when the server says the
/// account is eligible (GET /api/workspaces/join); draws nothing otherwise, or on a server without the route.
struct JoinWorkspaceCard: View {
    @State private var eligible = false
    @State private var personalName = ""
    @State private var code = ""
    @State private var confirming = false
    @State private var busy = false
    @State private var problem: String?
    @State private var joinedName: String?

    var body: some View {
        Group {
            if let joinedName {
                Label(T("You joined {name}.").replacingOccurrences(of: "{name}", with: joinedName), systemImage: "checkmark.circle.fill")
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.success)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .nexusCard()
            } else if eligible {
                card
            }
        }
        .task { await check() }
        .alert(T("Delete “{name}” and join?").replacingOccurrences(of: "{name}", with: personalName),
               isPresented: $confirming) {
            Button(T("Cancel"), role: .cancel) {}
            Button(T("Delete and join"), role: .destructive) { Task { await join() } }
        } message: {
            Text(T("Its projects, tasks and files are deleted for good. Nothing is moved to the company's workspace."))
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(T("Join your company's workspace")).font(NXFont.text(17, .semibold)).foregroundStyle(NX.foreground)
                    .accessibilityAddTraits(.isHeader)
                Text(T("Ask your company's admin for the code. Your personal workspace and everything in it is deleted when you join."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(T("Workspace code")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                TextField("ABCD 1234-EF56", text: $code)
                    .font(NXFont.text(16)).padding(12)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel(T("Workspace code"))
                    .submitLabel(.join)
                    .onSubmit { if canJoin { confirming = true } }
            }
            if let problem {
                Text(problem).font(NXFont.text(13)).foregroundStyle(NX.danger).fixedSize(horizontal: false, vertical: true)
            }
            Button { confirming = true } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(NX.background) }
                    Text(T("Join workspace"))
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(NXButtonStyle(kind: .primary))
            .frame(minHeight: 44)
            .disabled(!canJoin)
        }
        .nexusCard()
    }

    private var canJoin: Bool { !busy && !code.trimmingCharacters(in: .whitespaces).isEmpty }

    private func check() async {
        guard let r = try? await APIClient.shared.workspaceJoinStatus() else { return }
        eligible = r.eligible
        personalName = r.personalWorkspace?.name ?? ""
    }

    private func join() async {
        busy = true; defer { busy = false }
        problem = nil
        do {
            let r = try await APIClient.shared.joinWorkspace(code: code)
            joinedName = r.workspace?.name ?? ""
            eligible = false
            // Everything workspace-scoped comes again: the role and the sidebar groups, projects, home, calendar.
            await Viewer.shared.reload()
            NotificationCenter.default.post(name: .nexusWorkspaceChanged, object: nil)
        } catch APIError.http(let status, _) where [400, 403, 409].contains(status) {
            switch status {
            case 400: problem = T("That workspace code is not valid.")
            case 403: problem = T("Your account already shares a workspace with other people. Ask that workspace's admin to add you instead.")
            default: problem = T("You are already in that workspace.")
            }
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("That workspace code is not valid.")
        }
    }
}

struct WorkspaceJoinStatus: Decodable, Sendable {
    struct Personal: Decodable, Sendable { let id: String; let name: String? }
    let eligible: Bool
    let personalWorkspace: Personal?
}

struct WorkspaceJoined: Decodable, Sendable {
    struct Workspace: Decodable, Sendable { let id: String; let name: String? }
    let ok: Bool?
    let workspace: Workspace?
    let removedWorkspaces: [String]?
}
