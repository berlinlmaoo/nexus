package id.znetworks.nexus.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R

/** The real web fonts, bundled as variable TTFs (same files as iOS `Sources/Fonts`). */
@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, vararg weights: FontWeight) = FontFamily(
    weights.map { w -> Font(res, w, variationSettings = FontVariation.Settings(FontVariation.weight(w.weight))) },
)

private val allWeights = arrayOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold, FontWeight.ExtraBold)

/** Plus Jakarta Sans: display type (titles, CTAs). */
val DisplayFont = variable(R.font.plus_jakarta_sans, *allWeights)

/** Inter: body type. */
val TextFont = variable(R.font.inter, *allWeights)

val NexusTypography = Typography().run {
    copy(
        displayLarge = displayLarge.copy(letterSpacing = 0.sp, fontFamily = DisplayFont),
        displayMedium = displayMedium.copy(letterSpacing = 0.sp, fontFamily = DisplayFont),
        displaySmall = displaySmall.copy(letterSpacing = 0.sp, fontFamily = DisplayFont),
        headlineLarge = headlineLarge.copy(letterSpacing = 0.sp, fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        headlineMedium = headlineMedium.copy(letterSpacing = 0.sp, fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        headlineSmall = headlineSmall.copy(letterSpacing = 0.sp, fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        titleLarge = titleLarge.copy(letterSpacing = 0.sp, fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        titleMedium = titleMedium.copy(letterSpacing = 0.sp, fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        titleSmall = titleSmall.copy(letterSpacing = 0.sp, fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        // Body ~15–16 sp like the dev web's 16 px root (redesign, 13 Oct 2026); Material's 14 sp read small.
        bodyLarge = bodyLarge.copy(letterSpacing = 0.sp, fontFamily = TextFont, fontSize = 16.sp, lineHeight = 23.sp),
        bodyMedium = bodyMedium.copy(letterSpacing = 0.sp, fontFamily = TextFont, fontSize = 15.sp, lineHeight = 21.sp),
        bodySmall = bodySmall.copy(letterSpacing = 0.sp, fontFamily = TextFont),
        labelLarge = labelLarge.copy(letterSpacing = 0.sp, fontFamily = TextFont, fontWeight = FontWeight.SemiBold),
        labelMedium = labelMedium.copy(letterSpacing = 0.sp, fontFamily = TextFont, fontWeight = FontWeight.SemiBold),
        labelSmall = labelSmall.copy(letterSpacing = 0.sp, fontFamily = TextFont, fontWeight = FontWeight.Bold),
    )
}

/** Uppercase tracked field label ("ACCESS ID (EMAIL)"). */
val FieldLabelStyle = TextStyle(fontFamily = TextFont, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp)
