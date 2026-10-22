package id.znetworks.nexus.ui.components

import androidx.compose.material.icons.filled.Search
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.clickable
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont

/*
 * The dev web's page chrome (components/PageHeader.tsx, PageLayout.tsx, ui/button.tsx; iOS NXPageChrome.swift),
 * adapted to a phone: a large left-aligned title with a muted subtitle (two lines at most), the page's actions
 * at the right as bordered buttons with the primary one near-black (web --primary, never violet), optional
 * underline tabs, and a hairline under the whole header. A pushed screen gets the back arrow before the title;
 * a tab root has none.
 */

/**
 * One page header. [actions] sit at the right of the title on the same row (use [HeaderIconButton] /
 * compact [NxButton]s there); [tabs] go under it, their underline on the header's hairline.
 */
@Composable
fun PageHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    tabs: (@Composable () -> Unit)? = null,
    onTitleClick: (() -> Unit)? = null,
    subtitleMaxLines: Int = 2,
    subtitleContent: (@Composable () -> Unit)? = null,
    titleContent: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val c = Nx.colors
    Column(modifier.fillMaxWidth().background(c.background)) {
        Row(
            Modifier.fillMaxWidth().padding(start = if (onBack != null) 4.dp else 16.dp, end = 12.dp, top = 12.dp, bottom = if (tabs != null) 6.dp else 12.dp),
            // Top-aligned: the back arrow and the actions sit level with the title, not mid-subtitle.
            verticalAlignment = Alignment.Top,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = c.foreground) }
            }
            if (leading != null) {
                Box(Modifier.padding(top = 6.dp)) { leading() }
                Spacer(Modifier.width(10.dp))
            }
            Column(Modifier.weight(1f).padding(top = if (onBack != null) 10.dp else 4.dp)) {
                if (titleContent != null) Box(Modifier.semantics { heading() }.then(if (onTitleClick != null) Modifier.clickable(onClick = onTitleClick) else Modifier)) {
                    titleContent()
                } else Text(
                    title, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp,
                    letterSpacing = (-0.2).sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() }.then(if (onTitleClick != null) Modifier.clickable(onClick = onTitleClick) else Modifier),
                )
                if (subtitleContent != null) subtitleContent()
                else if (!subtitle.isNullOrBlank()) {
                    Text(subtitle, fontFamily = TextFont, fontSize = 14.sp, lineHeight = 19.sp, color = c.mutedFg, maxLines = subtitleMaxLines,
                        overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
                }
            }
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
        }
        if (tabs != null) Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) { tabs() }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
    }
}

/** The web's button kinds: near-black primary, outlined on the card, text only, red. */
enum class NxButtonKind { PRIMARY, BORDERED, GHOST, DESTRUCTIVE }

/** A web-style button (rounded 8, 14 sp medium; 44 dp touch height, 36 dp when [compact]). */
@Composable
fun NxButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: NxButtonKind = NxButtonKind.BORDERED,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    compact: Boolean = false,
) {
    val c = Nx.colors
    val shape = RoundedCornerShape(8.dp)
    val pad = PaddingValues(horizontal = if (compact) 10.dp else 14.dp, vertical = 0.dp)
    val min = Modifier.defaultMinSize(minHeight = if (compact) 36.dp else 44.dp)
    val content: @Composable RowScope.() -> Unit = {
        if (icon != null) {
            Icon(icon, null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, fontFamily = TextFont, fontWeight = FontWeight.Medium, fontSize = if (compact) 13.sp else 14.sp, maxLines = 1)
    }
    when (kind) {
        NxButtonKind.PRIMARY -> Button(onClick, modifier.then(min), enabled = enabled, shape = shape, contentPadding = pad,
            colors = ButtonDefaults.buttonColors(containerColor = c.onyx, contentColor = c.background,
                disabledContainerColor = c.onyx.copy(alpha = 0.5f), disabledContentColor = c.background), content = content)
        NxButtonKind.DESTRUCTIVE -> Button(onClick, modifier.then(min), enabled = enabled, shape = shape, contentPadding = pad,
            colors = ButtonDefaults.buttonColors(containerColor = c.dangerText, contentColor = c.onDanger,
                disabledContainerColor = c.dangerText.copy(alpha = 0.5f), disabledContentColor = c.onDanger), content = content)
        NxButtonKind.BORDERED -> NxOutlinedButton(onClick, modifier.then(min), enabled = enabled, shape = shape, contentPadding = pad,
            border = BorderStroke(1.dp, c.border),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = c.card, contentColor = c.foreground,
                disabledContentColor = c.foreground.copy(alpha = 0.5f)), content = content)
        NxButtonKind.GHOST -> TextButton(onClick, modifier.then(min), enabled = enabled, shape = shape, contentPadding = pad,
            colors = ButtonDefaults.textButtonColors(contentColor = c.foreground), content = content)
    }
}

/**
 * An icon-only header action: a 40 dp bordered square (web `size="icon" variant="outline"`), [primary] = the
 * near-black fill. [badge] shows a count in the corner.
 */
@Composable
fun HeaderIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    primary: Boolean = false,
    badge: String? = null,
    enabled: Boolean = true,
    size: androidx.compose.ui.unit.Dp = 40.dp,
    /** Drawn instead of [icon] when set (the GIDEON mark is a picture, not a vector). */
    painter: androidx.compose.ui.graphics.painter.Painter? = null,
) {
    val c = Nx.colors
    val shape = RoundedCornerShape(8.dp)
    Box {
        Box(
            Modifier.size(size.coerceAtLeast(48.dp)).clip(shape)
                .background(if (primary) c.onyx else c.card)
                .then(if (primary) Modifier else Modifier.border(1.dp, c.border, shape))
                .clickable(enabled = enabled, role = Role.Button, onClickLabel = contentDescription, onClick = onClick)
                .semantics { this.contentDescription = contentDescription },
            contentAlignment = Alignment.Center,
        ) {
            val tint = (if (primary) c.background else c.foreground).copy(alpha = if (enabled) 1f else 0.5f)
            if (painter != null) Icon(painter, null, tint = tint, modifier = Modifier.size(19.dp)) else Icon(icon, null, tint = tint, modifier = Modifier.size(19.dp))
        }
        if (badge != null) {
            Box(Modifier.align(Alignment.TopEnd).defaultMinSize(minWidth = 16.dp, minHeight = 16.dp)
                .background(c.dangerText, CircleShape).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
                Text(badge, color = c.onDanger, fontSize = 9.sp, fontWeight = FontWeight.Bold, lineHeight = 12.sp)
            }
        }
    }
}

/** One page tab: [count] null hides it, 0 is shown; [attention] tints a non-zero count amber. */
data class PageTab<K>(val key: K, val label: String, val count: Int? = null, val attention: Boolean = false, val icon: ImageVector? = null)

/**
 * The web's PageTabs: a light underline row (14 sp medium; selected = foreground with a 2 dp underline,
 * others muted), scrolling sideways when it does not fit. Lives in [PageHeader]'s `tabs` slot.
 */
@Composable
fun <K> PageTabs(tabs: List<PageTab<K>>, value: K, onChange: (K) -> Unit, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val scroll = rememberScrollState()
    Row(modifier.fillMaxWidth().drawWithContent {
        drawContent()
        val edge = 24.dp.toPx()
        if (scroll.canScrollForward) drawRect(androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(androidx.compose.ui.graphics.Color.Transparent, c.background), startX = size.width - edge), topLeft = androidx.compose.ui.geometry.Offset(size.width - edge, 0f), size = androidx.compose.ui.geometry.Size(edge, size.height))
        if (scroll.canScrollBackward) drawRect(androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(c.background, androidx.compose.ui.graphics.Color.Transparent), endX = edge), size = androidx.compose.ui.geometry.Size(edge, size.height))
    }.horizontalScroll(scroll).padding(end = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        tabs.forEach { t ->
            val on = t.key == value
            val selectedTab = remember(t.key) { BringIntoViewRequester() }
            LaunchedEffect(on) { if (on) { androidx.compose.runtime.withFrameNanos { }; selectedTab.bringIntoView() } }
            Column(
                Modifier.width(IntrinsicSize.Max).bringIntoViewRequester(selectedTab).clickable(role = Role.Tab) { onChange(t.key) }.semantics { selected = on }.defaultMinSize(minHeight = 44.dp),
                verticalArrangement = Arrangement.Bottom,
            ) {
                Row(Modifier.padding(top = 8.dp, bottom = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (t.icon != null) {
                        Icon(t.icon, null, tint = if (on) c.foreground else c.mutedFg, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(t.label, fontFamily = TextFont, fontWeight = FontWeight.Medium, fontSize = 14.sp, color = if (on) c.foreground else c.mutedFg, maxLines = 1)
                    if (t.count != null) {
                        Spacer(Modifier.width(6.dp))
                        val hot = t.attention && t.count > 0
                        Box(Modifier.defaultMinSize(minWidth = 20.dp).background(if (hot) c.warningBg else c.muted, CircleShape).padding(horizontal = 6.dp),
                            contentAlignment = Alignment.Center) {
                            Text("${t.count}", fontSize = 11.sp, fontWeight = FontWeight.Medium, lineHeight = 18.sp, color = if (hot) c.warningFg else c.mutedFg)
                        }
                    }
                }
                Box(Modifier.fillMaxWidth().height(2.dp).background(if (on) c.foreground else c.background))
            }
        }
    }
}

/**
 * The web's Segmented: switches how ONE block shows. A muted track with the selected option as a raised
 * card chip, never a black pill.
 */
@Composable
fun <K> Segmented(options: List<Pair<K, String>>, value: K, onChange: (K) -> Unit, modifier: Modifier = Modifier) {
    val c = Nx.colors
    Row(modifier.clip(RoundedCornerShape(10.dp)).background(c.muted).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        options.forEach { (key, label) ->
            val on = key == value
            Box(
                Modifier.clip(RoundedCornerShape(7.dp)).background(if (on) c.card else c.muted)
                    .then(if (on) Modifier.border(1.dp, c.border, RoundedCornerShape(7.dp)) else Modifier)
                    .clickable(role = Role.RadioButton) { onChange(key) }.semantics { selected = on }
                    .defaultMinSize(minHeight = 48.dp).padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, fontFamily = TextFont, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = if (on) c.foreground else c.mutedFg, maxLines = 1)
            }
        }
    }
}

/**
 * A compact search box like the web's input (44 dp, card fill, thin border, a search glyph), for filter rows where a
 * 56 dp Material field takes too much of a phone (owner, 14 Oct 2026). [trailing] shows while there is text.
 */
@Composable
fun CompactSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val c = Nx.colors
    val shape = RoundedCornerShape(22.dp)
    androidx.compose.foundation.text.BasicTextField(
        value, onValueChange, singleLine = true,
        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 15.sp, color = c.foreground),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(c.foreground),
        modifier = modifier.height(44.dp),
        decorationBox = { inner ->
            Row(Modifier.fillMaxSize().clip(shape).background(c.card).border(1.dp, c.border, shape).padding(start = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(androidx.compose.material.icons.Icons.Filled.Search, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) Text(placeholder, fontSize = 15.sp, color = c.mutedFg, maxLines = 1)
                    inner()
                }
                if (value.isNotEmpty() && trailing != null) trailing()
            }
        },
    )
}
