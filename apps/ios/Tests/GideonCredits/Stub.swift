import Foundation
enum TestLanguage { case en, id }
final class AppLanguage {
    static let shared = AppLanguage()
    var lang = TestLanguage.en
}
