package id.znetworks.nexus.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * NEXUS semantic palette, ported value-for-value from iOS `Theme.swift` (which ports the web's
 * styles.css). Names match the web tokens so a design change can be traced across all three.
 */
@Immutable
data class NxColors(
    val background: Color,
    val card: Color,
    val foreground: Color,
    val mutedFg: Color,
    val muted: Color,
    val border: Color,
    val onyx: Color,
    /** Brand FILL: buttons, selected pills, bars. White text on it clears AA. */
    val violet: Color,
    /** Brand as TEXT or ICON on a surface. Never use [violet] for type. */
    val violetText: Color,
    val blue: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val accentBg: Color,
    val accentFg: Color,
    val coral: Color,
    val cream: Color,
)

val NxLight = NxColors(
    background = Color(0xFFF8F9FB), card = Color(0xFFFFFFFF), foreground = Color(0xFF292D34),
    mutedFg = Color(0xFF656D76), muted = Color(0xFFF1F3F6), border = Color(0xFFE6E8EC),
    onyx = Color(0xFF202023), violet = Color(0xFF7B68EE), violetText = Color(0xFF6247D6),
    blue = Color(0xFF0091FF), success = Color(0xFF16A34A), warning = Color(0xFFF59E0B),
    danger = Color(0xFFEF4444), accentBg = Color(0xFFF1EEFE), accentFg = Color(0xFF6750CF),
    coral = Color(0xFFFF7F50), cream = Color(0xFFFDFCFB),
)

val NxDark = NxColors(
    background = Color(0xFF0D1017), card = Color(0xFF1C2130), foreground = Color(0xFFE8EAEF),
    mutedFg = Color(0xFFA6B0BD), muted = Color(0xFF252C3D), border = Color(0xFF333B52),
    onyx = Color(0xFFE8EAEF), violet = Color(0xFF6F5AE6), violetText = Color(0xFFB3A6FF),
    blue = Color(0xFF38A3FF), success = Color(0xFF34D399), warning = Color(0xFFFBBF24),
    danger = Color(0xFFF87171), accentBg = Color(0xFF2C2551), accentFg = Color(0xFFBFB3FF),
    coral = Color(0xFFFF9D76), cream = Color(0xFF0D1017),
)

val LocalNx = staticCompositionLocalOf { NxLight }

/** Shorthand for the palette inside composables: `Nx.colors.violet`. */
object Nx {
    val colors: NxColors @Composable get() = LocalNx.current
}

enum class AppTheme { SYSTEM, LIGHT, DARK }

@Composable
fun NexusTheme(theme: AppTheme = AppTheme.SYSTEM, content: @Composable () -> Unit) {
    val dark = when (theme) {
        AppTheme.SYSTEM -> isSystemInDarkTheme()
        AppTheme.LIGHT -> false
        AppTheme.DARK -> true
    }
    NexusThemeOf(if (dark) NxDark else NxLight, dark, content)
}

/** Forces the light palette: the login screen is light-only, as on web and iOS. */
@Composable
fun NexusLightTheme(content: @Composable () -> Unit) = NexusThemeOf(NxLight, dark = false, content)

@Composable
private fun NexusThemeOf(nx: NxColors, dark: Boolean, content: @Composable () -> Unit) {
    val scheme = if (dark) {
        darkColorScheme(
            primary = nx.violet, onPrimary = Color.White, background = nx.background, onBackground = nx.foreground,
            surface = nx.card, onSurface = nx.foreground, surfaceVariant = nx.muted, onSurfaceVariant = nx.mutedFg,
            outline = nx.border, error = nx.danger, secondaryContainer = nx.accentBg, onSecondaryContainer = nx.accentFg,
        )
    } else {
        lightColorScheme(
            primary = nx.violet, onPrimary = Color.White, background = nx.background, onBackground = nx.foreground,
            surface = nx.card, onSurface = nx.foreground, surfaceVariant = nx.muted, onSurfaceVariant = nx.mutedFg,
            outline = nx.border, error = nx.danger, secondaryContainer = nx.accentBg, onSecondaryContainer = nx.accentFg,
        )
    }
    CompositionLocalProvider(LocalNx provides nx) {
        MaterialTheme(colorScheme = scheme, typography = NexusTypography, content = content)
    }
}
