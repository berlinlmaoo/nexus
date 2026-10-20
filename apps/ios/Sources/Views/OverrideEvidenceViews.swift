import SwiftUI
import PhotosUI
import UIKit

/// The upload field a board status change shows when it asks for evidence (owner 20 Oct 2026, optional):
/// the hint, a camera button and a file button (photo library or Files: a photo or a PDF, up to 10 MB).
/// The chosen file shows as one row with ✕. Web: EvidencePicker in StatusOverridePanel.tsx.
///
/// Its pickers are presented from this view, not from the record sheet, which already owns a
/// fullScreenCover and two alerts.
struct OverrideEvidencePicker: View {
    let kind: OverrideEvidence.Kind
    @Binding var file: (name: String, data: Data)?
    var disabled = false
    @State private var showCamera = false
    @State private var showImporter = false
    @State private var showPhotoPicker = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var err: String?

    private static let maxBytes = 10 * 1024 * 1024
    /// A photo is named by what it is evidence of; the server judges the upload by this extension.
    private var photoName: String { kind == .sickNote ? "sick-note.jpg" : "evidence.jpg" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(kind == .sickNote ? T("Attach the sick note") : T("Attach a supporting photo or file"), systemImage: "paperclip")
                .font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
            Text(T("Optional. Photo or PDF, up to 10 MB. Saved without it, the day is marked “no evidence attached”."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            if let file {
                HStack(spacing: 8) {
                    Image(systemName: file.name.lowercased().hasSuffix(".pdf") ? "doc.richtext" : "photo")
                        .font(.system(size: 14)).foregroundStyle(NX.violetText)
                    Text(file.name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 0)
                    Button { self.file = nil } label: {
                        Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg)
                            .frame(width: 28, height: 28).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).disabled(disabled).accessibilityLabel(T("Remove file"))
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else {
                HStack(spacing: 8) {
                    Button { showCamera = true } label: { pill(T("Take photo"), "camera") }
                        .buttonStyle(.plain)
                    // A PhotosPicker nested in a Menu draws its row but never opens, so the menu only
                    // flips flags and the pickers live below.
                    Menu {
                        Button { showPhotoPicker = true } label: { Label(T("Choose from library"), systemImage: "photo") }
                        Button { showImporter = true } label: { Label(T("Choose a file"), systemImage: "folder") }
                    } label: { pill(T("Choose file"), "paperclip") }
                        .buttonStyle(.plain)
                }
                .disabled(disabled)
            }
            if let err { Text(err).font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger) }
        }
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.violet.opacity(0.35)))
        .fullScreenCover(isPresented: $showCamera) {
            // Under .fullScreenCover the picker cannot reliably dismiss itself, so whoever presented it closes it.
            CameraPicker(cameraDevice: .rear) { data in
                showCamera = false
                take(name: photoName, data: data)
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $showImporter) {
            DocumentPicker(types: [.image, .pdf], multiple: false) { urls in
                guard let url = urls.first else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                // Size first, bytes second: a huge file is refused without reading it.
                let size = APIClient.fileSize(of: url)
                guard size > 0 else { err = T("Couldn't read that file."); return }
                guard size <= Self.maxBytes else { err = T("File is over the 10MB limit."); return }
                guard let data = try? Data(contentsOf: url) else { err = T("Couldn't read that file."); return }
                take(name: url.lastPathComponent, data: data)
            }
            .ignoresSafeArea()
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $pickedPhoto, matching: .images, photoLibrary: .shared())
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task {
                if let raw = try? await item.loadTransferable(type: Data.self) {
                    // The library hands back HEIC as often as JPEG; sent as what its name says it is.
                    take(name: photoName, data: UIImage(data: raw)?.jpegData(compressionQuality: 0.85) ?? raw)
                } else {
                    err = T("Couldn't read that file.")
                }
                pickedPhoto = nil
            }
        }
    }

    private func take(name: String, data: Data) {
        guard data.count <= Self.maxBytes else { err = T("File is over the 10MB limit."); return }
        err = nil
        file = (name, data)
    }

    private func pill(_ title: String, _ icon: String) -> some View {
        Label(title, systemImage: icon)
            .font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
    }
}

/// The evidence stored on a day, or its amber "No evidence attached" mark when a change that asked for it
/// was saved without (owner 20 Oct 2026). Nothing when neither. Web: OverrideEvidenceView.
struct OverrideEvidenceView: View {
    let url: String?
    let name: String?
    let missing: Bool?
    /// The request type (SICK / PERMIT) a photo is labelled by, or nil for the label below.
    var type: String? = nil
    var label: String? = nil

    var body: some View {
        if let url, AttendanceRow.fileURL(url) != nil {
            RequestAttachmentView(path: url, name: name, type: type, large: true, label: label)
        } else if missing == true {
            Label(T("No evidence attached"), systemImage: "exclamationmark.triangle.fill")
                .font(NXFont.text(12, .semibold)).foregroundStyle(ChipTone.warning.fg)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(ChipTone.warning.bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}
