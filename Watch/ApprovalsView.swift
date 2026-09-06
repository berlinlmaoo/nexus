import SwiftUI

/// Leave and permit requests waiting on a decision.
///
/// This is the reason the watch app exists. Approving is one word to an endpoint that is already
/// guarded — the role check and the four-eyes rule that refuses to let anyone review their own
/// request both live on the server — so the wrist adds convenience without adding authority.
struct ApprovalsView: View {
    @Environment(WatchAuth.self) private var auth

    @State private var requests: [AttendanceRequest] = []
    @State private var error: String?
    @State private var loading = true
    /// Ids currently being sent, so a row cannot be answered twice by an impatient second tap.
    @State private var inFlight: Set<String> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if loading && requests.isEmpty {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    Text(error).font(.caption2).foregroundStyle(.secondary)
                } else if requests.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "checkmark.circle").foregroundStyle(.secondary)
                        Text("Nothing waiting").font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
                } else {
                    ForEach(requests) { request in
                        RequestCard(
                            request: request,
                            busy: inFlight.contains(request.id),
                            decide: { approve in await decide(request, approve: approve) }
                        )
                    }
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Approvals")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let session = auth.session else { return }
        error = nil
        do { requests = try await WatchAPI.pendingRequests(session) }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't load." }
        loading = false
    }

    private func decide(_ request: AttendanceRequest, approve: Bool) async {
        guard let session = auth.session, !inFlight.contains(request.id) else { return }
        inFlight.insert(request.id)
        defer { inFlight.remove(request.id) }
        do {
            try await WatchAPI.review(session, id: request.id, approve: approve)
            // Drop it immediately. Re-fetching first would leave the row sitting there long enough
            // to be tapped again, and the server answers the second tap with a 409.
            requests.removeAll { $0.id == request.id }
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed."
        }
    }
}

private struct RequestCard: View {
    let request: AttendanceRequest
    let busy: Bool
    let decide: (Bool) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(request.user?.name ?? "Someone")
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            HStack(spacing: 6) {
                Button {
                    Task { await decide(false) }
                } label: {
                    Image(systemName: "xmark").frame(maxWidth: .infinity)
                }
                .tint(.red)

                Button {
                    Task { await decide(true) }
                } label: {
                    Image(systemName: "checkmark").frame(maxWidth: .infinity)
                }
                .tint(.green)
            }
            .buttonStyle(.bordered)
            .controlSize(.mini)
            .disabled(busy)
            .opacity(busy ? 0.4 : 1)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10).fill(.quaternary.opacity(0.4)))
    }

    private var subtitle: String {
        var parts: [String] = []
        if let type = request.type?.replacingOccurrences(of: "_", with: " ").capitalized {
            parts.append(type)
        }
        if let start = request.startDate?.prefix(10) {
            parts.append(String(start))
        }
        if let reason = request.reason, !reason.isEmpty {
            parts.append(reason)
        }
        return parts.joined(separator: " · ")
    }
}
