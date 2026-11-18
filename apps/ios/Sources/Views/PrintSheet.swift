import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Print to the office printer (owner, 18 Nov 2026): the sheet a Legal document's Print button and a page's
// ••• menu open. Copies (1…5), Color / Black & white (black & white by default), then the job's state, asked
// of the server every 2.5 s for at most 2 minutes. Shown only while RemoteConfig says printing is on.
// For a file uploaded on the Print screen (kind .upload) it also takes the pages to print ("1-3,5").
// Above the controls: the printer's live status (PrinterStatusStore, every 5 s) and a preview of the exact PDF
// that prints (PrintPreviewAndStatus.swift); a page opens larger as a push in this sheet's NavigationStack.
// ─────────────────────────────────────────────────────────────────────────────

struct PrintSheet: View {
    let kind: PrintKind
    let id: String
    let title: String
    /// Uploads only: the file's page count, for the pages field and its checks.
    var pageCount: Int? = nil
    /// Uploads only: the upload was used up (a job was made, which deletes it when it ends, or the server says
    /// it has expired). The Print screen then forgets it instead of deleting it.
    var onUploadUsed: (() -> Void)? = nil
    /// The job ended (done or failed): the Print screen refreshes its recent prints.
    var onJobFinished: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var config = RemoteConfig.shared
    @State private var copies = 1
    @State private var colorMode: PrintColorMode = .mono
    @State private var sending = false
    @State private var job: PrintJob?
    @State private var problem: String?
    /// The 2-minute poll ran out while the printer still said printing.
    @State private var stillPrinting = false
    @State private var pageRanges = ""
    @State private var printer = PrinterStatusStore()
    @State private var preview = PrintPreviewModel()
    /// The page opened larger (0-based), pushed in this sheet's stack.
    @State private var zoomPage: Int?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent(T("Printer"), value: config.printerName ?? "—")
                    if job == nil { PrinterStatusPanel(status: printer.status, failed: printer.failed, showNote: false) }
                    if !title.isEmpty {
                        LabeledContent(T("Document"), value: title)
                    }
                }
                Section(T("Preview")) {
                    PrintPreviewStrip(model: preview, included: includedPages, mono: colorMode == .mono,
                                      onRetry: { Task { await preview.load(kind: kind, id: id) } },
                                      onOpen: { zoomPage = $0 })
                }
                Section {
                    Stepper(value: $copies, in: 1...config.printingMaxCopies) {
                        LabeledContent(T("Copies"), value: "\(copies)")
                    }
                    Picker(T("Color"), selection: $colorMode) {
                        ForEach(PrintColorMode.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(String(format: T("At most %d pages per print."), config.printingMaxPages))
                }
                .disabled(sending || job != nil)

                if kind == .upload { pagesSection }

                if job == nil {
                    Section {
                        Button { Task { await send() } } label: {
                            HStack(spacing: 8) {
                                if sending { ProgressView() } else { Image(systemName: "printer") }
                                Text(sending ? T("Sending to the printer…") : T("Print")).bold()
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .disabled(sending || pagesProblem != nil)
                        .accessibilityIdentifier("print.submit")
                    }
                }
                if let job { statusSection(job) }
                if let problem {
                    Section { Text(problem).font(NXFont.text(13)).foregroundStyle(NX.danger) }
                }
            }
            .navigationTitle(T("Print"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $zoomPage) { i in
                if let doc = preview.document {
                    PrintPageLargeView(document: doc, index: i, mono: colorMode == .mono, included: includedPages)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(job?.isFinished == true ? T("Done") : T("Close")) { dismiss() }
                        .disabled(sending)
                }
            }
        }
        // Closing mid-send would leave the person not knowing whether it went out.
        .interactiveDismissDisabled(sending)
        .presentationDetents([.large])
        .task(id: job?.id) { await poll() }
        .task { await preview.load(kind: kind, id: id) }
        .printerStatusPolling(printer)
    }

    /// Which pages of an upload: empty = all. Checked here as the server checks it, so a typo is caught before
    /// the upload is sent to the printer.
    private var pagesSection: some View {
        Section {
            LabeledContent(T("Pages")) {
                TextField("", text: $pageRanges, prompt: Text(T("All pages")))
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numbersAndPunctuation)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .accessibilityLabel(T("Pages"))
            }
        } footer: {
            if let pagesProblem {
                Text(pagesProblem).foregroundStyle(NX.danger)
            } else {
                Text(T("e.g. 1-3,5"))
            }
        }
        .disabled(sending || job != nil)
    }

    /// Why the typed pages can't be printed (uploads only), or nil.
    private var pagesProblem: String? {
        guard kind == .upload, let pageCount, pageCount > 0 else { return nil }
        let maxPages = config.printingMaxPages
        switch PrintPageRanges.check(pageRanges, pageCount: pageCount) {
        case .invalid(let why): return why
        case .count(let n) where n > maxPages:
            return String(format: T("These pages add up to %d. One print can have at most %d pages."), n, maxPages)
        case .all where pageCount > maxPages:
            return String(format: T("This file has %d pages. One print can have at most %d pages."), pageCount, maxPages)
        default: return nil
        }
    }

    /// The pages an upload's typed range prints (1-based), for dimming the rest; nil = all.
    private var includedPages: Set<Int>? {
        guard kind == .upload, let count = pageCount ?? preview.document?.pageCount else { return nil }
        return PrintPageRanges.pages(pageRanges, pageCount: count)
    }

    /// This job in the printer's queue, while it is there.
    private func queued(_ job: PrintJob) -> PrinterQueueJob? { printer.status?.queueJob(for: job.id) }

    /// The printer's cable is out while this job waits: never "Printing…" then (owner, 18 Nov 2026).
    private func waitsForPrinter(_ job: PrintJob) -> Bool {
        !job.isFinished && (printer.status?.isDisconnected == true || queued(job)?.state == "stalled")
    }

    /// "Printing…" made precise by the queue: its place in line, or that it is printing now.
    private func headline(_ job: PrintJob) -> String {
        if waitsForPrinter(job) { return printerDisconnectedText() }
        if !job.isFinished, let q = queued(job) {
            if q.position > 1 { return String(format: T("Position %d in the queue"), q.position) }
            if q.state == "printing" { return T("Printing now") }
        }
        return job.statusLabel
    }

    @ViewBuilder private func statusSection(_ job: PrintJob) -> some View {
        Section(T("Status")) {
            HStack(spacing: 10) {
                switch job.status {
                case "done": Image(systemName: "checkmark.circle.fill").foregroundStyle(NX.success)
                case "failed": Image(systemName: "xmark.octagon.fill").foregroundStyle(NX.danger)
                default:
                    if waitsForPrinter(job) { Image(systemName: "cable.connector.slash").foregroundStyle(NX.warning) } else { ProgressView() }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline(job)).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(job.pagesLabel + " · " + (job.isColor ? T("Color") : T("Black & white")))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
            .accessibilityElement(children: .combine)
            if job.status == "failed", let error = job.error, !error.isEmpty {
                Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
            }
            if stillPrinting && !job.isFinished && !waitsForPrinter(job) {
                Text(T("Still printing. Check the Print log in Settings later."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            // The printer as it is now (paper out, who is ahead), under the job.
            if !job.isFinished, printer.status?.isDisconnected != true {
                PrinterStatusPanel(status: printer.status, failed: printer.failed, showNote: false)
            }
        }
    }

    private func send() async {
        sending = true
        problem = nil
        defer { sending = false }
        do {
            job = try await APIClient.shared.submitPrint(kind: kind, id: id, copies: copies, colorMode: colorMode,
                                                         pageRanges: kind == .upload ? pageRanges : nil)
            if kind == .upload { onUploadUsed?() }
            if job?.isFinished == true { onJobFinished?() }
        } catch {
            if kind == .upload, (error as? PrintAPIError)?.code == "UPLOAD_GONE" { onUploadUsed?() }
            problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong on our side. Try again in a moment.")
        }
    }

    /// Every 2.5 s until done / failed, for at most 2 minutes. A failed read just tries again next time.
    private func poll() async {
        guard let started = job, !started.isFinished else { return }
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard !Task.isCancelled, let current = job else { return }
            if let fresh = try? await APIClient.shared.printJob(id: current.id) {
                job = fresh
                if fresh.isFinished { onJobFinished?(); return }
            }
        }
        stillPrinting = true
    }
}

/// What a sheet item needs to open the print sheet.
struct PrintTarget: Identifiable, Hashable {
    let kind: PrintKind
    let id: String
    let title: String
    /// Uploads only: the file's page count.
    var pages: Int? = nil
}
