import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Making and revoking links for one file or folder (owner, 9 Oct 2026: "harusnya bisa share link
// external untuk diliat org" — it could, but the choice was a switch called "Internal").
//
// The first question is WHO may open the link, in those words, with both answers on screen. A
// person who may not make a link for outsiders (only the uploader or BoD may) is told so before they
// pick it. Every link already made is listed with when it runs out, whether it downloads, who made
// it and how often it was opened.
//
// A new sheet per item (`.sheet(item:)` keyed on the item), so nothing picked for the last file
// carries over to the next one.
// ─────────────────────────────────────────────────────────────────────────────

struct VaultShareSheet: View {
    let item: VaultItem
    var onClose: () -> Void

    private enum Audience { case company, anyone }

    @State private var audience: Audience = .company
    @State private var allowDownload = true
    @State private var expires: VaultExpiry = .permanent
    @State private var shares: [VaultShare] = []
    @State private var canShareExternally: Bool?
    @State private var loaded = false
    @State private var busy = false
    @State private var problem: String?
    @State private var made: VaultShare?
    @State private var copiedId: String?

    /// The server's answer once it has given one; until then the item's own flag (the same rule).
    private var externalAllowed: Bool { canShareExternally ?? item.canModify }

    var body: some View {
        List {
            Section {
                audienceRow(.company, icon: "person.2.fill", title: T("People in NEXUS"),
                            detail: T("They sign in with their NEXUS account. On iPhone and Mac the link opens the app."),
                            enabled: true)
                audienceRow(.anyone, icon: "globe", title: T("Anyone with the link"),
                            detail: T("No account needed — for clients and partners. It opens in the browser."),
                            enabled: externalAllowed)
            } header: {
                Text(T("Who can open this link"))
            } footer: {
                if !externalAllowed {
                    Text(T("Only the person who uploaded this, or BoD, can make a link for people outside NEXUS. You can still share it with people in NEXUS."))
                }
            }

            Section {
                Toggle(T("Allow download"), isOn: $allowDownload)
                Picker(T("Expires"), selection: $expires) {
                    ForEach(VaultExpiry.allCases) { Text($0.label).tag($0) }
                }
            } footer: {
                Text(allowDownload
                     ? (item.isFolder ? T("People can save each file, or the whole folder as a .zip.") : T("People can save the file."))
                     : T("View only: pictures, videos, sound and PDFs open in the browser. Other files (Word, Excel, ZIP…) can't be opened at all."))
            }

            Section {
                Button {
                    Task { await create() }
                } label: {
                    HStack {
                        Label(T("Create link"), systemImage: "link")
                        Spacer()
                        if busy { ProgressView() }
                    }
                }
                .disabled(busy)

                if let made {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(T("Your new link")).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                        Text(made.url).font(NXFont.text(12)).foregroundStyle(NX.foreground)
                            .textSelection(.enabled).lineLimit(2)
                        HStack(spacing: 18) {
                            Button {
                                copy(made)
                            } label: {
                                Label(copiedId == made.id ? T("Copied") : T("Copy"),
                                      systemImage: copiedId == made.id ? "checkmark" : "doc.on.doc")
                            }
                            if let url = URL(string: made.url) {
                                ShareLink(item: url) { Label(T("Send link…"), systemImage: "square.and.arrow.up") }
                            }
                        }
                        // Two controls in one row: borderless, or a tap anywhere in the row fires both.
                        .buttonStyle(.borderless)
                        .font(NXFont.text(13, .semibold))
                    }
                    .padding(.vertical, 4)
                }
            } footer: {
                Text(item.isFolder
                     ? T("The link opens this folder and everything inside it, including what's added later.")
                     : T("The link always shows the current version of this file, even after it's replaced."))
            }

            Section(T("Links")) {
                if !loaded {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if shares.isEmpty {
                    Text(T("No links yet. Make one above — it shows up here with how often it was opened, and you can turn it off at any time."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                } else {
                    ForEach(shares) { shareRow($0) }
                }
            }

            if let problem {
                Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
        }
        .navigationTitle(item.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { onClose() } }
        }
        .task { await loadShares() }
    }

    private func audienceRow(_ value: Audience, icon: String, title: String, detail: String, enabled: Bool) -> some View {
        Button {
            audience = value
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: audience == value ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(audience == value ? NX.violetText : NX.mutedFg)
                VStack(alignment: .leading, spacing: 2) {
                    Label(title, systemImage: icon).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                    Text(detail).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
        .accessibilityAddTraits(audience == value ? .isSelected : [])
    }

    private func shareRow(_ share: VaultShare) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(Self.statusLabel(share)).font(NXFont.text(11, .bold))
                    .foregroundStyle(share.isActive ? (share.requireAuth ? NX.violetText : NX.success) : NX.mutedFg)
                Spacer()
            }
            Text(share.url.replacingOccurrences(of: "https://", with: ""))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            Text(Self.details(share)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            if share.isActive {
                HStack(spacing: 18) {
                    Button(copiedId == share.id ? T("Copied") : T("Copy")) { copy(share) }
                    if share.canRevoke != false {
                        Button(T("Revoke"), role: .destructive) { Task { await revoke(share) } }
                    }
                }
                .buttonStyle(.borderless)
                .font(NXFont.text(12, .semibold))
            }
        }
        .padding(.vertical, 2)
    }

    private static func statusLabel(_ share: VaultShare) -> String {
        switch share.status {
        case "revoked": return T("Revoked")
        case "expired": return T("Expired")
        default:        return share.requireAuth ? T("People in NEXUS") : T("Anyone with the link")
        }
    }

    /// "Until 12 Oct 2026 · Download on · by Rina · 3 views"
    private static func details(_ share: VaultShare) -> String {
        var parts: [String] = []
        if share.status == "revoked", let at = day(share.revokedAt) {
            parts.append(String(format: T("Turned off %@"), at))
        } else if let at = day(share.expiresAt) {
            parts.append(String(format: share.status == "expired" ? T("Expired %@") : T("Until %@"), at))
        } else {
            parts.append(T("No expiry"))
        }
        parts.append(share.allowDownload ? T("Download on") : T("View only"))
        if let name = share.createdBy?.name, !name.isEmpty { parts.append(String(format: T("by %@"), name)) }
        parts.append(share.viewCount == 1 ? T("1 view") : String(format: T("%d views"), share.viewCount))
        return parts.joined(separator: " · ")
    }

    private static func day(_ iso: String?) -> String? {
        guard let date = ProjDate.parse(iso) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB")
        f.timeZone = ProjDate.cal.timeZone
        f.dateFormat = "d MMM yyyy"
        return f.string(from: date)
    }

    private func copy(_ share: VaultShare) {
        UIPasteboard.general.string = share.url
        copiedId = share.id
    }

    private func loadShares() async {
        do {
            let response = try await APIClient.shared.vaultShares(itemId: item.id)
            shares = response.shares
            canShareExternally = response.canShareExternally
        } catch {
            problem = (error as? LocalizedError)?.errorDescription
        }
        loaded = true
    }

    private func create() async {
        busy = true
        defer { busy = false }
        problem = nil
        do {
            let share = try await APIClient.shared.vaultCreateShare(
                itemId: item.id, requireAuth: audience == .company, allowDownload: allowDownload, expires: expires)
            made = share
            copy(share)
            await loadShares()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong.")
        }
    }

    private func revoke(_ share: VaultShare) async {
        do {
            try await APIClient.shared.vaultRevokeShare(share.id)
            if made?.id == share.id { made = nil }
        } catch {
            problem = (error as? LocalizedError)?.errorDescription
        }
        await loadShares()
    }
}
