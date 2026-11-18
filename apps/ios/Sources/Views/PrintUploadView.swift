import SwiftUI
import UniformTypeIdentifiers

// ─────────────────────────────────────────────────────────────────────────────
// Print (owner, 18 Nov 2026; web /print): any company member uploads a file and prints it on the office printer.
// Choose a file → the server turns it into a PDF and counts its pages (5–30 s) → PrintSheet (copies, colour,
// pages). The upload lives on the server until its print job ends (then it is deleted) or for an hour; a file
// the person drops here without printing (another file chosen, the screen left) is deleted right away.
// Reached from More (phone) and the sidebar's Team group (iPad / Mac), `nexus://print`; only while
// RemoteConfig `printing.enabled`.
// ─────────────────────────────────────────────────────────────────────────────

struct PrintUploadView: View {
    @Environment(AuthStore.self) private var auth
    @State private var config = RemoteConfig.shared
    @State private var upload: PrintUpload?
    /// The name of the file being uploaded and converted, while that runs.
    @State private var preparing: String?
    @State private var problem: String?
    @State private var importing = false
    @State private var printTarget: PrintTarget?
    /// A file was printed from here: the empty state offers "Print another file".
    @State private var printedOne = false
    /// False once the screen is gone, so an upload that finishes afterwards is deleted, not kept.
    @State private var onScreen = false

    /// What the server prints: PDF, Word, Excel, PowerPoint, JPG and PNG (HEIC is refused).
    private static let types: [UTType] = {
        let office = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"].compactMap { UTType(filenameExtension: $0) }
        return [.pdf, .jpeg, .png] + office
    }()

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if !config.printingEnabled {
                EmptyState(icon: "printer", title: T("Printer isn't set up on this server"),
                           subtitle: T("Print shows up here once the office printer is set up on the server."))
            } else {
                content
                    // On the content, not on the ZStack that presents the print sheet: one presentation per view.
                    .fileImporter(isPresented: $importing, allowedContentTypes: Self.types, allowsMultipleSelection: false) { result in
                        switch result {
                        case .success(let urls): if let url = urls.first { Task { await choose(url) } }
                        case .failure: problem = T("Couldn't read that file.")
                        }
                    }
            }
        }
        .navigationTitle(T("Print"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $printTarget) { t in
            PrintSheet(kind: .upload, id: t.id, title: t.title, pageCount: t.pages) {
                // A job was made (or the upload expired): the server deletes the file itself.
                upload = nil
                printedOne = true
            }
        }
        .onAppear { onScreen = true }
        .onDisappear {
            onScreen = false
            discardUpload()
        }
    }

    @ViewBuilder private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let name = preparing {
                    preparingCard(name)
                } else if let upload {
                    fileCard(upload)
                } else {
                    EmptyState(icon: "printer", title: T("Print any file on the office printer"),
                               subtitle: T("PDF, Word, Excel, PowerPoint, JPG or PNG, up to 25 MB. The file is deleted from the server once it's printed."),
                               actionTitle: printedOne ? T("Print another file") : T("Choose a file"), actionIcon: "doc.badge.plus",
                               action: { problem = nil; importing = true }, prominent: true)
                    if let printer = config.printerName {
                        Text(T("Printer") + ": " + printer)
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity)
                    }
                }
                if let problem {
                    Text(problem)
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        .background(NX.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(16)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
    }

    private func preparingCard(_ name: String) -> some View {
        HStack(spacing: 12) {
            ProgressView()
            VStack(alignment: .leading, spacing: 2) {
                Text(T("Preparing the file…")).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                Text(name).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .nexusCard()
    }

    private func fileCard(_ upload: PrintUpload) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "doc.fill")
                    .font(.system(size: 18)).foregroundStyle(NX.violetText)
                    .frame(width: 40, height: 40)
                    .background(NX.accentBg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(upload.fileName.isEmpty ? T("Uploaded file") : upload.fileName)
                        .font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                        .lineLimit(2).truncationMode(.middle)
                    Text(String(format: T("%d pages"), upload.pages))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            HStack(spacing: 8) {
                Button {
                    printTarget = PrintTarget(kind: .upload, id: upload.id, title: upload.fileName, pages: upload.pages)
                } label: {
                    Label(T("Print"), systemImage: "printer")
                }
                .buttonStyle(NXButtonStyle(kind: .primary))
                .accessibilityIdentifier("printUpload.print")
                Button {
                    problem = nil
                    importing = true
                } label: {
                    Label(T("Choose another file"), systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(NXButtonStyle(kind: .bordered))
                Spacer(minLength: 0)
            }
        }
        .nexusCard()
    }

    /// Uploads the chosen file; the one chosen before (not printed) is deleted first.
    private func choose(_ url: URL) async {
        discardUpload()
        problem = nil
        preparing = url.lastPathComponent
        defer { preparing = nil }
        do {
            let fresh = try await APIClient.shared.uploadPrintFile(url)
            if onScreen {
                upload = fresh
            } else {
                await APIClient.shared.deletePrintUpload(id: fresh.id)
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong on our side. Try again in a moment.")
        }
    }

    /// Deletes the current upload on the server (best effort) and forgets it.
    private func discardUpload() {
        guard let old = upload else { return }
        upload = nil
        Task { await APIClient.shared.deletePrintUpload(id: old.id) }
    }
}
