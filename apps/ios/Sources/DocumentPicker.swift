import SwiftUI
import UniformTypeIdentifiers

/// The Files picker, presented like every other picker in this app: a controller inside a `.sheet`.
///
/// `.fileImporter` is a modifier with its own presentation machinery, and it has a history of
/// quietly not presenting when the view lives inside another sheet on iPad and Mac — which is
/// exactly where a form opened from a link lives. A `UIDocumentPickerViewController` in a sheet is
/// what the camera and the photo library already are here, and it behaves the same on iPhone,
/// iPad and Mac. iOS imports a private copy. Catalyst opens in place and snapshots the selection
/// while its file grant is held, so callers can read it asynchronously after the picker closes.
struct DocumentPicker: UIViewControllerRepresentable {
    var types: [UTType]
    var multiple: Bool
    var onPick: ([URL]) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        #if targetEnvironment(macCatalyst)
        let vc = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
        #else
        let vc = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        #endif
        vc.allowsMultipleSelection = multiple
        vc.delegate = context.coordinator
        return vc
    }
    func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let parent: DocumentPicker
        init(_ parent: DocumentPicker) { self.parent = parent }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            #if targetEnvironment(macCatalyst)
            // Catalyst opens in place; hand callers private snapshots just as import-as-copy
            // does on iOS, so their asynchronous reads outlive the picker and its file grant.
            let copies = urls.map { source -> URL in
                let scoped = source.startAccessingSecurityScopedResource()
                defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                do {
                    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let copy = folder.appendingPathComponent(source.lastPathComponent)
                    var coordinationError: NSError?
                    var copyError: Error?
                    NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { readable in
                        do { try FileManager.default.copyItem(at: readable, to: copy) }
                        catch { copyError = error }
                    }
                    if let error = coordinationError { throw error }
                    if let error = copyError { throw error }
                    return copy
                } catch {
                    return source // The caller retains its existing read-error presentation.
                }
            }
            parent.onPick(copies)
            #else
            parent.onPick(urls)
            #endif
            parent.dismiss()
        }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            parent.dismiss()
        }
    }
}
