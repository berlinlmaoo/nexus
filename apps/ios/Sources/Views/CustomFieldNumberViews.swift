import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Number formats, Notion style (owner, 15 Oct 2026): how a NUMBER field's value is drawn (number,
// bar or ring) and the settings that choose it (Number format, Decimal places, Show as). The rules
// themselves live in CustomFieldNumber.swift; this file only draws them.
// ─────────────────────────────────────────────────────────────────────────────

extension CustomFieldNumber {
    /// The bar / ring colour; "default" is green, like Notion's.
    static func tint(_ key: String) -> Color {
        StatusColor.swatch(key == "default" ? "green" : key).dot
    }
}

/// A NUMBER value as its field shows it: the formatted number, or the number with a bar or a ring
/// (Notion's Show as). With Show number off only the bar or ring is drawn.
struct CFNumberValue: View {
    let text: String
    let style: CustomFieldNumber.Style
    /// 0…1, CustomFieldNumber.fill.
    let fill: Double
    var font: Font = NXFont.text(13)
    var color: Color = NX.foreground
    /// The bar's length: a fixed one on cards, nil = the room the cell leaves (table, task detail).
    var barWidth: CGFloat? = 56

    var body: some View {
        Group {
            switch style.showAs {
            case .number:
                label
            case .bar:
                HStack(spacing: 8) {
                    if style.showNumber { label.layoutPriority(1) }
                    ProgressView(value: fill)
                        .progressViewStyle(.linear)
                        .tint(CustomFieldNumber.tint(style.barColor))
                        .frame(width: barWidth)
                        .frame(maxWidth: barWidth == nil ? .infinity : nil)
                }
            case .ring:
                HStack(spacing: 6) {
                    if style.showNumber { label.layoutPriority(1) }
                    CFNumberRing(fill: fill, tint: CustomFieldNumber.tint(style.barColor))
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityValue(style.showAs == .number ? "" : "\(Int((fill * 100).rounded()))%")
    }

    private var label: some View {
        Text(text).font(font).foregroundStyle(color).monospacedDigit().lineLimit(1)
    }
}

/// Notion's ring: a grey track and the filled arc from 12 o'clock, clockwise.
struct CFNumberRing: View {
    let fill: Double
    let tint: Color
    var size: CGFloat = 14
    var body: some View {
        ZStack {
            Circle().stroke(NX.muted, lineWidth: 2.5)
            Circle().trim(from: 0, to: fill)
                .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Settings

/// The Number property settings, top to bottom as in Notion's Edit property panel: Number format,
/// Decimal places, Show as (Number / Bar / Ring with Color, Divide by and Show number), and the
/// footnote. Used when a field is created and when an existing one is edited.
struct NumberFormatSettings: View {
    @Binding var style: CustomFieldNumber.Style
    @State private var divideText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(spacing: 0) {
                NavigationLink {
                    NumberFormatPicker(selection: $style.numberFormat)
                } label: {
                    row(T("Number format")) {
                        Text(CustomFieldNumber.info(style.numberFormat).shortName).foregroundStyle(NX.mutedFg)
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    }
                }
                .buttonStyle(.plain)
                Divider()
                row(T("Decimal places")) {
                    Picker(T("Decimal places"), selection: $style.decimals) {
                        Text(T("Default")).tag(Int?.none)
                        ForEach(0...5, id: \.self) { n in Text(String(n)).tag(Int?.some(n)) }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .tint(NX.mutedFg)
                }
            }
            .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(T("Show as"))
                HStack(spacing: 8) {
                    ForEach(CustomFieldNumber.ShowAs.allCases, id: \.self) { kind in tile(kind) }
                }
                if style.showAs != .number { barOptions }
            }

            Text(T("Changes apply to all views showing this property."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
        }
        .onAppear { divideText = Self.text(style.divideBy) }
    }

    private func row<C: View>(_ title: String, @ViewBuilder _ trailing: () -> C) -> some View {
        HStack(spacing: 8) {
            Text(title).font(NXFont.text(14)).foregroundStyle(NX.foreground)
            Spacer(minLength: 8)
            trailing().font(NXFont.text(14))
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    /// The three preview tiles: "42 / Number", a bar, a ring.
    private func tile(_ kind: CustomFieldNumber.ShowAs) -> some View {
        let on = style.showAs == kind
        let tint = on ? NX.violetText : NX.mutedFg
        return Button { style.showAs = kind } label: {
            VStack(spacing: 6) {
                Group {
                    switch kind {
                    case .number: Text("42").font(NXFont.text(16, .semibold))
                    case .bar: ProgressView(value: 0.45).progressViewStyle(.linear).tint(tint).frame(width: 44)
                    case .ring: CFNumberRing(fill: 0.7, tint: tint, size: 16)
                    }
                }
                .frame(height: 20)
                Text(title(kind)).font(NXFont.text(12, .medium))
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(on ? NX.violet.opacity(0.08) : NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(on ? NX.violet : NX.border, lineWidth: on ? 1.5 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func title(_ kind: CustomFieldNumber.ShowAs) -> String {
        switch kind {
        case .number: return T("Number")
        case .bar: return T("Bar")
        case .ring: return T("Ring")
        }
    }

    /// Color, Divide by (not for Percent: the stored fraction is the fill) and Show number.
    private var barOptions: some View {
        VStack(spacing: 0) {
            row(T("Colour")) {
                Picker(T("Colour"), selection: $style.barColor) {
                    ForEach(CustomFieldNumber.barColors, id: \.self) { key in
                        Text(key == "default" ? T("Default") : StatusColor.label(key)).tag(key)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .tint(CustomFieldNumber.tint(style.barColor))
            }
            if !style.isPercent {
                Divider()
                row(T("Divide by")) {
                    TextField("100", text: $divideText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 120)
                        .onChange(of: divideText) { _, typed in
                            if let d = Double(CustomFieldNumber.normalize(typed, idr: false)), d.isFinite, d > 0 { style.divideBy = d }
                        }
                }
            }
            Divider()
            Toggle(isOn: $style.showNumber) {
                Text(T("Show number")).font(NXFont.text(14)).foregroundStyle(NX.foreground)
            }
            .tint(NX.violetText)
            .padding(.horizontal, 12).frame(minHeight: 44)
        }
        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// 100 → "100", 2.5 → "2,5" (the app's id-ID numbers).
    private static func text(_ d: Double) -> String {
        CustomFieldNumber.format(Decimal(d), style: .plain)
    }
}

/// Notion's format list, with "Filter formats…" on top (fuzzy: "rup" finds Rupee, Rupiah, Pakistani
/// rupee, Uruguayan peso). Picking one goes back.
struct NumberFormatPicker: View {
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let list = CustomFieldNumber.filterFormats(query)
        List {
            ForEach(list, id: \.code) { f in
                Button {
                    selection = f.code
                    dismiss()
                } label: {
                    HStack {
                        Text(f.name).foregroundStyle(NX.foreground)
                        Spacer(minLength: 8)
                        if f.code == selection {
                            Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.violetText)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(f.code == selection ? .isSelected : [])
            }
        }
        .overlay {
            if list.isEmpty {
                EmptyState(icon: "magnifyingglass", title: T("No formats match"),
                           subtitle: T("Try a currency name or its code, like IDR."))
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: T("Filter formats…"))
        .navigationTitle(T("Number format"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Edit an existing NUMBER field's format (project settings → a number field). Saves the options with
/// the contract keys; the legacy "currency-idr" goes with Rupiah only.
struct NumberFieldFormatEditor: View {
    let field: CustomField
    var onSaved: () async -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var style: CustomFieldNumber.Style
    @State private var busy = false
    @State private var failed = false

    init(field: CustomField, onSaved: @escaping () async -> Void = {}) {
        self.field = field
        self.onSaved = onSaved
        _style = State(initialValue: field.options?.numberStyle ?? .plain)
    }

    private var original: CustomFieldNumber.Style { field.options?.numberStyle ?? .plain }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                NumberFormatSettings(style: $style)
                sample
                if failed {
                    Text(T("Couldn't save the format. Check your connection and try again."))
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }
                Button { Task { await save() } } label: {
                    Text(busy ? T("Saving…") : T("Save")).font(NXFont.text(15, .bold))
                }
                .buttonStyle(NexusPrimaryButton())
                .disabled(busy || style == original)
            }
            .padding(16)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(field.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    /// How a value reads with these settings.
    private var sample: some View {
        let value: Decimal = style.isPercent ? Decimal(string: "0.42")! : Decimal(string: "1234567.891")!
        let shown = CustomFieldNumber.format(value, style: style)
        return HStack(spacing: 8) {
            Text(T("Preview")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            Spacer(minLength: 8)
            CFNumberValue(text: shown, style: style, fill: CustomFieldNumber.fill(value, style: style), font: NXFont.text(14))
        }
        .padding(12)
        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func save() async {
        busy = true; failed = false
        do {
            _ = try await APIClient.shared.updateCustomFieldDef(id: field.id, name: nil, type: nil, options: style.options)
            await onSaved()
            dismiss()
        } catch {
            failed = true
        }
        busy = false
    }
}
