package id.znetworks.nexus.ui.shell

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Assignment
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.AssignmentTurnedIn
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Assessment
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.ConfirmationNumber
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Balance
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.NewReleases
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.Badges
import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.rememberIsCompany
import id.znetworks.nexus.ui.theme.AppTheme
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont

/** Calm outline icons in one muted colour, as the web sidebar (lucide) and iOS. */
internal fun ShellNav.Item.icon(): ImageVector = when (this) {
    ShellNav.Item.DASHBOARD -> Icons.Outlined.Dashboard
    ShellNav.Item.MESSAGES -> Icons.AutoMirrored.Outlined.Chat
    ShellNav.Item.GIDEON -> Icons.Outlined.AutoAwesome
    ShellNav.Item.NOTIFICATIONS -> Icons.Outlined.Inbox
    ShellNav.Item.THREADS -> Icons.Outlined.AlternateEmail
    ShellNav.Item.VAULT -> Icons.Outlined.Inventory2
    ShellNav.Item.MY_TASKS -> Icons.Outlined.CheckBox
    ShellNav.Item.SUBMISSIONS -> Icons.Outlined.Description
    ShellNav.Item.CALENDAR -> Icons.Outlined.CalendarMonth
    ShellNav.Item.ROOMS -> Icons.Outlined.EventAvailable
    ShellNav.Item.PROJECTS -> Icons.Outlined.Folder
    ShellNav.Item.LEGAL -> Icons.Outlined.Balance
    ShellNav.Item.LEADERBOARD -> Icons.Outlined.EmojiEvents
    ShellNav.Item.REPORTS -> Icons.Outlined.Assessment
    ShellNav.Item.FORMS -> Icons.AutoMirrored.Outlined.Assignment
    ShellNav.Item.ATTENDANCE -> Icons.Outlined.AssignmentTurnedIn
    ShellNav.Item.TICKETS -> Icons.Outlined.ConfirmationNumber
    ShellNav.Item.SETTINGS -> Icons.Outlined.Settings
    ShellNav.Item.WHATS_NEW -> Icons.Outlined.NewReleases
    ShellNav.Item.CONTROL_ROOM -> Icons.Outlined.Shield
}

/** What the menus need from the shell: the groups this person sees and the live counts. */
private class MenuState(val groups: List<Pair<ShellNav.Group, List<ShellNav.Item>>>, val badge: (ShellNav.Item) -> String?)

@Composable
private fun rememberMenuState(): MenuState {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val company = rememberIsCompany()
    val calendarOn = container.remoteConfig.body.collectAsStateWithLifecycle().value.calendar
    val inboxUnread by container.badges.inboxUnread.collectAsStateWithLifecycle()
    val chatUnread by container.badges.chatUnread.collectAsStateWithLifecycle()
    // Control Room is drawn for MANAGER and above only (the server re-checks every call).
    val canAdmin by produceState(container.viewer.canAdminister) { container.viewer.load(); value = container.viewer.canAdminister }
    // Legal is drawn only for the people invited to it (the server refuses everyone else).
    val legal by produceState(container.viewer.canAccessLegal) { container.viewer.load(); value = container.viewer.canAccessLegal }
    return MenuState(ShellNav.groups(company, canAdmin, calendarOn, legal)) { item ->
        when (item.badge) {
            ShellNav.Badge.INBOX -> Badges.label(inboxUnread)
            ShellNav.Badge.CHAT -> Badges.label(chatUnread)
            ShellNav.Badge.NONE -> null
        }
    }
}

/** The person's photo: the session stores none, the profile has it. */
@Composable
private fun rememberAvatar(): String? {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val avatar by produceState<String?>(null) {
        value = runCatching { id.znetworks.nexus.feature.auth.ProfileApi(container.api).profile().avatar }.getOrNull()
    }
    return avatar
}

@Composable
private fun isDarkNow(): Boolean {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val theme by container.appearance.theme.collectAsStateWithLifecycle()
    val system = isSystemInDarkTheme()
    return theme == AppTheme.DARK || (theme == AppTheme.SYSTEM && system)
}

@Composable
private fun isIndonesian(): Boolean =
    id.znetworks.nexus.core.config.ConfigBody.lang(LocalConfiguration.current.locales[0]) == "id"

/**
 * More (phone): the web's More sheet as a page — search, the four groups as plain rows, then the profile
 * card, theme, language and Log out. Tabs that are already in the bottom bar are left out here.
 */
@Composable
internal fun MoreScreen(session: Session, onLogout: () -> Unit, onItem: (ShellNav.Item) -> Unit, onSearch: () -> Unit, tabs: Set<String>) {
    val c = Nx.colors
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val menu = rememberMenuState()
    val dark = isDarkNow()
    val indonesian = isIndonesian()
    val avatar = rememberAvatar()
    Column(Modifier.fillMaxSize().background(c.background)) {
        PageHeader(stringResource(R.string.more_title), subtitle = stringResource(R.string.nav_more_subtitle))
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 12.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            SearchRow(onSearch)
            menu.groups.forEach { (group, items) ->
                val shown = items.filter { it.route !in tabs }
                if (shown.isNotEmpty()) Column {
                    GroupLabel(stringResource(group.label))
                    shown.forEach { item -> NavRow(item, selected = false, badge = menu.badge(item)) { onItem(item) } }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val name = session.userName.ifBlank { session.userEmail }
                FooterCard(onClick = { onItem(ShellNav.Item.SETTINGS) }) {
                    Avatar(name, avatar, size = 36.dp, userId = session.userId)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(session.userEmail, fontSize = 13.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Icon(Icons.Outlined.Settings, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
                }
                // Own status entry under the identity card, like the web More sheet on phones (presence spec).
                id.znetworks.nexus.feature.presence.SetStatusEntry(card = true)
                FooterCard(onClick = { container.appearance.set(if (dark) AppTheme.LIGHT else AppTheme.DARK) }) {
                    Icon(if (dark) Icons.Outlined.LightMode else Icons.Outlined.DarkMode, null, tint = c.foreground, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(if (dark) R.string.nav_light_mode else R.string.nav_dark_mode), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.foreground)
                }
                FooterCard(onClick = { AppLanguage.choose(context, if (indonesian) AppLanguage.ENGLISH else AppLanguage.INDONESIAN) }) {
                    Icon(Icons.Outlined.Translate, null, tint = c.foreground, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.nav_language), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.foreground, modifier = Modifier.weight(1f))
                    Text(stringResource(R.string.nav_language_value), fontSize = 13.sp, color = c.mutedFg)
                }
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.danger.copy(alpha = 0.1f))
                    .border(1.dp, c.danger.copy(alpha = 0.3f), RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = onLogout)
                    .defaultMinSize(minHeight = 48.dp).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Outlined.Logout, null, tint = c.dangerText, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.nav_log_out), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText)
                }
            }
        }
    }
}

/**
 * The sidebar on wide screens (≥ 840 dp; web AppSidebar): logo + NEXUS / Phaëthon, search, the four groups
 * with the current page marked, and the footer (avatar, theme, EN/ID, log out).
 */
@Composable
internal fun ShellSidebar(session: Session, current: ShellNav.Item?, onItem: (ShellNav.Item) -> Unit, onSearch: () -> Unit, onLogout: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val menu = rememberMenuState()
    val dark = isDarkNow()
    val indonesian = isIndonesian()
    val avatar = rememberAvatar()
    Row(Modifier.fillMaxHeight()) {
        Column(Modifier.width(256.dp).fillMaxHeight().background(c.card)) {
            Row(Modifier.fillMaxWidth().clickable { onItem(ShellNav.Item.DASHBOARD) }.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.nexus_mark), null, modifier = Modifier.size(30.dp))
                Spacer(Modifier.width(10.dp))
                Column {
                    Text("NEXUS", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    Text("Phaëthon", fontSize = 11.sp, color = c.mutedFg)
                }
            }
            Box(Modifier.padding(horizontal = 10.dp, vertical = 4.dp)) { SearchRow(onSearch, compact = true) }
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp)) {
                menu.groups.forEach { (group, items) ->
                    GroupLabel(stringResource(group.label))
                    items.forEach { item -> NavRow(item, selected = item == current, badge = menu.badge(item), dense = true) { onItem(item) } }
                    Spacer(Modifier.height(6.dp))
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                val name = session.userName.ifBlank { session.userEmail }
                Row(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).clickable { onItem(ShellNav.Item.SETTINGS) }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(name, avatar, size = 28.dp, userId = session.userId)
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(name, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(session.userEmail, fontSize = 10.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                FooterIcon(if (dark) Icons.Outlined.LightMode else Icons.Outlined.DarkMode, stringResource(if (dark) R.string.nav_light_mode else R.string.nav_dark_mode)) {
                    container.appearance.set(if (dark) AppTheme.LIGHT else AppTheme.DARK)
                }
                Box(Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button, onClickLabel = stringResource(R.string.nav_language)) {
                    AppLanguage.choose(context, if (indonesian) AppLanguage.ENGLISH else AppLanguage.INDONESIAN)
                }.defaultMinSize(minWidth = 36.dp, minHeight = 36.dp), contentAlignment = Alignment.Center) {
                    Text(if (indonesian) "ID" else "EN", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                }
                FooterIcon(Icons.AutoMirrored.Outlined.Logout, stringResource(R.string.nav_log_out), onLogout)
            }
        }
        Box(Modifier.width(1.dp).fillMaxHeight().background(c.border))
    }
}

@Composable
private fun FooterIcon(icon: ImageVector, label: String, onClick: () -> Unit) {
    Box(Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button, onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = Nx.colors.mutedFg, modifier = Modifier.size(18.dp))
    }
}

/** The search entry (web "Search… ⌘K" / More sheet's search row): opens the app's search. */
@Composable
private fun SearchRow(onClick: () -> Unit, compact: Boolean = false) {
    val c = Nx.colors
    val shape = RoundedCornerShape(if (compact) 8.dp else 12.dp)
    Row(Modifier.fillMaxWidth().clip(shape).background(c.background).border(1.dp, c.border, shape).clickable(role = Role.Button, onClick = onClick)
        .defaultMinSize(minHeight = if (compact) 36.dp else 46.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Search, null, tint = c.mutedFg, modifier = Modifier.size(if (compact) 15.dp else 18.dp))
        Spacer(Modifier.width(10.dp))
        Text(stringResource(if (compact) R.string.search else R.string.nav_search), fontFamily = TextFont, fontSize = if (compact) 13.sp else 15.sp, color = c.mutedFg,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A group's label: small, muted, sentence case (web SidebarGroupLabel). */
@Composable
private fun GroupLabel(text: String) {
    Text(text, fontFamily = TextFont, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Nx.colors.mutedFg,
        modifier = Modifier.padding(start = 10.dp, top = 6.dp, bottom = 4.dp))
}

/** One destination: outline icon, label, live count; the current page gets the soft accent fill. */
@Composable
private fun NavRow(item: ShellNav.Item, selected: Boolean, badge: String?, dense: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    val fg = if (selected) c.accentFg else c.foreground
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (selected) c.accentBg else c.background.copy(alpha = 0f))
        .clickable(role = Role.Button, onClick = onClick).semantics { this.selected = selected }
        .defaultMinSize(minHeight = if (dense) 40.dp else 48.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        val tint = if (selected) c.accentFg else c.mutedFg
        val sz = if (dense) 18.dp else 20.dp
        if (item == ShellNav.Item.GIDEON) id.znetworks.nexus.ui.components.GideonMark(sz, tint) else Icon(item.icon(), null, tint = tint, modifier = Modifier.size(sz))
        Spacer(Modifier.width(12.dp))
        Text(stringResource(item.label), fontFamily = TextFont, fontSize = if (dense) 14.sp else 15.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal, color = fg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (badge != null) {
            Box(Modifier.defaultMinSize(minWidth = 20.dp).background(c.dangerText, CircleShape).padding(horizontal = 6.dp, vertical = 1.dp), contentAlignment = Alignment.Center) {
                Text(badge, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.onDanger)
            }
        }
    }
}

@Composable
private fun FooterCard(onClick: () -> Unit, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    Row(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).clickable(role = Role.Button, onClick = onClick)
        .defaultMinSize(minHeight = 52.dp).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, content = content)
}
