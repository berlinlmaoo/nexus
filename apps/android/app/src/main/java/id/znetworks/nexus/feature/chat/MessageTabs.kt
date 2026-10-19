package id.znetworks.nexus.feature.chat

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

object MessageTabRules {
    val types = listOf("DM", "GROUP", "PROJECT")
    fun unread(rows: List<Conversation>, type: String, nowMs: Long = System.currentTimeMillis()) = rows.filter { it.type == type && !it.muted(nowMs) }.sumOf { it.unreadCount.coerceAtLeast(0) }
    fun restored(type: String?) = types.indexOf(type).coerceAtLeast(0)
}

@Composable
internal fun MessagesPager(s: MessagesState, meId: String?, typing: Set<String>, refresh: () -> Unit, newChat: () -> Unit, open: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("messages-ui", Context.MODE_PRIVATE) }
    val key = "last-tab:" + meId.orEmpty()
    val pager = rememberPagerState(initialPage = MessageTabRules.restored(prefs.getString(key, null)), pageCount = { 3 })
    val scope = rememberCoroutineScope()
    LaunchedEffect(pager.settledPage, key) { prefs.edit().putString(key, MessageTabRules.types[pager.settledPage]).apply() }
    val c = Nx.colors
    Column(modifier) {
        PrimaryTabRow(pager.currentPage, containerColor = c.background, contentColor = c.foreground) {
            listOf(R.string.chat_direct, R.string.chat_groups, R.string.chat_projects).forEachIndexed { index, label ->
                Tab(pager.currentPage == index, onClick = { scope.launch { pager.animateScrollToPage(index) } }, text = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(stringResource(label), fontSize = 13.sp, maxLines = 1)
                        val unread = MessageTabRules.unread(s.conversations, MessageTabRules.types[index])
                        if (unread > 0) Badge { Text(if (unread > 99) "99+" else unread.toString()) }
                    }
                })
            }
        }
        HorizontalPager(pager, Modifier.weight(1f), key = { MessageTabRules.types[it] }) { index ->
            val rows = s.conversations.filter { it.type == MessageTabRules.types[index] }
            when {
                s.loading && s.conversations.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null && s.conversations.isEmpty() -> EmptyState(Icons.Filled.Forum, stringResource(R.string.chat_load_failed), s.error, stringResource(R.string.try_again), refresh, Modifier.fillMaxSize())
                rows.isEmpty() -> EmptyState(Icons.Filled.Forum, stringResource(when (index) { 0 -> R.string.ui_messages_empty_direct; 1 -> R.string.ui_messages_empty_groups; else -> R.string.ui_messages_empty_projects }),
                    stringResource(if (index == 2) R.string.ui_messages_projects_hint else R.string.chat_empty_sub),
                    stringResource(if (index == 2) R.string.try_again else R.string.chat_new), if (index == 2) refresh else newChat, Modifier.fillMaxSize())
                else -> androidx.compose.material3.pulltorefresh.PullToRefreshBox(isRefreshing = false, onRefresh = refresh) {
                    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp), modifier = Modifier.fillMaxSize()) {
                        items(rows, key = { it.id }) { conv -> ConversationRow(conv, meId, conv.id in typing) { open(conv.id) } }
                    }
                }
            }
        }
    }
}
