import SwiftUI

// MARK: models

struct MySubmissionsResponse: Decodable, Sendable {
    let submissions: [MySubmission]?
    let statusColumns: [String]?
}
struct MySubmission: Decodable, Identifiable, Sendable {
    let id: String
    let createdAt: String?
    let formName: String?
    let projectName: String?
    let taskTitle: String?
    let status: String?
    let procStatus: String?

    var column: String { (procStatus?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 } ?? "Baru masuk" }
    var title: String { taskTitle ?? formName ?? "Pengajuan" }
}

/// Port of submissions.tsx ("Pengajuan Saya"): read-only kanban of your form submissions,
/// columns driven by the Finance team's status field.
struct SubmissionsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var subs: [MySubmission] = []
    @State private var statusColumns: [String] = []
    @State private var loading = true
    @State private var loadError = false

    private var columns: [String] { ["Baru masuk"] + statusColumns }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loadError {
                EmptyState(icon: "wifi.exclamationmark", title: T("Couldn't load"), subtitle: T("Try again later."))
            } else if subs.isEmpty {
                EmptyState(icon: "tray", title: T("No submissions yet"),
                           subtitle: T("Forms you submit show up on this board together with their status."))
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 6) {
                        Image(systemName: "lock.fill").font(.system(size: 10))
                        Text("Read-only — status diatur tim Finance").font(NXFont.text(11, .semibold))
                    }
                    .foregroundStyle(NX.mutedFg).padding(.horizontal, 12).padding(.vertical, 6)
                    .background(NX.muted.opacity(0.5), in: Capsule()).padding(.horizontal, 16).padding(.top, 12)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(columns, id: \.self) { col in column(col) }
                        }.padding(16)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .navigationTitle("Pengajuan Saya")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func column(_ col: String) -> some View {
        let items = subs.filter { $0.column == col }
        let tone = colTone(col)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(col).font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer()
                Text("\(items.count)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8).padding(.vertical, 2).background(NX.card, in: Capsule())
            }
            .padding(.horizontal, 10).padding(.top, 10)

            VStack(spacing: 8) {
                ForEach(items) { card($0) }
                if items.isEmpty {
                    Text("kosong").font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.7))
                        .frame(maxWidth: .infinity).padding(.vertical, 18)
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
                }
            }
            .padding(.horizontal, 8).padding(.bottom, 8)
        }
        .frame(width: 270, alignment: .leading)
        .background(tone.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(tone.opacity(0.3)))
    }

    private func card(_ s: MySubmission) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "doc.text.fill").font(.system(size: 13)).foregroundStyle(NX.violetText)
                .frame(width: 28, height: 28).background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(s.title).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground).lineLimit(2)
                Text([s.formName, s.projectName].compactMap { $0 }.joined(separator: " · "))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                Text("diajukan \(dateText(s.createdAt))").font(NXFont.text(10)).foregroundStyle(NX.mutedFg.opacity(0.8))
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
    }

    private func colTone(_ name: String) -> Color {
        let n = name.lowercased()
        if n.contains("done") || n.contains("selesai") || n.contains("approve") || n.contains("setuju") || n.contains("paid") { return NX.success }
        if n.contains("progress") || n.contains("proses") { return NX.blue }
        if n.contains("tolak") || n.contains("reject") || n.contains("batal") { return NX.danger }
        return NX.mutedFg
    }
    private func dateText(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "" }
        let f = DateFormatter(); f.dateFormat = "d MMM, HH:mm"; f.locale = Locale(identifier: "id_ID"); f.timeZone = ProjDate.cal.timeZone
        return f.string(from: d)
    }

    private func load() async {
        loadError = false
        do {
            let r = try await APIClient.shared.mySubmissions()
            subs = r.submissions ?? []
            statusColumns = r.statusColumns ?? []
        } catch APIError.unauthorized { auth.logout() }
        catch { loadError = true }
        loading = false
    }
}
