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
        displayLarge = displayLarge.copy(fontFamily = DisplayFont),
        displayMedium = displayMedium.copy(fontFamily = DisplayFont),
        displaySmall = displaySmall.copy(fontFamily = DisplayFont),
        headlineLarge = headlineLarge.copy(fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        headlineMedium = headlineMedium.copy(fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        headlineSmall = headlineSmall.copy(fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        titleLarge = titleLarge.copy(fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        titleMedium = titleMedium.copy(fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        titleSmall = titleSmall.copy(fontFamily = DisplayFont, fontWeight = FontWeight.Bold),
        bodyLarge = bodyLarge.copy(fontFamily = TextFont),
        bodyMedium = bodyMedium.copy(fontFamily = TextFont),
        bodySmall = bodySmall.copy(fontFamily = TextFont),
        labelLarge = labelLarge.copy(fontFamily = TextFont, fontWeight = FontWeight.SemiBold),
        labelMedium = labelMedium.copy(fontFamily = TextFont, fontWeight = FontWeight.SemiBold),
        labelSmall = labelSmall.copy(fontFamily = TextFont, fontWeight = FontWeight.Bold),
    )
}

/** Uppercase tracked field label ("ACCESS ID (EMAIL)"). */
val FieldLabelStyle = TextStyle(fontFamily = TextFont, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp)
