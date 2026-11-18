import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Print to the office printer (owner, 18 Nov 2026): the sheet a Legal document's Print button and a page's
// ••• menu open. Copies (1…5), Color / Black & white (black & white by default), then the job's state, asked
// of the server every 2.5 s for at most 2 minutes. Shown only while RemoteConfig says printing is on.
// ─────────────────────────────────────────────────────────────────────────────

struct PrintSheet: View {
    let kind: PrintKind
    let id: String
    let title: String

    @Environment(\.dismiss) private var dismiss
    @State private var config = RemoteConfig.shared
    @State private var copies = 1
    @State private var colorMode: PrintColorMode = .mono
    @State private var sending = false
    @State private var job: PrintJob?
    @State private var problem: String?
    /// The 2-minute poll ran out while the printer still said printing.
    @State private var stillPrinting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent(T("Printer"), value: config.printerName ?? "—")
                    if !title.isEmpty {
                        LabeledContent(T("Document"), value: title)
                    }
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

                if job == nil {
                    Section {
                        Button { Task { await send() } } label: {
                            HStack(spacing: 8) {
                                if sending { ProgressView() } else { Image(systemName: "printer") }
                                Text(sending ? T("Sending to the printer…") : T("Print")).bold()
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .disabled(sending)
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(job?.isFinished == true ? T("Done") : T("Close")) { dismiss() }
                        .disabled(sending)
                }
            }
        }
        // Closing mid-send would leave the person not knowing whether it went out.
        .interactiveDismissDisabled(sending)
        .presentationDetents([.medium, .large])
        .task(id: job?.id) { await poll() }
    }

    @ViewBuilder private func statusSection(_ job: PrintJob) -> some View {
        Section(T("Status")) {
            HStack(spacing: 10) {
                switch job.status {
                case "done": Image(systemName: "checkmark.circle.fill").foregroundStyle(NX.success)
                case "failed": Image(systemName: "xmark.octagon.fill").foregroundStyle(NX.danger)
                default: ProgressView()
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(job.statusLabel).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                    Text(job.pagesLabel + " · " + (job.isColor ? T("Color") : T("Black & white")))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
            .accessibilityElement(children: .combine)
            if job.status == "failed", let error = job.error, !error.isEmpty {
                Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
            }
            if stillPrinting && !job.isFinished {
                Text(T("Still printing. Check the Print log in Settings later."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    private func send() async {
        sending = true
        problem = nil
        defer { sending = false }
        do {
            job = try await APIClient.shared.submitPrint(kind: kind, id: id, copies: copies, colorMode: colorMode)
        } catch {
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
                if fresh.isFinished { return }
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
}
