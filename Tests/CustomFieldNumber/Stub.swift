// Stand-in for the app's AppLanguage so the number rules compile on Linux.
import Foundation
enum AppLang { case en, id }
final class AppLanguage { static let shared = AppLanguage(); var lang: AppLang = .en }
