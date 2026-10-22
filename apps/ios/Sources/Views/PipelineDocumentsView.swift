import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

// MARK: - A deal's documents, and its services (owner, 9 Oct 2026)
//
// Two parts of the deal sheet that present things of their own — the Files picker, Photos, a viewer, the
// share sheet, a confirm — so they live in their own views here: PipelineDealView already has its one
// `.sheet` (payment terms) and its one `.alert`, and two of either on one view is the bug where only one
// ever opens.

/// What the documents editor's one `.sheet` shows.
private enum PipelineDocsRoute: Identifiable {
    case files
    case share(URL)
    var id: String {
        switch self {
        case .files: return "files"
        case .share(let u): return "share-\(u.path)"
        }
    }
}

/// One file on its way up, with its own bar.
private struct PipelineUpload: Identifiable {
    let id = UUID()
    let name: String
    let progress: UploadProgress
}

/// "Documents & links" (owner, 9 Oct 2026: "kenapa document sama links ini cuma paste document? kenapa ga
/// attach documentnya jg?"). Each entry keeps its type (SPK / Contract / MOU / Invoice / Other) and
/// optional name and is either a pasted link or an attached file. "Attach file" (Files) and "Photo"
/// (Photos) go up through the shared chunk route with target=pipeline — the server adds the entry, so a
/// file is never half attached. A file opens in the app's own viewer (pictures, PDFs, films) or the share
/// sheet (Office files); removing one asks first with a centred alert. The server keeps the bytes until
/// the 90-day purge, like every deleted attachment.
struct PipelineDocumentsEditor: View {
    let store: PipelineStore
    let deal: PipelineDeal
    let linkTypes: [String]
    /// A pasted link: the whole list goes back in one PATCH, as before (files in it are kept by id).
    let onCommitLinks: ([PipelineLink]) -> Void

    @Environment(\.openURL) private var openURL
    @State private var type = "SPK"
    @State private var url = ""
    @State private var label = ""
    @State private var route: PipelineDocsRoute?
    @State private var showPhotos = false
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var toRemove: PipelineLink?
    @State private var preview: AttachmentPreview?
    @State private var uploads: [PipelineUpload] = []
    @State private var opening: String?

    /// The chunk route's ceiling, the same as a task attachment's.
    private static let maxBytes = 1 << 30

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if deal.links.isEmpty && uploads.isEmpty {
                EmptyState(icon: "doc.text", title: T("No documents or links yet."),
                           subtitle: store.canEdit ? T("Attach a file or paste a link.") : "", compact: true, quietTitle: true)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(deal.links.enumerated()), id: \.element.id) { i, l in
                        if i > 0 { Divider().overlay(NX.border) }
                        row(l)
                    }
                    ForEach(uploads) { u in
                        Divider().overlay(NX.border)
                        uploadRow(u)
                    }
                }
                .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            }
            if store.canEdit { form }
        }
        .onAppear { validateType() }
        .onChange(of: linkTypes) { _, _ in validateType() }
        .sheet(item: $route) { r in
            switch r {
            case .files:
                DocumentPicker(types: [.item], multiple: true) { urls in
                    // Private copies (`asCopy`): this app's to delete once they are up.
                    attach(urls.map { (file: $0, name: $0.lastPathComponent, cleanup: $0) })
                }
                .ignoresSafeArea()
            case .share(let file):
                ActivityView(items: [file])
            }
        }
        .photosPicker(isPresented: $showPhotos, selection: $pickedPhotos, maxSelectionCount: 10,
                      matching: .any(of: [.images, .videos]))
        .onChange(of: pickedPhotos) { _, items in
            guard !items.isEmpty else { return }
            pickedPhotos = []
            Task { await absorbPhotos(items) }
        }
        .fullScreenCover(item: $preview) { AttachmentViewerView(preview: $0) }
        .alert(toRemove.map { String(format: T("Remove %@?"), name(of: $0)) } ?? "",
               isPresented: Binding(get: { toRemove != nil }, set: { if !$0 { toRemove = nil } })) {
            Button(T("Cancel"), role: .cancel) { toRemove = nil }
            Button(T("Remove document"), role: .destructive) {
                if let doc = toRemove {
                    toRemove = nil
                    Task { await store.removeDocument(deal.id, doc) }
                }
            }
        } message: {
            Text(T("It leaves this deal for everyone. The deal's history keeps a note of it."))
        }
    }

    // MARK: rows

    private func name(of l: PipelineLink) -> String {
        if !l.label.isEmpty { return l.label }
        return l.isFile ? (l.fileName ?? T("File")) : l.url
    }

    private func glyph(_ l: PipelineLink) -> String {
        guard l.isFile else { return "link" }
        if let kind = AttachmentKind(mime: l.mimeType, name: l.fileName) { return kind.glyph }
        let ext = (l.fileName ?? "").lowercased().split(separator: ".").last.map(String.init) ?? ""
        if ["xls", "xlsx", "csv", "numbers"].contains(ext) { return "tablecells" }
        if ["ppt", "pptx", "key"].contains(ext) { return "rectangle.on.rectangle" }
        return "doc.fill"
    }

    private func row(_ l: PipelineLink) -> some View {
        HStack(spacing: 8) {
            NexusChip(text: PipelineText.link(l.type))
            Button { open(l) } label: {
                HStack(spacing: 8) {
                    Image(systemName: glyph(l)).font(.system(size: 13)).foregroundStyle(NX.violetText)
                        .frame(width: 28, height: 28)
                        .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(name(of: l)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText).lineLimit(1)
                            if !l.isFile {
                                Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.violetText)
                            }
                        }
                        if l.isFile {
                            Text(fileLine(l)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        }
                    }
                    if opening == l.id { ProgressView().scaleEffect(0.7) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(opening == l.id)
            Spacer(minLength: 4)
            if store.canEdit {
                Button { askRemove(l) } label: {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
                        .frame(width: 32, height: 32).touchTarget44(drawn: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(l.isFile ? T("Remove document") : T("Remove link"))
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
        .contextMenu {
            Button { open(l) } label: { Label(T("Open"), systemImage: l.isFile ? "eye" : "safari") }
            if l.isFile {
                Button { share(l) } label: { Label(T("Share"), systemImage: "square.and.arrow.up") }
            }
            if store.canEdit {
                Button(role: .destructive) { askRemove(l) } label: {
                    Label(l.isFile ? T("Remove document") : T("Remove link"), systemImage: "trash")
                }
            }
        }
    }

    /// "Kontrak_final.pdf · 2.4 MB" — the file's own name under a given one, then its size.
    private func fileLine(_ l: PipelineLink) -> String {
        var parts: [String] = []
        if !l.label.isEmpty, let f = l.fileName { parts.append(f) }
        if let s = l.size { parts.append(AppNumber.bytes(Double(s))) }
        return parts.joined(separator: " · ")
    }

    private func uploadRow(_ u: PipelineUpload) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                ProgressView().scaleEffect(0.7)
                Text(u.name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 0)
            }
            if u.progress.isActive { UploadProgressBar(progress: u.progress) }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(String(format: T("Uploading %@"), u.name))
    }

    // MARK: adding

    private var form: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Menu {
                    ForEach(linkTypes, id: \.self) { k in
                        Button { type = k } label: {
                            if k == type { Label(PipelineText.link(k), systemImage: "checkmark") } else { Text(PipelineText.link(k)) }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(PipelineText.link(type)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    }
                    .modifier(PipelineInputChrome())
                }
                .menuIndicator(.hidden)
                .accessibilityLabel(T("Link type"))
                .accessibilityIdentifier("pipeline.documents.type")
                TextField(T("Paste a link (https://…)"), text: $url)
                    .font(NXFont.text(14)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .modifier(PipelineInputChrome())
                    .accessibilityLabel(T("Link"))
            }
            TextField(T("Document name (optional)"), text: $label)
                .font(NXFont.text(14))
                .modifier(PipelineInputChrome())
                .accessibilityLabel(T("Document name"))
            HStack(spacing: 8) {
                Button { addLink() } label: {
                    Label(T("Add link"), systemImage: "plus").font(NXFont.text(13, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 14).frame(minHeight: 38)
                        .background(NX.violetFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty)
                .opacity(url.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
                secondary(T("Attach file"), icon: "paperclip") { route = .files }
                secondary(T("Photo"), icon: "photo") { showPhotos = true }
            }
        }
    }

    private func secondary(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                .padding(.horizontal, 12).frame(minHeight: 38)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func addLink() {
        var u = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !u.isEmpty else { return }
        let lower = u.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") { u = "https://\(u)" }
        let id = "lnk" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
        onCommitLinks(deal.links + [PipelineLink(id: id, type: type, label: label.trimmingCharacters(in: .whitespaces), url: u)])
        url = ""
        label = ""
    }

    private func validateType() {
        if !linkTypes.contains(type), let first = linkTypes.first { type = first }
    }

    /// One after another, each with its own bar. The name field names a single file; with several each
    /// keeps its own file name. A refusal (too big, no access) goes to the deal sheet's alert.
    private func attach(_ files: [(file: URL, name: String, cleanup: URL?)]) {
        guard !files.isEmpty else { return }
        let given = files.count == 1 ? label.trimmingCharacters(in: .whitespaces) : ""
        let kind = type
        label = ""
        Task {
            for f in files {
                let size = APIClient.fileSize(of: f.file)
                if size > Self.maxBytes {
                    store.actionError = String(format: T("%@ is over 1 GB."), f.name)
                } else {
                    let row = PipelineUpload(name: f.name, progress: UploadProgress())
                    uploads.append(row)
                    await store.uploadDocument(deal.id, file: f.file, fileName: f.name, type: kind, label: given, progress: row.progress)
                    uploads.removeAll { $0.id == row.id }
                }
                if let c = f.cleanup { try? FileManager.default.removeItem(at: c) }
            }
        }
    }

    /// Pictures and films from Photos, copied out of the library the way Z Vault does it.
    private func absorbPhotos(_ items: [PhotosPickerItem]) async {
        var files: [(file: URL, name: String, cleanup: URL?)] = []
        for item in items {
            if let picked = try? await item.loadTransferable(type: VaultPickedFile.self) {
                files.append((file: picked.url, name: picked.url.lastPathComponent, cleanup: picked.url.deletingLastPathComponent()))
            }
        }
        if files.count < items.count {
            store.actionError = T("Some photos didn't come through")
        }
        attach(files)
    }

    // MARK: opening, sharing, removing

    private func askRemove(_ l: PipelineLink) {
        // A pasted link goes at once (it can be pasted again); a file asks first.
        if l.isFile { toRemove = l } else { Task { await store.removeDocument(deal.id, l) } }
    }

    private func open(_ l: PipelineLink) {
        guard l.isFile else {
            if let u = URL(string: l.url) { openURL(u) }
            return
        }
        let fileName = l.fileName ?? name(of: l)
        let kind = AttachmentKind(mime: l.mimeType, name: fileName)
        // A picture goes to the photo viewer by its address (ImageLoader fetches it with the session).
        if kind == .image, let remote = URL(string: Config.baseURL.absoluteString + l.url) {
            preview = AttachmentPreview(id: l.id, name: name(of: l), kind: .image, source: remote)
            return
        }
        fetch(l) { file in
            if let kind {
                preview = AttachmentPreview(id: l.id, name: name(of: l), kind: kind, source: file)
            } else {
                // Word, Excel, PowerPoint …: the share sheet offers the apps that open them.
                route = .share(file)
            }
        }
    }

    private func share(_ l: PipelineLink) {
        fetch(l) { route = .share($0) }
    }

    /// The bytes come through APIClient: the download route wants the session, which Safari and
    /// QuickLook's own fetch do not have.
    private func fetch(_ l: PipelineLink, then: @escaping (URL) -> Void) {
        opening = l.id
        Task {
            do {
                let file = try await APIClient.shared.downloadAttachment(url: l.url, fileName: l.fileName ?? name(of: l))
                opening = nil
                then(file)
            } catch {
                opening = nil
                store.actionError = T("Couldn't open this file.")
            }
        }
    }
}

// MARK: - Services

/// A deal's services (owner, 9 Oct 2026: "gw mau bisa select multiple services dan ngetik service sendiri,
/// takutnya ada deal yg bisa kita kerjain tpi diluar services ini"): the row shows them, a tap opens a
/// sheet with the presets as checkmarks and a field for one that isn't listed. Each tap saves the list.
struct PipelineServicesField: View {
    let store: PipelineStore
    let dealId: String
    @State private var editing = false

    private var services: [String] { store.deal(dealId)?.services ?? [] }

    var body: some View {
        Button { editing = true } label: {
            HStack(spacing: 6) {
                if services.isEmpty {
                    Text(T("No services yet")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                } else {
                    Text(services.joined(separator: ", ")).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                        .lineLimit(2).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(NX.mutedFg)
            }
            .modifier(PipelineInputChrome())
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(T("Services"))
        .accessibilityValue(services.joined(separator: ", "))
        .sheet(isPresented: $editing) {
            PipelineServicesSheet(store: store, dealId: dealId)
        }
    }
}

private struct PipelineServicesSheet: View {
    let store: PipelineStore
    let dealId: String
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @FocusState private var typing: Bool

    private static let maxServices = 20
    private static let maxLength = 60

    private var services: [String] { store.deal(dealId)?.services ?? [] }
    private var presets: [String] { store.vocab.services }
    private func has(_ s: String) -> Bool { services.contains { $0.caseInsensitiveCompare(s) == .orderedSame } }
    private func isPreset(_ s: String) -> Bool { presets.contains { $0.caseInsensitiveCompare(s) == .orderedSame } }

    /// Typed services the board's other deals use, most used first — so "KOL" is not spelled three ways.
    private var suggestions: [String] {
        var count: [String: Int] = [:]
        for d in store.deals where d.id != dealId {
            for s in d.services where !isPreset(s) { count[s, default: 0] += 1 }
        }
        return count.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.map { $0.key }.filter { !has($0) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(presets, id: \.self) { s in toggleRow(s) }
                }
                let custom = services.filter { !isPreset($0) }
                if !custom.isEmpty || !suggestions.isEmpty {
                    Section(T("Other services")) {
                        ForEach(custom, id: \.self) { s in toggleRow(s) }
                        ForEach(suggestions, id: \.self) { s in toggleRow(s) }
                    }
                }
                Section {
                    HStack(spacing: 8) {
                        TextField(T("Add custom service"), text: $draft)
                            .font(NXFont.text(15)).focused($typing).submitLabel(.done)
                            .onSubmit { add() }
                        Button(T("Add")) { add() }
                            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || services.count >= Self.maxServices)
                    }
                } footer: {
                    Text(T("Pick the services, or type one that isn't listed."))
                }
            }
            .navigationTitle(T("Services"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(T("Done")) { dismiss() } } }
        }
    }

    private func toggleRow(_ s: String) -> some View {
        Button { toggle(s) } label: {
            HStack {
                Text(s).foregroundStyle(NX.foreground)
                Spacer()
                if has(s) { Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.violetText) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(has(s) ? .isSelected : [])
    }

    private func toggle(_ s: String) {
        let next = has(s) ? services.filter { $0.caseInsensitiveCompare(s) != .orderedSame } : services + [s]
        save(next)
    }

    private func add() {
        let s = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        draft = ""
        guard !s.isEmpty, !has(s), services.count < Self.maxServices else { return }
        // A preset typed by hand is the preset, spelled as the list spells it.
        let name = presets.first { $0.caseInsensitiveCompare(s) == .orderedSame } ?? String(s.prefix(Self.maxLength))
        save(services + [name])
    }

    private func save(_ list: [String]) {
        Task { await store.patch(dealId, ["services": list]) }
    }
}
