import SwiftUI
import UniformTypeIdentifiers

/// The Files picker, presented like every other picker in this app: a controller inside a `.sheet`.
///
/// `.fileImporter` is a modifier with its own presentation machinery, and it has a history of
/// quietly not presenting when the view lives inside another sheet on iPad and Mac — which is
/// exactly where a form opened from a link lives. A `UIDocumentPickerViewController` in a sheet is
/// what the camera and the photo library already are here, and it behaves the same on iPhone,
/// iPad and Mac. `asCopy: true` hands back a private copy, so no security scoping is needed and the
/// file can be read whenever the caller gets to it.
struct DocumentPicker: UIViewControllerRepresentable {
    var types: [UTType]
    var multiple: Bool
    var onPick: ([URL]) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let vc = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
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
            parent.onPick(urls)
            parent.dismiss()
        }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { parent.dismiss() }
    }
}
