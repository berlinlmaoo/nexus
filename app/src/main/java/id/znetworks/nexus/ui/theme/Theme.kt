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
    /**
     * Brand FILL for decoration only: bars, dots, large shapes. White text on it is 4.15:1 (light) —
     * NOT AA for normal text; buttons and links use the M3 primary role, which is [violetText] (audit 2 #2).
     */
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
    /** Brand navy (Calendar, Bagan): selection, today. Light navy on dark surfaces, as the Bagan does. */
    val navy: Color = Color(0xFF1E3A5F),
    /** Text and icons on [navy]. */
    val onNavy: Color = Color.White,
    /** [danger] as TEXT: AA (≥ 4.5:1) on cards and tints. Keep [danger] for bars, dots and fills. */
    val dangerText: Color = Color(0xFFB91C1C),
    /** Notice banners (read-only, warnings): container and its text. */
    val warningBg: Color = Color(0xFFFFF7E0),
    val warningFg: Color = Color(0xFF8A5A00),
    /** Ink on [success] fills (the done tick). */
    val onSuccess: Color = Color.White,
    /** Text and icons on [dangerText] used as a fill (the M3 error role: badges). */
    val onDanger: Color = Color.White,
    /** Important boundaries (M3 outline): text fields, switch handles, segmented borders — ≥ 3:1. [border] stays for dividers. */
    val boundary: Color = Color(0xFF737C89),
    /** The selected segment's container: visibly apart from the surface, with the check and a [violetText] border. */
    val segmentActive: Color = Color(0xFFE2DBFF),
    /** Dark ink for text on light fills (pastel division colours, avatars). */
    val inkOnLight: Color = Color(0xFF0F1B2D),
)

val NxLight = NxColors(
    background = Color(0xFFF8F9FB), card = Color(0xFFFFFFFF), foreground = Color(0xFF292D34),
    mutedFg = Color(0xFF656D76), muted = Color(0xFFF1F3F6), border = Color(0xFFE6E8EC),
    onyx = Color(0xFF202023), violet = Color(0xFF7B68EE), violetText = Color(0xFF6247D6),
    blue = Color(0xFF0091FF), success = Color(0xFF16A34A), warning = Color(0xFFF59E0B),
    danger = Color(0xFFEF4444), accentBg = Color(0xFFF1EEFE), accentFg = Color(0xFF6750CF),
    coral = Color(0xFFFF7F50), cream = Color(0xFFFDFCFB),
    navy = Color(0xFF1E3A5F), onNavy = Color.White, dangerText = Color(0xFFB91C1C),
    warningBg = Color(0xFFFFF7E0), warningFg = Color(0xFF8A5A00), onSuccess = Color.White,
    onDanger = Color.White, boundary = Color(0xFF737C89), segmentActive = Color(0xFFE2DBFF), inkOnLight = Color(0xFF0F1B2D),
)

val NxDark = NxColors(
    background = Color(0xFF0D1017), card = Color(0xFF1C2130), foreground = Color(0xFFE8EAEF),
    mutedFg = Color(0xFFA6B0BD), muted = Color(0xFF252C3D), border = Color(0xFF333B52),
    onyx = Color(0xFFE8EAEF), violet = Color(0xFF6F5AE6), violetText = Color(0xFFB3A6FF),
    blue = Color(0xFF38A3FF), success = Color(0xFF34D399), warning = Color(0xFFFBBF24),
    danger = Color(0xFFF87171), accentBg = Color(0xFF2C2551), accentFg = Color(0xFFBFB3FF),
    coral = Color(0xFFFF9D76), cream = Color(0xFF0D1017),
    navy = Color(0xFF9FB6D6), onNavy = Color(0xFF0F1B2D), dangerText = Color(0xFFF87171),
    warningBg = Color(0xFF3A2E10), warningFg = Color(0xFFFBBF24), onSuccess = Color(0xFF0D1017),
    onDanger = Color(0xFF0D1017), boundary = Color(0xFF7D8599), segmentActive = Color(0xFF3D3375), inkOnLight = Color(0xFF0F1B2D),
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
            // The dev web's --primary (13 Oct 2026 redesign): buttons, checks and switches in the light ink, never
            // violet; violet stays the brand accent ([NxColors.violetText] / accent roles).
            primary = nx.onyx, onPrimary = nx.background, background = nx.background, onBackground = nx.foreground,
            surface = nx.card, onSurface = nx.foreground, surfaceVariant = nx.muted, onSurfaceVariant = nx.mutedFg,
            outline = nx.boundary, error = nx.dangerText, onError = nx.onDanger, secondaryContainer = nx.accentBg, onSecondaryContainer = nx.accentFg,
            // The tiers M3 components draw on (dialogs, menus, the pull-to-refresh disc, switch tracks):
            // NEXUS greys, not the baseline purple.
            primaryContainer = nx.accentBg, onPrimaryContainer = nx.accentFg, inverseSurface = nx.onyx, inverseOnSurface = nx.card,
            surfaceContainerLowest = nx.background, surfaceContainerLow = Color(0xFF151A26), surfaceContainer = nx.card,
            surfaceContainerHigh = Color(0xFF222838), surfaceContainerHighest = nx.muted, outlineVariant = nx.border,
        )
    } else {
        lightColorScheme(
            primary = nx.onyx, onPrimary = Color.White, background = nx.background, onBackground = nx.foreground,
            surface = nx.card, onSurface = nx.foreground, surfaceVariant = nx.muted, onSurfaceVariant = nx.mutedFg,
            outline = nx.boundary, error = nx.dangerText, onError = nx.onDanger, secondaryContainer = nx.accentBg, onSecondaryContainer = nx.accentFg,
            primaryContainer = nx.accentBg, onPrimaryContainer = nx.accentFg, inverseSurface = nx.onyx, inverseOnSurface = nx.card,
            surfaceContainerLowest = nx.card, surfaceContainerLow = nx.background, surfaceContainer = Color(0xFFF4F5F8),
            surfaceContainerHigh = nx.muted, surfaceContainerHighest = Color(0xFFE9EBEF), outlineVariant = nx.border,
        )
    }
    CompositionLocalProvider(LocalNx provides nx) {
        MaterialTheme(colorScheme = scheme, typography = NexusTypography, content = content)
    }
}
