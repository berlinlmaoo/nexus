import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Review & edit (owner, 14 Oct 2026; web LegalDocumentEditor + LegalGideonPanel + LegalDiffView). Tap a
// paragraph to change its text; every save is a new version with your name on it. The number's paragraph
// and paragraphs with a field, image or link are locked. Tick paragraphs and GIDEON proposes before → after
// for those only; nothing changes until it is approved. Compare shows two Word versions as one flow.
// ─────────────────────────────────────────────────────────────────────────────

/// The editor's state, held by the document screen so its bottom bar and GIDEON's ticks share it.
@MainActor
@Observable
final class LegalEditorModel {
    private(set) var paragraphs: [LegalParagraph] = []
    private(set) var loadedKey: String?
    var loading = false
    var error: String?
    /// Typed text by paragraph index.
    var edits: [Int: String] = [:]
    var editing: Int?
    var note = ""
    /// Paragraphs ticked for GIDEON.
    var selected: Set<Int> = []

    /// The edits that differ from the paragraph as saved.
    var pending: [Int: String] {
        edits.filter { i, text in paragraphs.first { $0.index == i }?.text != text }
    }

    func load(documentId: String, version: Int) async {
        let key = "\(documentId)-\(version)"
        guard loadedKey != key else { return }
        loading = true
        defer { loading = false }
        do {
            let r = try await APIClient.shared.legalParagraphs(id: documentId)
            paragraphs = r.paragraphs
            loadedKey = key
            error = nil
            reset()
        } catch {
            self.error = error.legalMessage
        }
    }

    func reset() {
        edits = [:]
        editing = nil
        note = ""
    }

    func toggle(_ i: Int) {
        if selected.contains(i) { selected.remove(i) } else { selected.insert(i) }
    }
}

struct LegalParagraphEditor: View {
    let doc: LegalDocument
    @Bindable var editor: LegalEditorModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(PlatformWording.tapOrClick(tap: "Tap a paragraph to edit it, or tick paragraphs to ask GIDEON to change them.",
                                            click: "Click a paragraph to edit it, or tick paragraphs to ask GIDEON to change them."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            if editor.loading && editor.paragraphs.isEmpty {
                LegalLoadingRow()
            } else if let error = editor.error, editor.paragraphs.isEmpty {
                Text(error).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(editor.paragraphs) { p in
                        if p.isBlank {
                            EmptyView()
                        } else {
                            LegalParagraphRow(paragraph: p, editor: editor)
                        }
                    }
                }
                .padding(8)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            }
        }
        .task(id: "\(doc.id)-\(doc.currentVersion)") { await editor.load(documentId: doc.id, version: doc.currentVersion) }
    }
}

private struct LegalParagraphRow: View {
    let paragraph: LegalParagraph
    @Bindable var editor: LegalEditorModel
    @FocusState private var focused: Bool

    private var p: LegalParagraph { paragraph }
    private var text: String { editor.edits[p.index] ?? p.text }
    private var changed: Bool { editor.edits[p.index].map { $0 != p.text } ?? false }
    private var isHeading: Bool { (p.style ?? "").range(of: "^(Heading|Judul|Title)", options: [.regularExpression, .caseInsensitive]) != nil }
    private var ticked: Bool { editor.selected.contains(p.index) }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Button { editor.toggle(p.index) } label: {
                Image(systemName: ticked ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16)).foregroundStyle(ticked ? NX.violetText : NX.mutedFg)
                    .opacity(p.editable ? 1 : 0.3)
                    .touchTarget44(drawn: 16)
            }
            .buttonStyle(.plain)
            .disabled(!p.editable)
            .accessibilityLabel(String(format: T("Select paragraph %d"), p.index + 1))
            .accessibilityAddTraits(ticked ? .isSelected : [])
            .padding(.top, 2)

            Group {
                if editor.editing == p.index {
                    editingBody
                } else if p.editable {
                    Button { editor.editing = p.index } label: { readBody }
                        .buttonStyle(.plain)
                } else {
                    lockedBody
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 6).padding(.vertical, 5)
        .background(changed ? NX.warning.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            if ticked { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.violet.opacity(0.45)) }
        }
    }

    private var font: Font { NXFont.text(p.inTable ? 13 : 14, isHeading ? .semibold : .regular) }

    @ViewBuilder private var readBody: some View {
        Group {
            if changed {
                Text(LegalDiffText.attributed(LegalText.diffWords(p.text, text)))
            } else {
                Text(text.isEmpty ? " " : text)
            }
        }
        .font(font).foregroundStyle(NX.foreground).lineSpacing(3)
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .contentShape(Rectangle())
    }

    private var editingBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: Binding(get: { text }, set: { editor.edits[p.index] = $0 }))
                .font(font)
                .focused($focused)
                .scrollContentBackground(.hidden)
                .frame(minHeight: max(60, min(220, CGFloat(text.count / 45 + 2) * 20)))
                .padding(.horizontal, 4)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.violet.opacity(0.5)))
            HStack(spacing: 6) {
                Button(T("Undo")) {
                    editor.edits[p.index] = nil
                    editor.editing = nil
                }
                .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
                Spacer(minLength: 0)
                Button(T("Done")) { editor.editing = nil }
                    .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
            }
        }
        .onAppear { focused = true }
    }

    private var lockReason: String {
        p.lockReason == "number"
            ? T("The document number can't be edited.")
            : T("Has a field, image or link: edit it in Word and upload the file as a new version.")
    }

    private var lockedBody: some View {
        Button { LegalToasts.shared.warning(lockReason) } label: {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "lock.fill").font(.system(size: 10)).foregroundStyle(NX.mutedFg).padding(.top, 4)
                Text(p.text.isEmpty ? "—" : p.text).font(font).foregroundStyle(NX.mutedFg).lineSpacing(3)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(lockReason)
    }
}

/// "N paragraphs changed", what changed, Discard, Save as new version.
struct LegalSaveEditsBar: View {
    @Bindable var editor: LegalEditorModel
    let onSave: () async -> Void
    @State private var saving = false

    var body: some View {
        VStack(spacing: 0) {
            Divider().overlay(NX.border)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { count; noteField; buttons }
                VStack(alignment: .leading, spacing: 8) {
                    HStack { count; Spacer(minLength: 0) }
                    noteField
                    HStack { Spacer(minLength: 0); buttons }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .background(.regularMaterial)
    }

    private var count: some View {
        Text(String(format: T("%d paragraphs changed"), editor.pending.count))
            .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
    }

    private var noteField: some View {
        TextField(T("What changed (optional)"), text: $editor.note).font(NXFont.text(14)).legalInput().frame(minWidth: 180)
    }

    private var buttons: some View {
        HStack(spacing: 8) {
            Button { editor.reset() } label: { Label(T("Discard"), systemImage: "arrow.uturn.backward") }
                .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
            Button {
                Task { saving = true; await onSave(); saving = false }
            } label: {
                HStack(spacing: 5) {
                    if saving { ProgressView().tint(NX.background) } else { Image(systemName: "square.and.arrow.down") }
                    Text(T("Save as new version"))
                }
            }
            .buttonStyle(NXButtonStyle(kind: .primary, compact: true))
            .disabled(saving)
        }
    }
}

// MARK: - GIDEON precise edit

struct LegalGideonPanel: View {
    let model: LegalDocumentModel
    let doc: LegalDocument
    @Bindable var editor: LegalEditorModel

    @State private var instruction = ""
    @State private var proposals: [LegalProposal] = []
    @State private var asking = false

    /// The newest proposal, while it still applies to the current version.
    private var shown: LegalProposal? {
        guard let p = proposals.first, ["PENDING", "APPLYING", "CLARIFY", "FAILED"].contains(p.status),
              p.baseVersion == doc.currentVersion else { return nil }
        return p
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(T("Ask GIDEON to change it"), systemImage: "sparkles").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(editor.selected.isEmpty
                     ? T("Tick the paragraphs to change, or describe the clause and GIDEON picks the fewest paragraphs.")
                     : String(format: T("GIDEON may change only the %d paragraphs you ticked."), editor.selected.count))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                if !editor.selected.isEmpty {
                    Button(T("Clear")) { editor.selected = [] }.font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                }
            }
            TextField(T("e.g. Change the term to 6 months and the fee to Rp 2.000.000"), text: $instruction, axis: .vertical)
                .lineLimit(2...5)
                .font(NXFont.text(14))
                .padding(.vertical, 8)
                .legalInput()
            Button { Task { await ask(replyTo: nil, answer: nil) } } label: {
                HStack(spacing: 6) {
                    if asking { ProgressView().tint(NX.background) } else { Image(systemName: "sparkles") }
                    Text(asking ? T("GIDEON is reading…") : T("Propose a change"))
                }
            }
            .buttonStyle(NXButtonStyle(kind: .primary, compact: true))
            .disabled(instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || asking)
            if let shown {
                LegalProposalCard(doc: doc, proposal: shown, answering: asking,
                                  onAnswer: { a in Task { await ask(replyTo: shown.id, answer: a) } },
                                  onDone: { Task { await refresh() } })
                    .id(shown.id + shown.status)
            }
        }
        .padding(14)
        .background(NX.muted.opacity(0.45), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .task(id: "\(doc.id)-\(doc.currentVersion)") { await loadProposals() }
        // APPLYING is transient: look again until it settles (and the new version arrives).
        .task(id: shown?.status == "APPLYING" ? shown?.id : nil) {
            guard shown?.status == "APPLYING" else { return }
            while shown?.status == "APPLYING" {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard !Task.isCancelled else { return }
                await loadProposals()
            }
            await model.load()
        }
    }

    private func loadProposals() async {
        if let list = try? await APIClient.shared.legalProposals(id: doc.id) { proposals = list }
    }

    private func refresh() async {
        await loadProposals()
        await model.load()
    }

    private func ask(replyTo: String?, answer: String?) async {
        asking = true
        defer { asking = false }
        do {
            let p = try await APIClient.shared.legalAskGideon(
                id: doc.id, baseVersion: doc.currentVersion,
                instruction: replyTo == nil ? instruction.trimmingCharacters(in: .whitespacesAndNewlines) : "",
                targets: replyTo == nil ? editor.selected.sorted() : [],
                replyTo: replyTo, answer: answer)
            proposals = [p] + proposals.filter { $0.id != p.id }
            if p.status == "PENDING" { instruction = "" }
        } catch {
            LegalToasts.shared.failure(error)
        }
    }
}

private struct LegalProposalCard: View {
    let doc: LegalDocument
    let proposal: LegalProposal
    let answering: Bool
    let onAnswer: (String) -> Void
    let onDone: () -> Void

    @State private var chosen: Set<Int> = []
    @State private var answer = ""
    @State private var deciding = false

    var body: some View {
        switch proposal.status {
        case "CLARIFY": clarify
        case "APPLYING":
            HStack(spacing: 8) {
                ProgressView()
                Text(T("Applying the change…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        case "FAILED":
            Text(String(format: T("GIDEON's proposal was refused: %@"), proposal.summary.isEmpty ? "—" : proposal.summary))
                .font(NXFont.text(13)).foregroundStyle(NX.danger)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(NX.danger.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.danger.opacity(0.35)))
        default: pending
        }
    }

    private var clarify: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "questionmark.bubble").foregroundStyle(NX.violetText)
                Text(proposal.question ?? "").font(NXFont.text(14)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                TextField(T("Your answer"), text: $answer).font(NXFont.text(14)).legalInput()
                    .onSubmit { send() }
                Button { send() } label: {
                    if answering { ProgressView() } else { Text(T("Reply")) }
                }
                .buttonStyle(NXButtonStyle(kind: .primary, compact: true))
                .disabled(answer.trimmingCharacters(in: .whitespaces).isEmpty || answering)
            }
        }
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.violet.opacity(0.35)))
    }

    private func send() {
        let a = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !a.isEmpty, !answering else { return }
        onAnswer(a)
    }

    private var pending: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(proposal.summary.isEmpty ? proposal.instruction : proposal.summary)
                .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
            ForEach(proposal.changes) { c in
                HStack(alignment: .top, spacing: 8) {
                    Button {
                        if chosen.contains(c.index) { chosen.remove(c.index) } else { chosen.insert(c.index) }
                    } label: {
                        Image(systemName: chosen.contains(c.index) ? "checkmark.square.fill" : "square")
                            .font(.system(size: 16)).foregroundStyle(chosen.contains(c.index) ? NX.violetText : NX.mutedFg)
                            .touchTarget44(drawn: 16)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(String(format: T("Apply the change to paragraph %d"), c.index + 1))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(String(format: T("Paragraph %d"), c.index + 1)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        LegalSegmentsView(segments: c.segments.isEmpty ? LegalText.diffWords(c.before, c.after) : c.segments)
                    }
                }
            }
            HStack(spacing: 8) {
                Button { Task { await decide(true) } } label: {
                    HStack(spacing: 5) {
                        if deciding { ProgressView().tint(NX.background) } else { Image(systemName: "checkmark") }
                        Text(chosen.count == proposal.changes.count ? T("Approve")
                             : String(format: T("Approve %d of %d"), chosen.count, proposal.changes.count))
                    }
                }
                .buttonStyle(NXButtonStyle(kind: .primary, compact: true))
                .disabled(chosen.isEmpty || deciding)
                Button { Task { await decide(false) } } label: { Label(T("Discard"), systemImage: "xmark") }
                    .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
                    .disabled(deciding)
            }
        }
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.warning.opacity(0.5)))
        .onAppear { chosen = Set(proposal.changes.map(\.index)) }
    }

    private func decide(_ approve: Bool) async {
        deciding = true
        defer { deciding = false }
        do {
            let res = try await APIClient.shared.legalDecide(id: doc.id, proposalId: proposal.id, approve: approve,
                                                            indexes: approve ? chosen.sorted() : nil)
            if approve { LegalToasts.shared.success(String(format: T("Applied as version %d"), res.version ?? 0)) }
            LegalToasts.shared.pdfWarning(res.pdfError)
        } catch {
            LegalToasts.shared.failure(error)
        }
        onDone()
    }
}

// MARK: - Compare

struct LegalCompareView: View {
    let doc: LegalDocument
    @State private var a: Int?
    @State private var b: Int?
    @State private var diff: [LegalParagraphDiff]?
    @State private var error: String?

    var body: some View {
        let word = doc.wordVersions
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                picker(word, $a)
                Image(systemName: "arrow.right").font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                picker(word, $b)
                Spacer(minLength: 0)
            }
            if a == b {
                Text(T("Pick two different versions.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            } else if let error {
                Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
            } else if let diff {
                LegalDiffView(diff: diff)
            } else {
                LegalLoadingRow()
            }
        }
        .onAppear {
            if a == nil { a = word.count >= 2 ? word[word.count - 2] : word.first }
            if b == nil { b = word.last }
        }
        .task(id: "\(a ?? 0)-\(b ?? 0)") {
            guard let a, let b, a != b else { return }
            diff = nil
            error = nil
            do { diff = try await APIClient.shared.legalCompare(id: doc.id, a: a, b: b).diff }
            catch { if !Task.isCancelled { self.error = error.legalMessage } }
        }
    }

    private func picker(_ versions: [Int], _ value: Binding<Int?>) -> some View {
        Menu {
            ForEach(versions, id: \.self) { v in
                Button { value.wrappedValue = v } label: {
                    if value.wrappedValue == v { Label("v\(v)", systemImage: "checkmark") } else { Text(verbatim: "v\(v)") }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(verbatim: value.wrappedValue.map { "v\($0)" } ?? "—").font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
            .legalInput()
        }
        .menuIndicator(.hidden)
    }
}

/// Two versions as one flow: unchanged paragraphs folded, changes in full.
struct LegalDiffView: View {
    let diff: [LegalParagraphDiff]

    private enum Row: Identifiable {
        case folded(Int, key: Int)
        case change(LegalParagraphDiff, key: Int)
        var id: Int {
            switch self {
            case .folded(_, let k), .change(_, let k): return k
            }
        }
    }

    private var rows: [Row] {
        var out: [Row] = []
        var folded = 0
        for (k, d) in diff.enumerated() {
            if d.isSame { folded += 1; continue }
            if folded > 0 { out.append(.folded(folded, key: -k - 1)); folded = 0 }
            out.append(.change(d, key: k))
        }
        if folded > 0 { out.append(.folded(folded, key: -diff.count - 1)) }
        return out
    }

    var body: some View {
        let changes = diff.filter { !$0.isSame }.count
        if changes == 0 {
            Text(T("These versions have the same text.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(String(format: T("%d paragraphs changed"), changes)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                ForEach(rows) { row in
                    switch row {
                    case .folded(let n, _):
                        Text(String(format: T("%d unchanged paragraphs"), n))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity).padding(.vertical, 2)
                    case .change(let d, _):
                        box(d)
                    }
                }
            }
        }
    }

    @ViewBuilder private func box(_ d: LegalParagraphDiff) -> some View {
        switch d {
        case .changed(_, _, _, _, let segments):
            LegalSegmentsView(segments: segments)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.warning.opacity(0.5)))
        case .added(_, let text):
            labelled(T("Added"), text, tone: .success, struck: false)
        case .removed(_, let text):
            labelled(T("Removed"), text, tone: .danger, struck: true)
        case .same(_, _, let text):
            Text(text).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
        }
    }

    private func labelled(_ label: String, _ text: String, tone: ChipTone, struck: Bool) -> some View {
        (Text(label + "  ").font(NXFont.text(12, .semibold)).foregroundStyle(tone.fg)
         + Text(text).font(NXFont.text(14)).strikethrough(struck).foregroundStyle(NX.foreground))
            .lineSpacing(3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(tone.bg.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(tone.fg.opacity(0.35)))
    }
}
