package id.znetworks.nexus.feature.chat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import id.znetworks.nexus.MainActivity
import id.znetworks.nexus.R

/**
 * A chat push as the server sends it (CHAT-CONTRACT, FCM data-only): `type` MESSAGE / MESSAGE_MENTION,
 * `conversationId`, `messageId`, `link` "/messages?c=<id>", `conversationName`, `senderName`, `title`,
 * `body`, `isGroup`. Older servers send only type/title/body/link: the conversation then comes from the
 * link, the sender from "New message from X". Pure, so it is tested.
 */
data class ChatPush(
    val conversationId: String,
    val messageId: String?,
    val mention: Boolean,
    val isGroup: Boolean,
    val conversationName: String?,
    val senderName: String,
    /** Empty for an image-only message: the notifier says "📷 Foto". */
    val text: String,
    val link: String,
) {
    companion object {
        fun parse(d: Map<String, String?>): ChatPush? {
            val type = d["type"].orEmpty().lowercase()
            if (!type.startsWith("message")) return null
            val link = d["link"].orEmpty()
            val cid = d["conversationId"]?.takeIf { it.isNotBlank() }
                ?: Regex("[?&]c=([^&#]+)").find(link)?.groupValues?.get(1)
                ?: Regex("/messages/([^/?#]+)").find(link)?.groupValues?.get(1)
                ?: return null
            val title = d["title"].orEmpty()
            val group = d["isGroup"]?.let { it == "true" || it == "1" } ?: (d["conversationName"] != null && d["conversationName"] != d["senderName"])
            val sender = d["senderName"]?.takeIf { it.isNotBlank() }
                ?: Regex("^(New message from|Pesan baru dari|New mention from|.* mentioned you)\\s*", RegexOption.IGNORE_CASE).replace(title, "").trim().ifBlank { title }
            // A group push's body is "Sender: text" (CHAT-CONTRACT): the line shows the sender once.
            val body = d["body"].orEmpty().let { b -> if (group && b.startsWith("$sender: ")) b.removePrefix("$sender: ") else b }
            return ChatPush(cid, d["messageId"], type.contains("mention"), group, d["conversationName"], sender, body.trim(),
                link.ifBlank { "/messages?c=$cid" })
        }
    }
}

/** Which conversation is on screen right now (resumed): its pushes are not shown, it is refreshed instead. */
object ChatPresence {
    @Volatile var openConversationId: String? = null
}

/**
 * One notification per conversation (MessagingStyle, CHAT-REPORT P0): its lines pile up in one card, a
 * group summary holds the cards together, mentions go to their own louder channel. Opening the
 * conversation clears its card; logging out clears them all.
 */
object ChatNotifier {
    const val CH_CHAT = "chat"
    const val CH_MENTIONS = "chat_mentions"
    private const val GROUP = "id.znetworks.nexus.CHAT"
    private const val SUMMARY_ID = 0x4E584348
    private const val KEEP = 7

    private data class Line(val sender: String, val text: String, val at: Long)
    private val lines = HashMap<String, MutableList<Line>>()

    fun idFor(conversationId: String) = "chat:$conversationId".hashCode()

    fun channels(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_CHAT, context.getString(R.string.ch_chat), NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CH_MENTIONS, context.getString(R.string.ch_chat_mentions), NotificationManager.IMPORTANCE_HIGH))
    }

    fun show(context: Context, p: ChatPush) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        channels(context)
        val text = p.text.ifBlank { context.getString(R.string.chat_photo_line) }
        val history = synchronized(lines) {
            lines.getOrPut(p.conversationId) { mutableListOf() }.apply { add(Line(p.senderName, text, System.currentTimeMillis())); while (size > KEEP) removeAt(0) }.toList()
        }
        val me = Person.Builder().setName(context.getString(R.string.chat_you)).build()
        val style = NotificationCompat.MessagingStyle(me).setGroupConversation(p.isGroup)
        if (p.isGroup) style.setConversationTitle(p.conversationName ?: p.senderName)
        history.forEach { style.addMessage(it.text, it.at, Person.Builder().setName(it.sender).build()) }
        val id = idFor(p.conversationId)
        val tap = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(MainActivity.EXTRA_TYPE, if (p.mention) "MESSAGE_MENTION" else "MESSAGE").putExtra(MainActivity.EXTRA_LINK, p.link)
        val n = NotificationCompat.Builder(context, if (p.mention) CH_MENTIONS else CH_CHAT)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setStyle(style)
            .setContentTitle(if (p.isGroup) p.conversationName ?: p.senderName else p.senderName)
            .setContentText(if (p.isGroup) "${p.senderName}: $text" else text)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setGroup(GROUP)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(context, id, tap, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        val summary = NotificationCompat.Builder(context, CH_CHAT)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setContentTitle(context.getString(R.string.mt_messages))
            .setGroup(GROUP).setGroupSummary(true).setAutoCancel(true)
            .build()
        runCatching {
            val nm = NotificationManagerCompat.from(context)
            nm.notify(id, n)
            nm.notify(SUMMARY_ID, summary)
        }
    }

    /** The conversation opened: its card and its lines go. */
    fun cancel(context: Context, conversationId: String) {
        synchronized(lines) { lines.remove(conversationId) }
        runCatching {
            val nm = NotificationManagerCompat.from(context)
            nm.cancel(idFor(conversationId))
            if (synchronized(lines) { lines.isEmpty() }) nm.cancel(SUMMARY_ID)
        }
    }

    fun clearAll(context: Context) {
        val ids = synchronized(lines) { lines.keys.toList().also { lines.clear() } }
        runCatching {
            val nm = NotificationManagerCompat.from(context)
            ids.forEach { nm.cancel(idFor(it)) }
            nm.cancel(SUMMARY_ID)
        }
    }
}
