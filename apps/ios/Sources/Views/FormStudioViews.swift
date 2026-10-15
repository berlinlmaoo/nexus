import SwiftUI
import CoreImage.CIFilterBuiltins

// ─────────────────────────────────────────────────────────────────────────────
// The pieces of the form studio — a port of the dev web's FormStudio
// (apps/web/src/components/forms/FormStudio.tsx, owner 12–13 Oct 2026: "copy Notion's").
// A page-like canvas that looks like the form people fill in (cover, emoji, big title, description,
// then each question as a card with its real input), tabs Questions · Settings · Share · Responses,
// and an autosave state instead of a Save button. FormBuilderView (same folder) owns the state and
// the saving; everything here is drawn from bindings.
// ─────────────────────────────────────────────────────────────────────────────

enum FormStudioTab: String, CaseIterable, Identifiable, Hashable {
    case questions, settings, share, responses
    var id: String { rawValue }
    var label: String {
        switch self {
        case .questions: return T("Questions")
        case .settings: return T("Settings")
        case .share: return T("Share")
        case .responses: return T("Responses")
        }
    }
}

/// The web's SaveState: idle · pending · saving · saved · error.
enum FormSaveState: Equatable {
    case idle, pending, saving, saved
    case failed(String)

    var isFailed: Bool { if case .failed = self { return true }; return false }
}

// MARK: - Top bar pieces

/// The centre tabs of the web's top bar (regular width): text buttons, the current one on a muted pill,
/// Responses with its count.
struct FormStudioTabBar: View {
    @Binding var selection: FormStudioTab
    let responseCount: Int

    var body: some View {
        HStack(spacing: 2) {
            ForEach(FormStudioTab.allCases) { t in
                tabButton(t)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(T("Form builder"))
    }

    private func tabButton(_ t: FormStudioTab) -> some View {
        let on = selection == t
        return Button { selection = t } label: {
            HStack(spacing: 6) {
                Text(t.label).font(NXFont.text(14, on ? .semibold : .regular)).lineLimit(1)
                if t == .responses && responseCount > 0 {
                    Text("\(responseCount)")
                        .font(NXFont.text(11, .semibold)).monospacedDigit()
                        .foregroundStyle(NX.mutedFg)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(NX.background, in: Capsule())
                        .overlay(Capsule().strokeBorder(NX.border))
                }
            }
            .foregroundStyle(on ? NX.foreground : NX.mutedFg)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(on ? NX.muted : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// "✓ Saved", "Saving…", "Unsaved changes", "Couldn't save — Retry".
struct FormSaveIndicator: View {
    let state: FormSaveState
    let hasId: Bool
    var compact = false
    let onRetry: () -> Void

    private var label: String {
        switch state {
        case .saving: return T("Saving…")
        case .pending: return T("Unsaved changes")
        case .failed: return T("Couldn't save")
        case .saved: return T("Saved")
        case .idle: return hasId ? T("Saved") : T("Draft")
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            icon
            if !compact || state.isFailed {
                Text(label).lineLimit(1)
            }
            if state.isFailed {
                Button(T("Retry"), action: onRetry)
                    .font(NXFont.text(13, .semibold))
                    .buttonStyle(.plain)
                    .underline()
            }
        }
        .font(NXFont.text(13))
        .foregroundStyle(state.isFailed ? NX.danger : NX.mutedFg)
        .fixedSize()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
    }

    @ViewBuilder private var icon: some View {
        switch state {
        case .saving: ProgressView().controlSize(.mini)
        case .failed: Image(systemName: "exclamationmark.circle").font(.system(size: 13))
        case .pending: Circle().fill(NX.warning).frame(width: 6, height: 6)
        default: Image(systemName: "checkmark").font(.system(size: 12, weight: .medium))
        }
    }
}

// MARK: - Canvas head

/// The cover band across the top of the canvas — a preset gradient or an image.
struct FormCoverBand: View {
    let cover: String
    var height: CGFloat = 150

    var body: some View {
        if let preset = Self.preset(cover) {
            LinearGradient(colors: preset.map { Color(uiColor: UIColor(rgb: $0)) }, startPoint: .topLeading, endPoint: .bottomTrailing)
                .frame(height: height)
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)
        } else if !cover.isEmpty, let url = URL(string: cover) {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { NX.muted }
            }
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .clipped()
            .accessibilityHidden(true)
        }
    }

    static func preset(_ cover: String) -> [UInt]? {
        guard cover.hasPrefix("preset:") else { return nil }
        let key = String(cover.dropFirst("preset:".count))
        return FormBranding.covers.first(where: { $0.key == key })?.colors
    }
}

/// Add icon / Add cover, the emoji, the big title, "Add a description" and the access banner.
struct FormStudioHead: View {
    @Binding var name: String
    @Binding var description: String
    @Binding var branding: FormBranding
    let isPublic: Bool
    var large = true
    let onChangeAccess: () -> Void

    @State private var iconPicker = false
    @State private var coverPicker = false

    private var hasCover: Bool { !branding.cover.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !branding.icon.isEmpty {
                Button { iconPicker = true } label: {
                    Text(branding.icon).font(.system(size: large ? 60 : 50))
                }
                .buttonStyle(.plain)
                .padding(.top, hasCover ? -34 : (large ? 48 : 28))
                .accessibilityLabel(T("Change icon"))
                .popover(isPresented: $iconPicker) { iconGrid }
            }
            HStack(spacing: 4) {
                if branding.icon.isEmpty {
                    headButton(T("Add icon"), icon: "face.smiling") { iconPicker = true }
                        .popover(isPresented: $iconPicker) { iconGrid }
                }
                headButton(hasCover ? T("Change cover") : T("Add cover"), icon: "photo.badge.plus") { coverPicker = true }
                    .popover(isPresented: $coverPicker) { coverGrid }
            }
            .padding(.top, branding.icon.isEmpty ? (hasCover ? 20 : (large ? 48 : 24)) : 8)
            .padding(.leading, -8)

            TextField(T("Untitled form"), text: titleBinding, axis: .vertical)
                .font(NXFont.display(large ? 34 : 28, .bold))
                .foregroundStyle(NX.foreground)
                .padding(.top, 8)
                .accessibilityLabel(T("Form title"))
            TextField(T("Add a description"), text: $description, axis: .vertical)
                .font(NXFont.text(16))
                .foregroundStyle(NX.mutedFg)
                .padding(.top, 8)
                .accessibilityLabel(T("Form description"))

            Button(action: onChangeAccess) {
                HStack(spacing: 8) {
                    Image(systemName: isPublic ? "link" : "person.2").font(.system(size: 13))
                    // The short sentence (it is "in NEXUS", so signing in goes without saying): the long one
                    // took three lines in the iPad's form column (UI tour run 14, P-I33).
                    // The web's sentence (UI tour run 15, Q-IA32 / Q-M18).
                    Text(isPublic ? T("Anyone in NEXUS with the link can fill this in, after signing in.")
                                  : T("Only members of this project can fill this in."))
                        .font(NXFont.text(13)).multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Text(T("Change")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                }
                .foregroundStyle(NX.mutedFg)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(NX.muted.opacity(0.7), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 20)
        }
    }

    /// One line: a return in the title would end up in the name.
    private var titleBinding: Binding<String> {
        Binding(get: { name }, set: { name = $0.replacingOccurrences(of: "\n", with: " ") })
    }

    private func headButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(NXFont.text(13))
                .foregroundStyle(NX.mutedFg)
                .padding(.horizontal, 8).padding(.vertical, 5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    private var iconGrid: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(T("Icon")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                Spacer()
                if !branding.icon.isEmpty {
                    Button(T("Remove")) { branding.icon = ""; iconPicker = false }
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).buttonStyle(.plain)
                }
            }
            Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                ForEach(0..<5, id: \.self) { row in
                    GridRow {
                        ForEach(0..<8, id: \.self) { col in
                            emojiCell(FormBranding.icons[row * 8 + col])
                        }
                    }
                }
            }
        }
        .padding(14)
        .frame(width: 320)
        .presentationCompactAdaptation(.popover)
    }

    private func emojiCell(_ e: String) -> some View {
        Button { branding.icon = e; iconPicker = false } label: {
            Text(e).font(.system(size: 22))
                .frame(width: 34, height: 34)
                .background(branding.icon == e ? NX.muted : Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var coverGrid: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(T("Cover")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                Spacer()
                if hasCover {
                    Button(T("Remove")) { branding.cover = ""; coverPicker = false }
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).buttonStyle(.plain)
                }
            }
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                ForEach(0..<3, id: \.self) { row in
                    GridRow {
                        ForEach(0..<3, id: \.self) { col in
                            coverCell(FormBranding.covers[row * 3 + col])
                        }
                    }
                }
            }
        }
        .padding(14)
        .frame(width: 320)
        .presentationCompactAdaptation(.popover)
    }

    private func coverCell(_ p: (key: String, label: String, colors: [UInt])) -> some View {
        let value = "preset:\(p.key)"
        let on = branding.cover == value
        return Button { branding.cover = value; coverPicker = false } label: {
            LinearGradient(colors: p.colors.map { Color(uiColor: UIColor(rgb: $0)) }, startPoint: .topLeading, endPoint: .bottomTrailing)
                .frame(height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(on ? NX.foreground : Color.clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(T(p.label))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// MARK: - Question card

/// A small label under a question: where its answer goes, its logic, its routing, autofill.
struct FormStudioChip: View {
    enum Tone { case muted, accent, warn }
    let text: String
    let icon: String
    var tone: Tone = .muted

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold))
            Text(text).font(NXFont.text(12, .medium)).lineLimit(2)
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(bg, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private var fg: Color {
        switch tone {
        case .accent: return NX.accentFg
        case .warn: return Color(light: 0xb45309, dark: 0xfbbf24)
        case .muted: return NX.mutedFg
        }
    }

    private var bg: Color {
        switch tone {
        case .accent: return NX.accentBg
        case .warn: return NX.warning.opacity(0.12)
        case .muted: return NX.muted
        }
    }
}

/// One question as the respondent sees it, with its title editable in place — the web's QuestionCard.
struct FormQuestionCard: View {
    @Binding var field: BuilderField
    let index: Int
    let selected: Bool
    let others: [BuilderField]
    let customFields: [CustomField]
    let sections: [ProjectDetail.Lane]
    /// iPhone: the tools always show, with a gear that opens the question's settings.
    var compact = false
    let onSelect: () -> Void
    let onOpenSettings: () -> Void
    let onDuplicate: () -> Void
    let onDelete: () -> Void

    private var sectionCategory: CustomField? {
        FormCategory.fieldForSectionQuestion(type: field.type, target: field.mappingTarget, options: field.options,
                                             fields: customFields, sections: sections.map(\.name))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                titleBlock
                tools
            }
            .contentShape(Rectangle())
            .onTapGesture { if editsOptionsInline { onSelect() } }
            answerArea.padding(.top, 12)
            chipRow
                .contentShape(Rectangle())
                .onTapGesture { if editsOptionsInline { onSelect() } }
        }
        .padding(.horizontal, compact ? 16 : 24)
        .padding(.top, 14).padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(selected ? NX.accentFg.opacity(0.75) : NX.border, lineWidth: selected ? 1.5 : 1)
        )
        .contentShape(Rectangle())
        // iPhone + a choice question: only the title and the chips open the question's screen; the
        // options in between are typed in place, so a tap there never does both at once.
        .onTapGesture { if !editsOptionsInline { onSelect() } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(String(format: T("Question %d"), index + 1))
    }

    /// iPhone card whose options are edited in place (UI tour run 7).
    private var editsOptionsInline: Bool {
        compact && field.hasOptions && !(field.mappingTarget == "task_list" && sectionCategory == nil)
    }

    /// Regular width: the title and description are typed in place. iPhone: drawn, and a tap on the
    /// card opens the question's screen (a text field in a tappable card would do both at once).
    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                if compact {
                    Text(field.name.trimmingCharacters(in: .whitespaces).isEmpty ? T("Untitled question") : field.name)
                        .font(NXFont.text(16, .semibold))
                        .foregroundStyle(field.name.trimmingCharacters(in: .whitespaces).isEmpty ? NX.mutedFg : NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    TextField(T("Question"), text: nameBinding, axis: .vertical)
                        .font(NXFont.text(16, .semibold))
                        .foregroundStyle(NX.foreground)
                        .accessibilityLabel(String(format: T("Question %d title"), index + 1))
                }
                if field.required {
                    Text("*").font(NXFont.text(16, .semibold)).foregroundStyle(NX.danger)
                        .accessibilityLabel(T("Required"))
                }
            }
            if let d = field.description {
                if compact {
                    if !d.isEmpty { Text(d).font(NXFont.text(14)).foregroundStyle(NX.mutedFg) }
                } else {
                    TextField(T("Description (optional)"), text: descriptionBinding, axis: .vertical)
                        .font(NXFont.text(14))
                        .foregroundStyle(NX.mutedFg)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var tools: some View {
        if compact || selected {
            HStack(spacing: 2) {
                if !compact {
                    Label(field.questionKind.label, systemImage: field.questionKind.icon)
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .labelStyle(.titleAndIcon)
                        .padding(.trailing, 4)
                }
                if compact {
                    toolButton("slider.horizontal.3", T("Question settings"), action: onOpenSettings)
                }
                toolButton("doc.on.doc", T("Duplicate question"), action: onDuplicate)
                // Grey like web's question tools; the delete itself still asks first (UI tour run 7).
                toolButton("trash", T("Delete question"), action: onDelete)
            }
        }
    }

    private func toolButton(_ icon: String, _ label: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 13))
                .foregroundStyle(destructive ? NX.danger.opacity(0.85) : NX.mutedFg)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(label)
    }

    private var nameBinding: Binding<String> {
        Binding(get: { field.name }, set: { v in
            let one = v.replacingOccurrences(of: "\n", with: " ")
            field.name = one
            field.label = one
        })
    }

    private var descriptionBinding: Binding<String> {
        Binding(get: { field.description ?? "" }, set: { field.description = $0 })
    }

    @ViewBuilder private var answerArea: some View {
        if field.hasOptions {
            if field.mappingTarget == "task_list" && sectionCategory == nil {
                let list = sections.map(\.name).joined(separator: ", ")
                Text(String(format: T("Options follow the project's sections: %@"), list.isEmpty ? "—" : list))
                    .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            } else {
                // Typed in place on every device, as on web (UI tour run 7: the iPhone only drew them).
                // On the iPhone the card's own tap stays off this block (see body), so typing an option
                // never also opens the question's screen.
                FormInlineOptions(options: $field.options, multi: field.type == "multi_select")
            }
        } else if field.type == "checkbox" {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 4).strokeBorder(NX.mutedFg.opacity(0.5)).frame(width: 18, height: 18)
                Text(field.name.isEmpty ? T("Checkbox") : field.name).font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
            }
        } else {
            FormCanvasControl(field: field, numberStyle: field.numberStyle(customFields))
        }
        if field.attachmentEnabled && field.type != "file" {
            Label(T("Attach a file (optional)"), systemImage: "paperclip")
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                .padding(.top, 8)
        }
    }

    // MARK: chips

    private struct ChipModel: Identifiable {
        let id: String
        let text: String
        let icon: String
        let tone: FormStudioChip.Tone
    }

    @ViewBuilder private var chipRow: some View {
        let list = chips
        if !list.isEmpty {
            FormChipFlow(spacing: 6) {
                ForEach(list) { c in FormStudioChip(text: c.text, icon: c.icon, tone: c.tone) }
            }
            .padding(.top, 12)
        }
    }

    private var chips: [ChipModel] {
        var out: [ChipModel] = []
        if let mapping = mappingLabel {
            out.append(ChipModel(id: "map", text: mapping, icon: "arrow.right", tone: .accent))
        }
        if let cond = field.showIf, let parent = others.first(where: { $0.id == cond.fieldId }) {
            let q = parent.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? T("Question") : parent.name
            let needs = FormBuilderVocab.needsValue(cond.op)
            if needs && cond.value.trimmingCharacters(in: .whitespaces).isEmpty {
                out.append(ChipModel(id: "logic", text: T("Logic not set yet: pick a value. Until then it always shows."), icon: "arrow.triangle.branch", tone: .warn))
            } else if FormStudioLogic.staleOption(parent, op: cond.op, value: cond.value) {
                out.append(ChipModel(id: "logic", text: String(format: T("“%@” is no longer an option of “%@”, so this question never shows"), cond.value, q),
                                     icon: "exclamationmark.circle", tone: .warn))
            } else {
                let op = T(FormBuilderVocab.operators.first(where: { $0.value == cond.op })?.label ?? cond.op)
                let value = needs ? "“\(cond.value)”" : ""
                let text = String(format: T("Shown when “%@” %@ %@"), q, op, value).trimmingCharacters(in: .whitespaces)
                out.append(ChipModel(id: "logic", text: text, icon: "arrow.triangle.branch", tone: .muted))
            }
        }
        if !field.rules.isEmpty {
            let stale = field.rules.filter { FormStudioLogic.staleOption(field, op: $0.op, value: $0.value) }.count
            let text = stale > 0 ? T("A routing rule reads an option that no longer exists")
                : (field.rules.count == 1 ? T("1 routing rule") : String(format: T("%d routing rules"), field.rules.count))
            out.append(ChipModel(id: "rules", text: text, icon: stale > 0 ? "exclamationmark.circle" : "arrow.triangle.turn.up.right.diamond", tone: stale > 0 ? .warn : .muted))
        }
        if !field.autofill.isEmpty {
            out.append(ChipModel(id: "auto", text: field.autofill == "email" ? T("Auto-filled: email") : T("Auto-filled: name"), icon: "person", tone: .muted))
        }
        return out
    }

    private var mappingLabel: String? {
        let target = field.mappingTarget
        guard !target.isEmpty, target != "none" else { return nil }
        if target == "custom_field" {
            return customFields.first(where: { $0.id == field.mappingCustomFieldId })?.name ?? T("A project field")
        }
        if let cat = sectionCategory { return cat.name }
        return FormBuilderVocab.mappingTargets.first(where: { $0.value == target }).map { T($0.label) } ?? target
    }
}

/// Logic checks shared by the card and the settings panel (form-model.ts).
enum FormStudioLogic {
    /// A condition or rule that reads an option the question no longer has: it can never match.
    static func staleOption(_ f: BuilderField, op: String, value: String) -> Bool {
        guard f.hasOptions, FormBuilderVocab.needsValue(op) else { return false }
        let v = value.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return false }
        let opts = f.options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return !opts.contains(v)
    }

    /// The questions `selfId` may depend on: every other question except those already shown only because
    /// of it, directly or down a chain (picking one would make a loop where neither can ever show).
    static func logicParents(_ fields: [BuilderField], selfId: String) -> [BuilderField] {
        let byId = Dictionary(fields.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func leadsToSelf(_ start: String) -> Bool {
            var seen = Set<String>()
            var cur = byId[start]
            while let c = cur, let parent = c.showIf?.fieldId, !parent.isEmpty, !seen.contains(c.id) {
                if parent == selfId { return true }
                seen.insert(c.id)
                cur = byId[parent]
            }
            return false
        }
        return fields.filter { $0.id != selfId && !leadsToSelf($0.id) }
    }
}

/// Chips that wrap onto the next line.
struct FormChipFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: width.isFinite ? width : widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// The options of a choice question, edited in place: a circle (or a box) per option, × to remove, Add option.
struct FormInlineOptions: View {
    @Binding var options: [String]
    let multi: Bool

    private var rows: [String] { options.isEmpty ? [""] : options }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(rows.indices, id: \.self) { i in
                HStack(spacing: 10) {
                    Group {
                        if multi {
                            RoundedRectangle(cornerRadius: 4).strokeBorder(NX.mutedFg.opacity(0.5))
                        } else {
                            Circle().strokeBorder(NX.mutedFg.opacity(0.5))
                        }
                    }
                    .frame(width: 16, height: 16)
                    TextField(String(format: T("Option %d"), i + 1), text: binding(i))
                        .font(NXFont.text(15))
                        .foregroundStyle(NX.foreground)
                        .frame(minHeight: 32)
                    if rows.count > 1 {
                        Button {
                            if i < options.count { options.remove(at: i) }
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 11, weight: .medium)).foregroundStyle(NX.mutedFg)
                                .frame(width: 26, height: 26).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(T("Delete option"))
                    }
                }
            }
            Button {
                if options.isEmpty { options = ["", ""] } else { options.append("") }
            } label: {
                Label(T("Add option"), systemImage: "plus")
                    .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    .padding(.vertical, 5)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    /// By index, guarded: a row can go while its field still has focus.
    private func binding(_ i: Int) -> Binding<String> {
        Binding(get: { i < options.count ? options[i] : "" }, set: { v in
            if i < options.count { options[i] = v } else if options.isEmpty && i == 0 { options = [v] }
        })
    }
}

/// The options of a choice question, drawn (iPhone card).
struct FormStaticOptions: View {
    let options: [String]
    let multi: Bool

    var body: some View {
        let list = options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array((list.isEmpty ? [T("Option 1")] : list).enumerated()), id: \.offset) { _, o in
                HStack(spacing: 10) {
                    Group {
                        if multi { RoundedRectangle(cornerRadius: 4).strokeBorder(NX.mutedFg.opacity(0.5)) }
                        else { Circle().strokeBorder(NX.mutedFg.opacity(0.5)) }
                    }
                    .frame(width: 16, height: 16)
                    Text(o).font(NXFont.text(15)).foregroundStyle(list.isEmpty ? NX.mutedFg : NX.foreground)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The real input of a question, drawn disabled — the web's `QuestionControl disabled`.
struct FormCanvasControl: View {
    let field: BuilderField
    /// A number question's format: its own Rupiah kind, else the number field its answer goes to.
    var numberStyle: CustomFieldNumber.Style = .plain

    var body: some View {
        switch field.type {
        case "textarea":
            box(T("Your answer"), height: 96)
        case "file":
            // Web FormRenderer: an "Upload" button, then what the field takes (UI tour run 7).
            HStack(spacing: 10) {
                Label(T("Upload"), systemImage: "paperclip")
                    .font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(NX.background, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(NX.border))
                Text(T("One or more files, up to 50 MB each")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .lineLimit(2)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(NX.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .allowsHitTesting(false)
        case "date":
            box(T("Pick a date"), icon: "calendar")
        case "number":
            box(field.numberPlaceholder(numberStyle))
        case "email":
            box(field.autofill.isEmpty ? "name@company.com" : T("Filled from the account"), icon: field.autofill.isEmpty ? nil : "lock")
        case "url":
            box("company.com")
        default:
            box(field.autofill.isEmpty ? T("Your answer") : T("Filled from the account"), icon: field.autofill.isEmpty ? nil : "lock")
        }
    }

    private func box(_ placeholder: String, icon: String? = nil, height: CGFloat = 46) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(placeholder).font(NXFont.text(15)).lineLimit(1)
            Spacer(minLength: 0)
            if let icon { Image(systemName: icon).font(.system(size: 13)) }
        }
        .foregroundStyle(NX.mutedFg.opacity(0.85))
        .padding(.horizontal, 14)
        .padding(.top, height > 50 ? 12 : 0)
        .frame(maxWidth: .infinity, minHeight: height, alignment: height > 50 ? .topLeading : .leading)
        .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// "+ Add question": the type menu, Basic and Specific.
struct FormAddQuestionMenu: View {
    let onPick: (FormQuestionKind) -> Void

    var body: some View {
        Menu {
            Section(T("Basic")) {
                ForEach(FormQuestionKind.allCases.filter(\.isBasic)) { k in item(k) }
            }
            Section(T("Specific")) {
                ForEach(FormQuestionKind.allCases.filter { !$0.isBasic }) { k in item(k) }
            }
        } label: {
            Label(T("Add question"), systemImage: "plus")
                .font(NXFont.text(15, .medium))
                .foregroundStyle(NX.mutedFg)
                .padding(.horizontal, 10).padding(.vertical, 8)
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    private func item(_ k: FormQuestionKind) -> some View {
        Button { onPick(k) } label: {
            Label {
                Text(k.label)
                Text(k.hint)
            } icon: {
                Image(systemName: k.icon)
            }
        }
    }
}

/// The settings panel when no question is selected.
struct FormPanelHint: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("Question settings").uppercased())
                .font(NXFont.text(12, .semibold)).tracking(0.6).foregroundStyle(NX.mutedFg)
            // "Tap" on an iPad, "Click" on a Mac (UI tour run 13, I-12).
            Text(PlatformWording.tapOrClick(
                tap: "Tap a question to change its type, make it required, add logic or choose where its answer goes.",
                click: "Click a question to change its type, make it required, add logic or choose where its answer goes."))
                .font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 8) {
                hint("plus", T("Add question picks the type of a new one"))
                hint("arrow.up.arrow.down", T("Move up and Move down reorder questions"))
                hint("eye", T("Preview shows the form exactly as people see it"))
            }
            .padding(.top, 6)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func hint(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).font(.system(size: 12)).frame(width: 16)
            Text(text).font(NXFont.text(13)).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(NX.mutedFg)
    }
}

// MARK: - Settings tab

/// A settings card: title, a muted hint, the controls.
private struct FormSettingsCard<Content: View>: View {
    let title: String
    var hint: String? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        NXCard {
            Text(title).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
            if let hint {
                Text(hint).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).padding(.top, 2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 12) { content() }
                .padding(.top, 14)
        }
    }
}

/// The web's Settings tab: who can fill it in, when it's open, responses, after sending, notify people.
struct FormStudioSettingsTab: View {
    @Binding var draft: FormStudioDraft
    let projectName: String
    let members: [ProjectDetail.ProjectMember]
    let responseCount: Int
    var regular = true

    @State private var who = ""
    @State private var limitText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            accessCard
            scheduleCard
            responsesCard
            afterCard
            notifyCard
        }
        .frame(maxWidth: 680)
        .padding(.horizontal, regular ? 24 : 16)
        .padding(.vertical, regular ? 32 : 20)
        .frame(maxWidth: .infinity)
    }

    // MARK: who

    private var accessCard: some View {
        FormSettingsCard(title: T("Who can fill it in")) {
            let a = accessOption(true, icon: "link", title: T("Anyone with the link"),
                                 hint: T("Anyone in NEXUS who has the link, even outside this project."))
            let b = accessOption(false, icon: "person.2", title: T("Project members only"),
                                 hint: String(format: T("Only members of %@ can open the link."), projectName.isEmpty ? T("this project") : projectName))
            if regular {
                HStack(alignment: .top, spacing: 8) { a; b }
            } else {
                VStack(spacing: 8) { a; b }
            }
            Toggle(isOn: $draft.requireAuth) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Require NEXUS login to submit")).font(NXFont.text(15))
                    Text(T("Anyone logged in can submit, and their submissions show in My Submissions.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
            }
            .tint(NX.onyx)
            if draft.requireAuth {
                Label(T("People always sign in with their NEXUS account to send, so every request has a name and shows up in their My Submissions."), systemImage: "lock")
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    private func accessOption(_ value: Bool, icon: String, title: String, hint: String) -> some View {
        let on = draft.isPublic == value
        return Button { draft.isPublic = value } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: icon).font(.system(size: 13))
                    Text(title).font(NXFont.text(15, .semibold))
                    Spacer(minLength: 4)
                    if on { Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)) }
                }
                .foregroundStyle(NX.foreground)
                Text(hint).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(on ? NX.muted.opacity(0.6) : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(on ? NX.foreground.opacity(0.6) : NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: when

    private var scheduleCard: some View {
        FormSettingsCard(title: T("When it's open"), hint: String(format: T("Times are in %@."), draft.schedule.timezone)) {
            Picker(T("Form status"), selection: $draft.schedule.override) {
                Text(T("Auto")).tag("")
                Text(T("Force open")).tag("open")
                Text(T("Force closed")).tag("closed")
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 360)
            Text(overrideHint).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 12) {
                instantRow(T("Opens"), empty: T("Right away"), value: $draft.schedule.opensAt)
                instantRow(T("Closes"), empty: T("Never"), value: $draft.schedule.closesAt)
                Divider()
                Toggle(isOn: scheduleEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(T("Only on certain days and hours")).font(NXFont.text(15))
                        if !draft.schedule.override.isEmpty {
                            Text(T("(ignored while the form is forced open or closed)")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        }
                    }
                }
                .tint(NX.onyx)
                if draft.schedule.enabled {
                    dayChips
                    HStack(spacing: 10) {
                        DatePicker(T("From"), selection: timeBinding(\.start), displayedComponents: .hourAndMinute)
                            .labelsHidden()
                        Text("–").foregroundStyle(NX.mutedFg)
                        DatePicker(T("Until"), selection: timeBinding(\.end), displayedComponents: .hourAndMinute)
                            .labelsHidden()
                        Spacer(minLength: 0)
                    }
                }
            }
            .opacity(draft.schedule.override.isEmpty ? 1 : 0.5)
        }
    }

    private var overrideHint: String {
        switch draft.schedule.override {
        case "open": return T("Open: always accepting answers, the schedule is ignored.")
        case "closed": return T("Closed: not accepting answers for now.")
        default: return T("Follows the dates and hours below. With none set, the form is always open.")
        }
    }

    /// Opens / Closes: an ISO instant, or nothing ("Right away" / "Never").
    @ViewBuilder private func instantRow(_ title: String, empty: String, value: Binding<String>) -> some View {
        HStack(spacing: 10) {
            Text(title).font(NXFont.text(15)).foregroundStyle(NX.foreground).frame(minWidth: 64, alignment: .leading)
            if let date = FormInstant.parse(value.wrappedValue) {
                DatePicker(title, selection: Binding(get: { date }, set: { value.wrappedValue = FormInstant.string($0) }),
                           displayedComponents: [.date, .hourAndMinute])
                    .labelsHidden()
                Button { value.wrappedValue = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Clear"))
            } else {
                Button(empty) { value.wrappedValue = FormInstant.string(FormInstant.nextHour()) }
                    .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
            }
            Spacer(minLength: 0)
        }
    }

    private var dayChips: some View {
        HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { i in
                let on = draft.schedule.days.contains(i)
                Button {
                    if on { draft.schedule.days.removeAll { $0 == i } } else { draft.schedule.days = (draft.schedule.days + [i]).sorted() }
                } label: {
                    Text(T(FormBuilderVocab.weekdays[i]))
                        .font(NXFont.text(13, .semibold))
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .padding(.horizontal, 10)
                        .frame(minWidth: 40, minHeight: 30)
                        .foregroundStyle(on ? NX.background : NX.mutedFg)
                        .background(on ? NX.onyx : Color.clear, in: Capsule())
                        .overlay(Capsule().strokeBorder(on ? Color.clear : NX.border))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    /// Turning the schedule on with no days picked starts from Mon–Fri, as the web does.
    private var scheduleEnabled: Binding<Bool> {
        Binding(get: { draft.schedule.enabled }, set: { on in
            draft.schedule.enabled = on
            if on && draft.schedule.days.isEmpty { draft.schedule.days = [1, 2, 3, 4, 5] }
        })
    }

    /// "HH:mm" in the schedule's own zone, shown on a time wheel. Only the hour and minute are read back.
    private func timeBinding(_ key: WritableKeyPath<BuilderSchedule, String>) -> Binding<Date> {
        Binding(get: { FormInstant.date(fromHHmm: draft.schedule[keyPath: key]) },
                set: { draft.schedule[keyPath: key] = FormInstant.hhmm($0) })
    }

    // MARK: responses

    private var responsesCard: some View {
        FormSettingsCard(title: T("Responses")) {
            Toggle(isOn: limitOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Limit the number of responses")).font(NXFont.text(15))
                    Text(String(format: T("%d so far"), responseCount)).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
            }
            .tint(NX.onyx)
            if draft.settings.responseLimit > 0 {
                HStack(spacing: 10) {
                    TextField(T("Maximum responses"), text: limitBinding)
                        .keyboardType(.numberPad)
                        .font(NXFont.text(15)).monospacedDigit()
                        .padding(.horizontal, 10).frame(width: 110, height: 36)
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                    Text(T("then the form closes by itself")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
            }
        }
    }

    private var limitOn: Binding<Bool> {
        Binding(get: { draft.settings.responseLimit > 0 }, set: { on in
            draft.settings.responseLimit = on ? max(responseCount + 10, 50) : 0
            limitText = on ? String(draft.settings.responseLimit) : ""
        })
    }

    /// Clearing the box to type a new number keeps the limit on: only a whole number above 0 is saved.
    private var limitBinding: Binding<String> {
        Binding(get: { limitText.isEmpty ? String(draft.settings.responseLimit) : limitText }, set: { v in
            limitText = v
            if let n = Int(v.trimmingCharacters(in: .whitespaces)), n > 0 { draft.settings.responseLimit = n }
        })
    }

    // MARK: after sending

    private var afterCard: some View {
        FormSettingsCard(title: T("After sending"), hint: T("What people see once they send. Leave empty for the default.")) {
            labeled(T("Button text")) {
                TextField(T("Send"), text: limited($draft.settings.submitLabel, 40))
            }
            labeled(T("Confirmation title")) {
                TextField(T("Sent. Thank you!"), text: limited($draft.settings.confirmationTitle, 120))
            }
            labeled(T("Confirmation message")) {
                TextField(T("e.g. Finance replies within 2 working days. Follow it in My Submissions."),
                          text: limited($draft.settings.confirmationMessage, 1000), axis: .vertical)
                    .lineLimit(3...8)
            }
        }
    }

    private func labeled<C: View>(_ title: String, @ViewBuilder _ field: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg)
            field()
                .font(NXFont.text(15))
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
        }
    }

    private func limited(_ b: Binding<String>, _ max: Int) -> Binding<String> {
        Binding(get: { b.wrappedValue }, set: { b.wrappedValue = String($0.prefix(max)) })
    }

    // MARK: notify

    private var shownMembers: [ProjectDetail.ProjectMember] {
        let q = who.trimmingCharacters(in: .whitespaces).lowercased()
        let sorted = members.sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
        return q.isEmpty ? sorted : sorted.filter { $0.displayName.lowercased().contains(q) }
    }

    private var notifyCard: some View {
        FormSettingsCard(title: T("Notify people"), hint: T("They get an in-app notification and a push for every new response.")) {
            if !draft.settings.notifyUserIds.isEmpty {
                FormChipFlow(spacing: 6) {
                    ForEach(draft.settings.notifyUserIds, id: \.self) { id in notifyChip(id) }
                }
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                TextField(T("Search project members"), text: $who).font(NXFont.text(15))
            }
            .padding(.horizontal, 12).frame(height: 38)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
            VStack(spacing: 0) {
                let list = shownMembers
                if list.isEmpty {
                    Text(T("No members match.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).padding(12)
                }
                ForEach(list.prefix(who.isEmpty ? 12 : 50)) { m in memberRow(m) }
                if who.isEmpty && list.count > 12 {
                    Text(String(format: T("%d more — search to find them"), list.count - 12))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).padding(10)
                }
            }
            .padding(4)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
        }
    }

    private func notifyChip(_ id: String) -> some View {
        let m = members.first(where: { $0.uid == id })
        return HStack(spacing: 6) {
            AvatarView(url: m?.user?.avatar, initial: m?.initial ?? "?", size: 20)
            Text(m?.displayName ?? T("Former member")).font(NXFont.text(13, .semibold)).lineLimit(1)
            Button { draft.settings.notifyUserIds.removeAll { $0 == id } } label: {
                Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(format: T("Remove %@"), m?.displayName ?? ""))
        }
        .padding(.leading, 3).padding(.trailing, 8).padding(.vertical, 3)
        .background(NX.muted.opacity(0.6), in: Capsule())
        .overlay(Capsule().strokeBorder(NX.border))
    }

    private func memberRow(_ m: ProjectDetail.ProjectMember) -> some View {
        let on = draft.settings.notifyUserIds.contains(m.uid)
        return Button {
            if on { draft.settings.notifyUserIds.removeAll { $0 == m.uid } } else { draft.settings.notifyUserIds.append(m.uid) }
        } label: {
            HStack(spacing: 10) {
                AvatarView(url: m.user?.avatar, initial: m.initial, size: 24)
                Text(m.displayName).font(NXFont.text(15)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16)).foregroundStyle(on ? NX.onyx : NX.mutedFg)
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// ISO instants (opensAt / closesAt) and "HH:mm" times.
enum FormInstant {
    private static func formatter(fractional: Bool) -> ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = fractional ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return f
    }

    static func parse(_ s: String) -> Date? {
        guard !s.isEmpty else { return nil }
        return formatter(fractional: true).date(from: s) ?? formatter(fractional: false).date(from: s)
    }

    static func string(_ d: Date) -> String { formatter(fractional: true).string(from: d) }

    static func nextHour() -> Date {
        let now = Date()
        let start = Calendar.current.dateInterval(of: .hour, for: now)?.start ?? now
        return start.addingTimeInterval(3600)
    }

    static func date(fromHHmm s: String) -> Date {
        let parts = s.split(separator: ":").compactMap { Int($0) }
        let h = parts.first ?? 0, m = parts.count > 1 ? parts[1] : 0
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: Date()) ?? Date()
    }

    static func hhmm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

// MARK: - Share tab

/// The web's Share tab: the link (copy, open, share) and its QR code.
struct FormStudioShareTab: View {
    let url: URL?
    let isPublic: Bool
    var regular = true
    let onOpen: () -> Void
    let onGoSettings: () -> Void

    @State private var copied = false

    var body: some View {
        Group {
            if let url {
                VStack(alignment: .leading, spacing: 16) {
                    linkCard(url)
                    qrCard(url)
                }
                .frame(maxWidth: 680)
                .padding(.horizontal, regular ? 24 : 16)
                .padding(.vertical, regular ? 32 : 20)
                .frame(maxWidth: .infinity)
            } else {
                EmptyState(icon: "link", title: T("No link yet"),
                           subtitle: T("Give the form a title or edit a question first. The link appears once it's saved."))
                    .padding(.horizontal, 24).padding(.top, 64)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func linkCard(_ url: URL) -> some View {
        FormSettingsCard(title: T("Form link")) {
            Text(url.absoluteString)
                .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                .textSelection(.enabled)
                .lineLimit(2)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
            HStack(spacing: 8) {
                Button {
                    UIPasteboard.general.string = url.absoluteString
                    copied = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        copied = false
                    }
                } label: {
                    Label(copied ? T("Copied") : T("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.nxPrimary)
                Button(action: onOpen) { Label(T("Open"), systemImage: "arrow.up.right.square") }
                    .buttonStyle(.nxBordered)
                ShareLink(item: url) { Label(T("Share"), systemImage: "square.and.arrow.up") }
                    .buttonStyle(.nxBordered)
            }
            HStack(spacing: 6) {
                Image(systemName: isPublic ? "link" : "person.2").font(.system(size: 12))
                Text(isPublic ? T("Anyone in NEXUS with the link can fill it in.") : T("Only project members can open this link."))
                Button(T("Change"), action: onGoSettings)
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).buttonStyle(.plain)
            }
            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
        }
    }

    private func qrCard(_ url: URL) -> some View {
        FormSettingsCard(title: T("QR code"), hint: T("Print it or put it on a screen; scanning opens the form.")) {
            if let qr = FormQR.image(for: url.absoluteString) {
                VStack(spacing: 12) {
                    // Always black on white: phones' cameras read that best, in dark mode too.
                    Image(uiImage: qr)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 200, height: 200)
                        .padding(12)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .accessibilityLabel(T("QR code for the form link"))
                    ShareLink(item: Image(uiImage: qr), preview: SharePreview(T("QR code"), image: Image(uiImage: qr))) {
                        Label(T("Save or share the QR code"), systemImage: "square.and.arrow.down")
                    }
                    .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

/// A QR code as a crisp image with a quiet zone (CoreImage's generator).
enum FormQR {
    static func image(for text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
