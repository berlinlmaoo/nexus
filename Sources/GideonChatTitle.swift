import Foundation

/// A saved GIDEON chat is titled with its first prompt. When that prompt was one of the web's suggestion
/// chips it was saved in the language the person had then; shown in the other language it read wrong (web
/// lib/gideon-chat-title.ts, QA N-07). Known chips show in the app's language; anything typed stays as typed.
enum GideonChatTitle {
    /// English chip text and its Indonesian, as the web's i18n has them.
    private static let chips: [(en: String, id: String)] = [
        ("What's overdue for me?", "Apa saja task-ku yang terlambat?"),
        ("Summarize my week across projects", "Ringkas mingguku di semua project"),
        ("What did my team decide recently? Cite the sources.", "Apa yang baru diputuskan timku? Sebutkan sumbernya."),
        ("Summarize this page", "Ringkas halaman ini"),
        ("Find the action items in this page", "Temukan action item di halaman ini"),
        ("What questions does this page leave open?", "Pertanyaan apa yang belum terjawab di halaman ini?"),
        ("What's the latest on this task?", "Apa kabar terbaru task ini?"),
        ("Break this task into subtasks", "Pecah task ini jadi subtask"),
        ("Draft a status comment for this task", "Buatkan draf komentar status untuk task ini"),
    ]

    static func text(_ title: String?) -> String? {
        guard let title else { return nil }
        let s = title.trimmingCharacters(in: .whitespaces)
        for chip in chips where s == chip.en || s == chip.id {
            return AppLanguage.shared.lang == .id ? chip.id : chip.en
        }
        return title
    }
}
