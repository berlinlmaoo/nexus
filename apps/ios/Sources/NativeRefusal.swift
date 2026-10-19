import Foundation

/// Stable refusal codes shared by the task, document, sheet and Vault routes.
enum NativeRefusal {
    static func message(_ code: String, maxBytes: Int? = nil) -> String? {
        let text: String
        switch code {
        case "TOO_LARGE":
            if let maxBytes, maxBytes > 0 {
                return String(format: T("This file is too large. Maximum size: %@."), AppNumber.bytes(Double(maxBytes)))
            }
            text = "This file is too large. Choose a smaller file."
        case "UNSUPPORTED_TYPE": text = "This file type isn't supported. Choose a picture, PDF, Office document, CSV, TXT or ZIP."
        case "MESSAGE_TOO_LONG": text = "This message is too long. Shorten it or split it into several messages."
        case "ROOMS_NOT_AVAILABLE": text = "The meeting rooms and the studio belong to the Z Networks workspace. Ask an admin to add you to it if you need to book a room."
        case "EMPTY_FILE": text = "This file is empty. Choose another file."
        case "ASSIGNEES_CHANGED": text = "The assignees changed. Check the latest list and try again."
        case "TOO_MANY_TAGS": text = "A task can have at most 20 tags."
        case "REORDER_ANCHOR_GONE": text = "That task moved to another section. The board has been refreshed; try the move again."
        case "DESCRIPTION_CHANGED": text = "The description changed while you were editing. Review the latest version before saving again."
        case "DOC_CHANGED": text = "The document changed while you were editing. Review the latest version before saving again."
        case "FORM_CHANGED": text = "The form changed while you were editing. Review the latest version before saving again."
        case "VAULT_FULL": text = "Your Vault is full. Remove a file before uploading another."
        case "FOLDER_GONE": text = "This folder no longer exists. Choose another folder."
        case "CYCLE": text = "A folder can't be moved inside itself or one of its subfolders."
        case "GONE": text = "This item no longer exists. Refresh the list."
        default: return nil
        }
        return T(text)
    }
}
