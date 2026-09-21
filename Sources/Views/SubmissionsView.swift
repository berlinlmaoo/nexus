import SwiftUI
import UIKit

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

/// A submission to open, by id.
///
/// `.sheet(item:)` needs something Identifiable and `String` is not. The row it came from rides
/// along when the tap started on a card, so the sheet has a title to draw while the detail loads —
/// a notification names an id and nothing else, and then there is none.
struct SubmissionRef: Identifiable {
    let id: String
    /// Explicitly defaulted so `SubmissionRef(id:)` reads as the notification case it is.
    var preview: MySubmission? = nil
}

/// GET /api/forms/my-submissions/{submissionId} — the answers behind one card, plus the payout
/// proof the finance team attaches to the task it created. The board list carries neither.
struct MySubmissionDetail: Decodable, Sendable {
    let id: String
    let createdAt: String?
    let formName: String?
    let projectName: String?
    let taskTitle: String?
    let status: String?       // the task enum (TODO/DONE/...)
    let stage: String?        // the board column the task sits in
    let procStatus: String?   // the finance team's "Status" custom field
    let answers: [SubmissionAnswer]?
    let proofs: [SubmissionProof]?
}

struct SubmissionAnswer: Decodable, Identifiable, Sendable {
    let id: String
    let label: String?
    let type: String?
    let value: SubmissionAnswerValue?

    var display: String { value?.display ?? "" }
}

/// One answer, flattened to display text as it is decoded.
///
/// A form field stores whatever its type produced: a string, a number, a multi-select array, an
/// uploaded file as `{name}`, a picked place as `{label}`. The web collapses all of it in `fmtVal`
/// before drawing anything, and doing the same here keeps the JSON shape out of the view.
struct SubmissionAnswerValue: Decodable, Sendable {
    let text: String
    /// A checkbox stays a boolean rather than becoming "Yes" here: decoding runs off the main
    /// actor, and the wording has to be picked where a language switch is actually observed.
    let flag: Bool?

    var display: String { flag.map { $0 ? T("Yes") : T("No") } ?? text }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { text = s; flag = nil }
        else if let b = try? c.decode(Bool.self) { text = ""; flag = b }
        // Int before Double, or a whole number comes out as "1000.0" — not what anybody typed.
        else if let i = try? c.decode(Int.self) { text = String(i); flag = nil }
        else if let d = try? c.decode(Double.self) { text = String(d); flag = nil }
        else if let list = try? c.decode([SubmissionAnswerValue].self) {
            text = list.map(\.text).filter { !$0.isEmpty }.joined(separator: ", "); flag = nil
        }
        else if let o = try? c.decode(NamedValue.self) { text = o.name ?? o.label ?? ""; flag = nil }
        else { text = ""; flag = nil }
    }

    /// The only two objects a field stores, both already carrying their own display string.
    private struct NamedValue: Decodable { let name: String?; let label: String? }
}

/// "Bukti Pencairan" — what the finance team attaches to the task once it pays out.
struct SubmissionProof: Decodable, Identifiable, Sendable {
    let id: String
    let name: String?
    let url: String?
    let mimeType: String?
    let size: Int?

    var isImage: Bool { (mimeType ?? "").hasPrefix("image/") }

    /// Same rule as a sick note's attachment: the server hands out an app-relative path, and the
    /// route behind it refuses anyone without the session cookie — so only the app's own image
    /// loader can fetch it, never Safari.
    var absoluteURL: URL? {
        guard let path = url, !path.isEmpty else { return nil }
        return URL(string: path.hasPrefix("http") ? path : Config.baseURL.absoluteString + path)
    }
}

/// Column tinting, shared by the board and the detail sheet so a status is the same colour in both.
private func subColTone(_ name: String) -> Color {
    let n = name.lowercased()
    if n.contains("done") || n.contains("selesai") || n.contains("approve") || n.contains("setuju") || n.contains("paid") { return NX.success }
    if n.contains("progress") || n.contains("proses") { return NX.blue }
    if n.contains("tolak") || n.contains("reject") || n.contains("batal") { return NX.danger }
    return NX.mutedFg
}

private func subDateText(_ iso: String?) -> String {
    guard let d = ProjDate.parse(iso) else { return "" }
    let f = DateFormatter(); f.dateFormat = "d MMM, HH:mm"; f.locale = Locale(identifier: "id_ID"); f.timeZone = ProjDate.cal.timeZone
    return f.string(from: d)
}

/// Port of submissions.tsx ("Pengajuan Saya"): read-only kanban of your form submissions,
/// columns driven by the Finance team's status field.
struct SubmissionsView: View {
    @Environment(AppRouter.self) private var router
    @Environment(AuthStore.self) private var auth
    @State private var subs: [MySubmission] = []
    @State private var statusColumns: [String] = []
    @State private var loading = true
    @State private var loadError = false
    @State private var opened: SubmissionRef?

    // The first column is ours; the rest are status names straight from the server (and follow
    // the server's language, not the app's).
    private var columns: [String] { [T("New")] + statusColumns }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loadError {
                EmptyState(icon: "wifi.exclamationmark", title: T("Couldn't load"), subtitle: T("Try again later."))
            } else if subs.isEmpty {
                EmptyState(icon: "tray", title: T("No submissions yet"),
                           subtitle: T("Everything you file through a form — a request, a reimbursement, a report — lands on this board with its status, so you never have to ask where it got to. Start with a form."),
                           actionTitle: T("Open forms"), actionIcon: "doc.text") { router.go(.forms) }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 6) {
                        Image(systemName: "lock.fill").font(.system(size: 10))
                        Text(T("Read-only — status is set by the Finance team")).font(NXFont.text(11, .semibold))
                    }
                    .foregroundStyle(NX.mutedFg).padding(.horizontal, 12).padding(.vertical, 6)
                    .background(NX.muted.opacity(0.5), in: Capsule()).padding(.horizontal, 16).padding(.top, 12)

                    // Without snapping the horizontal scroll stops anywhere, so the next column is
                    // always sliced in half at the screen edge - that is what made this board look
                    // messy. viewAligned parks each column at a clean position.
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(columns, id: \.self) { col in column(col) }
                        }
                        .padding(16)
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.viewAligned)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .navigationTitle(T("My Submissions"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $opened) { SubmissionDetailSheet(submissionId: $0.id, preview: $0.preview) }
    }

    private func column(_ col: String) -> some View {
        let items = subs.filter { $0.column == col }
        let tone = subColTone(col)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(col).font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer()
                Text("\(items.count)").font(NXFont.text(12, .bold)).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 8).padding(.vertical, 2).background(NX.card, in: Capsule())
            }
            .padding(.horizontal, 10).padding(.top, 10)

            // Each column scrolls on its own. Without this the tallest column set the height of
            // the whole board, the board outgrew the screen, and the excess was split off the top
            // and the bottom - which is why the column headings came out sliced in half and the
            // last cards vanished under the tab bar. A horizontal board on a phone wants exactly
            // this: swipe sideways between columns, scroll down inside one.
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(items) { s in
                        Button { opened = SubmissionRef(id: s.id, preview: s) } label: { card(s) }
                            .buttonStyle(.plain)
                            .hoverEffect(.highlight)
                    }
                    if items.isEmpty {
                        Text(T("Empty")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.7))
                            .frame(maxWidth: .infinity).padding(.vertical, 18)
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
                    }
                }
                .padding(.horizontal, 8).padding(.bottom, 8)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        // A fixed 270 looks arbitrary: on a small phone the next column is a sliver, on a large
        // one it is half a column. Tying the width to the CONTAINER keeps the same "one column plus
        // a hint of the next" everywhere, which is what makes a horizontal board readable.
        //
        // The container, not `UIScreen.main.bounds`. That call answers for the DEVICE's screen, not
        // the window this view is actually in, and the two stop agreeing the moment the app is not
        // fullscreen on one fixed display: iPad Split View, a resized Mac window, and — the reason
        // this was changed — a folding iPhone, where the same running app moves between a 5.4"
        // outer and a 7.6" inner display. `UIScreen.main` reports one number through all of that,
        // so the board would keep sizing its columns for a screen it is no longer on. It has also
        // been deprecated since iOS 16.
        //
        // `containerRelativeFrame` is iOS 17+, which this app already requires, and it re-reads on
        // every layout pass — so unfolding resizes the columns without anything having to observe
        // the fold or know a device exists.
        .containerRelativeFrame(.horizontal, alignment: .leading) { width, _ in
            min(320, width * 0.82)
        }
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
                Text("\(T("Submitted")) \(subDateText(s.createdAt))").font(NXFont.text(10)).foregroundStyle(NX.mutedFg.opacity(0.8))
            }
            Spacer(minLength: 0)
            // The card looked exactly like this while it did nothing, so it has to say it opens.
            Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.mutedFg.opacity(0.6))
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
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

/// What a card opens. The board was read-only AND inert: it showed a title and a column name, and
/// the person who filed the thing had no way back to what they had actually written, or to the
/// payout proof the finance team had already attached to it.
///
/// Read-only, like the board. The web drawer also deletes a submission (and the project task with
/// it); that is a separate, destructive feature and is deliberately not here.
struct SubmissionDetailSheet: View {
    let submissionId: String
    /// The board row this was opened from, when there was one. A notification carries an id alone,
    /// so every read of it has to survive being nil.
    var preview: MySubmission? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var detail: MySubmissionDetail?
    @State private var loading = true
    @State private var failed = false
    @State private var viewingPhoto: PhotoRef?

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        if loading {
                            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else if failed {
                            Text(T("Couldn't load the details.")).font(NXFont.text(13)).foregroundStyle(NX.danger)
                        } else if let d = detail {
                            answerList(d)
                            proofList(d)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                }
            }
            .navigationTitle(T("Submission"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Close")) { dismiss() } } }
            .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
        }
        .task { await load() }
    }

    /// Drawn from the row that was tapped, then refined once the detail lands — so the sheet is
    /// never a blank page with a spinner on it. Opened from a notification there is no row, and
    /// the generic title stands only until the fetch answers.
    private var header: some View {
        let subtitle = [detail?.formName ?? preview?.formName, detail?.projectName ?? preview?.projectName]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return VStack(alignment: .leading, spacing: 6) {
            Text(detail?.taskTitle ?? preview?.title ?? T("Submission"))
                .font(NXFont.display(19, .bold)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
            if !subtitle.isEmpty {
                Text(subtitle).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            if !statusChips.isEmpty {
                HStack(spacing: 6) {
                    ForEach(statusChips, id: \.self) { c in
                        Text(c).font(NXFont.text(11, .bold)).foregroundStyle(subColTone(c))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(subColTone(c).opacity(0.15), in: Capsule())
                    }
                }
            }
            Text("\(T("Submitted")) \(subDateText(detail?.createdAt ?? preview?.createdAt))")
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.8))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Stage and processing status, in the finance team's own words. The task enum is deliberately
    /// left out: "TODO" means nothing to the person who filed a reimbursement.
    ///
    /// De-duplicated because the two often agree ("Done" as both the board column and the status),
    /// and ForEach keyed on the string itself would then be drawing two rows with one id.
    private var statusChips: [String] {
        var seen: [String] = []
        for raw in [detail?.stage, detail?.procStatus ?? preview?.procStatus] {
            let c = (raw ?? "").trimmingCharacters(in: .whitespaces)
            if !c.isEmpty && !seen.contains(c) { seen.append(c) }
        }
        return seen
    }

    @ViewBuilder private func answerList(_ d: MySubmissionDetail) -> some View {
        let rows = d.answers ?? []
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(T("Submission details"))
            if rows.isEmpty {
                Text(T("No answers were recorded.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(rows) { a in
                    VStack(alignment: .leading, spacing: 3) {
                        Text((a.label ?? a.id).uppercased())
                            .font(NXFont.text(10, .bold)).tracking(0.4).foregroundStyle(NX.mutedFg)
                        Text(a.display.isEmpty ? "—" : a.display)
                            .font(NXFont.text(14)).foregroundStyle(NX.foreground)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func proofList(_ d: MySubmissionDetail) -> some View {
        let items = d.proofs ?? []
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                // Left in Indonesian: it is what the finance team calls the file on the web and in
                // the office, and an English label here would only make it harder to recognise.
                SectionLabel("Bukti Pencairan")
                ForEach(items) { proofRow($0) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The row says "Tap to enlarge", so the whole row is the target — not the 44pt thumbnail
    /// sitting beside those words.
    @ViewBuilder private func proofRow(_ p: SubmissionProof) -> some View {
        if p.isImage, let url = p.absoluteURL {
            Button { viewingPhoto = PhotoRef(url: url, name: p.name) } label: {
                proofRowBody(p).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            proofRowBody(p)
        }
    }

    private func proofRowBody(_ p: SubmissionProof) -> some View {
        HStack(spacing: 10) {
            if p.isImage, let url = p.absoluteURL {
                CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else {
                Image(systemName: "paperclip").font(.system(size: 13)).foregroundStyle(NX.success)
                    .frame(width: 44, height: 44)
                    .background(NX.success.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name ?? "bukti").font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                // No download link: the file route wants the session cookie and Safari has none, so
                // anything the app cannot draw itself has to be opened on the web.
                Text(p.isImage ? T("Tap to enlarge") : T("Open it on the web"))
                    .font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.success.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func load() async {
        failed = false
        do { detail = try await APIClient.shared.mySubmissionDetail(submissionId) }
        catch APIError.unauthorized { auth.logout() }
        catch { failed = true }
        loading = false
    }
}
