import Foundation
func T(_ key: String) -> String {
    AppLanguage.shared.lang == .id ? AppLanguage.indonesianRun21[key] ?? key : key
}
var count = 0
func check(_ condition: Bool) { count += 1; if !condition { fatalError("Refusal contract failed at check \(count)") } }
check(NativeRefusal.message("TOO_LARGE", maxBytes: 25 * 1024 * 1024) == "This file is too large. Maximum size: 25.0 MB.")
check(NativeRefusal.message("TOO_LARGE", maxBytes: 8 * 1024 * 1024)?.contains("8.0 MB") == true)
check(NativeRefusal.message("EMPTY_FILE") == "This file is empty. Choose another file.")
check(NativeRefusal.message("UNSUPPORTED_TYPE")?.contains("PDF") == true)
check(AppNumber.int(1000) == "1.000")
AppLanguage.shared.lang = .id
check(NativeRefusal.message("TOO_LARGE", maxBytes: 25 * 1024 * 1024) == "File ini terlalu besar. Ukuran maksimum: 25,0 MB.")
check(NativeRefusal.message("EMPTY_FILE") == "File ini kosong. Pilih file lain.")
check(NativeRefusal.message("UNSUPPORTED_TYPE")?.hasPrefix("Jenis file") == true)
check(NativeRefusal.message("UNKNOWN") == nil)
print("Native upload refusals and grouped credits: \(count) checks passed")
