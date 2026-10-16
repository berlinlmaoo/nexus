import SwiftUI

/// The web leaderboard's admin XP log (XpAuditLog.tsx), for BoD and up: a folded card under the ranking,
/// "XP log, Every XP change, added or deducted, for everyone". Open, it lists every change newest
/// first, filtered by sign and by period, 40 at a time. The iPhone had no such card, so the tour found
/// nothing after the last rank (UI tour run 18, iPhone R18-I-06).
struct XpAuditLogCard: View {
    @State private var open = false
    @State private var sign = "all"
    @State private var scope = "period"
    @State private var rows: [XpLogEntry] = []
    @State private var nextOffset: Int?
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(.snappy(duration: 0.2)) { open.toggle() } } label: { header }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(open ? .isSelected : [])
            if open {
                Divider().overlay(NX.border)
                filters
                list
            }
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .task(id: "\(open)-\(sign)-\(scope)") { if open { await load(reset: true) } }
    }

    private var header: some View {
        HStack(spacing: 12) {
            // The web's neutral grey tile (UI tour run 19, R19-I-30).
            Image(systemName: "scroll").font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.foreground)
                .frame(width: 36, height: 36)
                .background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                // No badge: the log is BoD and up only, and the "ADMIN" one named a role that is gone (decision 3
                // of run 20, R20-I-03 / R20-B-07; web WB-1).
                Text(T("XP log")).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                Text(T("Every XP change, added or deducted, for everyone")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.down").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.mutedFg)
                .rotationEffect(.degrees(open ? 180 : 0))
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    private var filters: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { signPicker; scopePicker; Spacer(minLength: 0) }
            VStack(alignment: .leading, spacing: 8) { signPicker; scopePicker }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private var signPicker: some View {
        XpSegmented(value: $sign, options: [("all", T("All")), ("pos", T("Added (+)")), ("neg", T("Deducted (−)"))])
    }

    private var scopePicker: some View {
        XpSegmented(value: $scope, options: [("period", T("This period")), ("all", T("All time"))])
    }

    /// 0 XP rows moved nothing (a removed deduction's marker), as the web leaves them out.
    private var shown: [XpLogEntry] { rows.filter { $0.amount != 0 } }

    @ViewBuilder private var list: some View {
        if loading && rows.isEmpty {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 20)
        } else if failed && rows.isEmpty {
            Text(T("Couldn't load the log. It needs board access or higher."))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity).padding(.horizontal, 16).padding(.bottom, 18)
        } else if shown.isEmpty {
            Text(scope == "period" ? T("No XP changes yet this period.") : T("No XP changes yet."))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity).padding(.horizontal, 16).padding(.bottom, 18)
        } else {
            VStack(spacing: 0) {
                ForEach(shown) { r in
                    Divider().overlay(NX.border)
                    row(r)
                }
                if nextOffset != nil {
                    Divider().overlay(NX.border)
                    Button { Task { await load(reset: false) } } label: {
                        HStack(spacing: 6) {
                            if loading { ProgressView().scaleEffect(0.7).tint(NX.violetText) }
                            Text(T("Load more")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(loading)
                }
            }
        }
    }

    private func row(_ r: XpLogEntry) -> some View {
        let name = r.userName ?? "—"
        return HStack(spacing: 12) {
            AvatarView(url: r.userAvatar, initial: String(name.prefix(1)).uppercased(), size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text([r.label, when(r)].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(r.amount > 0 ? "+" : r.amount < 0 ? "−" : "")\(AppNumber.int(abs(r.amount))) XP")
                .font(NXFont.text(14, .heavy)).monospacedDigit()
                .foregroundStyle(r.amount >= 0 ? NX.success : NX.danger)
                .fixedSize()
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    /// "14 Oct 18:50": the day, the year only outside this one, and the time.
    private func when(_ r: XpLogEntry) -> String {
        guard let d = ProjDate.parse(r.createdAt) else { return "" }
        let time = AppDateLocale.formatter("HH:mm", timeZone: TimeZone(identifier: "Asia/Jakarta")).string(from: d)
        return "\(AppDateLocale.shortDate(d)) \(time)"
    }

    private func load(reset: Bool) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        let offset = reset ? 0 : (nextOffset ?? 0)
        do {
            let page = try await APIClient.shared.xpAuditLog(sign: sign == "all" ? nil : sign, scope: scope, offset: offset)
            rows = (reset ? [] : rows) + (page.rows ?? [])
            nextOffset = page.hasMore == true ? page.nextOffset : nil
            failed = false
        } catch {
            if reset { rows = []; nextOffset = nil }
            failed = true
        }
    }
}

/// The web's small segmented control: the picked option on a card-coloured pill.
private struct XpSegmented: View {
    @Binding var value: String
    let options: [(String, String)]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.0) { id, label in
                let on = value == id
                Button { value = id } label: {
                    Text(label).font(NXFont.text(12, .semibold)).lineLimit(1).fixedSize()
                        .foregroundStyle(on ? NX.foreground : NX.mutedFg)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(on ? NX.card : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(2)
        .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
    }
}
