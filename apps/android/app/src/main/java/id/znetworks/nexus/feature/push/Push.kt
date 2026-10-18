package id.znetworks.nexus.feature.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import id.znetworks.nexus.BuildConfig
import id.znetworks.nexus.MainActivity
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.feature.chat.ChatNotifier
import id.znetworks.nexus.feature.chat.ChatPresence
import id.znetworks.nexus.feature.chat.ChatPush
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.Request
import java.util.UUID

/**
 * FCM (PRD §4.5). Push stays off until the owner's Firebase values are built in; nothing else in
 * the app depends on it. Registration mirrors iOS: on sign-in and on every token refresh, removed
 * on logout with the OLD cookie.
 */
class PushManager(
    private val context: Context,
    private val api: ApiClient,
    private val identity: ClientIdentity,
    private val scope: CoroutineScope,
) {
    private val prefs = context.getSharedPreferences("nexus.push", Context.MODE_PRIVATE)

    /** True once the server accepted this phone's token: local reminder fallbacks then stand down. */
    private val _deliveryActive = MutableStateFlow(false)
    val deliveryActive: StateFlow<Boolean> = _deliveryActive.asStateFlow()

    val configured: Boolean by lazy { init() }

    private fun init(): Boolean {
        if (BuildConfig.FIREBASE_PROJECTID.isBlank() || BuildConfig.FIREBASE_APPLICATIONID.isBlank() ||
            BuildConfig.FIREBASE_APIKEY.isBlank() || BuildConfig.FIREBASE_SENDERID.isBlank()
        ) return false
        return runCatching {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(
                    context,
                    FirebaseOptions.Builder()
                        .setProjectId(BuildConfig.FIREBASE_PROJECTID)
                        .setApplicationId(BuildConfig.FIREBASE_APPLICATIONID)
                        .setApiKey(BuildConfig.FIREBASE_APIKEY)
                        .setGcmSenderId(BuildConfig.FIREBASE_SENDERID)
                        .build(),
                )
            }
            true
        }.getOrDefault(false)
    }

    /** A stable id for this install (`deviceId` on the server), kept across tokens. */
    private val deviceId: String
        get() = prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("deviceId", it).apply() }

    fun register() {
        if (!configured) return
        scope.launch {
            val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() ?: return@launch
            send(token)
        }
    }

    fun onNewToken(token: String) = scope.launch { send(token) }

    private suspend fun send(token: String) {
        val body = Registration(
            platform = "android", token = token, deviceId = deviceId, appId = context.packageName,
            appVersion = identity.versionName, buildNumber = identity.versionCode.toString(),
            osVersion = "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
            deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".take(40),
        )
        val ok = runCatching {
            api.postJson("/api/push/devices", body, Registration.serializer(), JsonObject.serializer())
        }.isSuccess
        if (ok) prefs.edit().putString("token", token).apply()
        _deliveryActive.value = ok
    }

    /** Logout: before the session is gone for good, with that session's own cookie. */
    /** Returns the job deleting the device (null when there was nothing to delete), so logout can wait for it. */
    fun unregister(old: Session?): kotlinx.coroutines.Job? {
        _deliveryActive.value = false
        val token = prefs.getString("token", null) ?: return null
        prefs.edit().remove("token").apply()
        if (old == null || !configured) return null
        return scope.launch {
            runCatching {
                api.send(
                    Request.Builder().url(api.url("/api/push/devices"))
                        .delete(api.json.encodeToString(TokenBody.serializer(), TokenBody(token)).toJsonBody()).build(),
                    JsonObject.serializer(), asSession = old,
                )
            }
            runCatching { FirebaseMessaging.getInstance().deleteToken().await() }
        }
    }

    @Serializable
    private data class Registration(
        val platform: String, val token: String, val deviceId: String, val appId: String,
        val appVersion: String, val buildNumber: String, val osVersion: String, val deviceModel: String,
    )

    @Serializable
    private data class TokenBody(val token: String)

    companion object {
        /** PRD §4.5 channels (server ANDROID_CHANNELS, fcm-payload.ts), plus the pre-R1 ids so nothing is lost. */
        private val CHANNELS = listOf(
            Triple("attendance_reminders", R.string.ch_attendance_reminders, NotificationManager.IMPORTANCE_HIGH),
            Triple("attendance_location", R.string.ch_attendance_location, NotificationManager.IMPORTANCE_HIGH),
            Triple("approvals", R.string.ch_approvals, NotificationManager.IMPORTANCE_HIGH),
            Triple("messages", R.string.ch_messages, NotificationManager.IMPORTANCE_HIGH),
            // Chat: one card per conversation; mentions louder than plain messages (CHAT-CONTRACT).
            Triple(ChatNotifier.CH_CHAT, R.string.ch_chat, NotificationManager.IMPORTANCE_DEFAULT),
            Triple(ChatNotifier.CH_MENTIONS, R.string.ch_chat_mentions, NotificationManager.IMPORTANCE_HIGH),
            Triple("tasks", R.string.ch_tasks, NotificationManager.IMPORTANCE_DEFAULT),
            Triple("tickets", R.string.ch_tickets, NotificationManager.IMPORTANCE_DEFAULT),
            Triple("announcements", R.string.ch_announcements, NotificationManager.IMPORTANCE_HIGH),
            // Same id and name LocalNotifier uses; the server files app_update/system_*/unknown here.
            Triple("system", R.string.channel_system, NotificationManager.IMPORTANCE_DEFAULT),
            Triple("attendance", R.string.ch_attendance, NotificationManager.IMPORTANCE_HIGH),
            Triple("general", R.string.ch_general, NotificationManager.IMPORTANCE_DEFAULT),
        )

        fun ensureChannels(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            CHANNELS.forEach { (id, name, importance) -> nm.createNotificationChannel(NotificationChannel(id, context.getString(name), importance)) }
        }

        /** The server's channel if it sent one we know, else by type (same buckets as SERVER-REQUESTS R1). */
        fun channelFor(type: String?, sent: String?): String {
            if (sent != null && CHANNELS.any { it.first == sent }) return sent
            val t = type.orEmpty().lowercase()
            return when {
                t == "attendance_auto_offsite_checkout" -> "attendance_location"
                // A staff member has been outside the office a while (owner, 8 Oct): for whoever approves them.
                t == "attendance_outside_approver" -> "approvals"
                t.startsWith("attendance_request") || t.startsWith("offsite_checkout") -> "approvals"
                t.startsWith("attendance") || t.startsWith("dayoff") || t.startsWith("red_date") -> "attendance_reminders"
                t.startsWith("message") || t.startsWith("feed") -> "messages"
                t.startsWith("complaint") || t.startsWith("peer_report") || t == "system_gideon" -> "tickets"
                t == "announcement" -> "announcements"
                t.startsWith("task") || t.startsWith("comment") || t.startsWith("project") -> "tasks"
                else -> "system"
            }
        }
    }
}

/**
 * Receives FCM messages. Data-only messages (SERVER-REQUESTS R1) always arrive here and are drawn by
 * the app; notification+data messages arrive here only in the foreground (the system draws them in
 * the background and hands the data keys to MainActivity as extras on tap, which routes the same).
 */
class NexusMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val c = (application as NexusApplication).container
        if (c.sessionStore.current != null) c.push.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val c = (application as NexusApplication).container
        val d = message.data
        val type = d["type"]
        // The server checked the person out at 2 h 30 outside: stop tracking, re-read today.
        if (type == "attendance_auto_offsite_checkout") c.reconcileTrail()
        // Chat (CHAT-CONTRACT): one card per conversation, none for the conversation on screen, which
        // refreshes instead; the list and the badges refresh too.
        val chat = ChatPush.parse(d)
        if (chat != null) {
            c.chatEvents.tryEmit(chat.conversationId)
            c.badges.refresh()
            val onScreen = ChatPresence.openConversationId == chat.conversationId &&
                androidx.lifecycle.ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
            if (!onScreen) ChatNotifier.show(this, chat)
            return
        }
        c.badges.refresh()
        val title = d["title"] ?: message.notification?.title ?: return
        val body = d["body"] ?: message.notification?.body.orEmpty()
        // A post with a photo (feed_post / feed_like, 9 Oct): `image` is an absolute https URL, no cookie needed.
        // Fetched here (FCM's worker thread) with a short timeout; any failure falls back to text.
        val picture = d["image"]?.takeIf { it.startsWith("https://") }?.let { PushPicture.fetch(it) }
        show(this, title, body, type, d["meetingId"]?.let { "/meetings/$it" } ?: d["link"], d["taskId"], d["projectId"], d["category"], d["notificationId"],
            PushManager.channelFor(type, d["channel"] ?: message.notification?.channelId), picture)
    }

    companion object {
        fun show(
            context: Context, title: String, body: String, type: String?, link: String?, taskId: String?, projectId: String?,
            category: String?, notificationId: String?, channel: String, picture: android.graphics.Bitmap? = null,
        ) {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) return
            PushManager.ensureChannels(context)
            val id = (notificationId ?: "$type|$link|$title").hashCode()
            val tap = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(MainActivity.EXTRA_TYPE, type).putExtra(MainActivity.EXTRA_LINK, link)
                .putExtra(MainActivity.EXTRA_TASK_ID, taskId).putExtra(MainActivity.EXTRA_PROJECT_ID, projectId)
                .putExtra(MainActivity.EXTRA_NOTIFICATION_ID, notificationId)
            val builder = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_nexus)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(if (picture != null) NotificationCompat.BigPictureStyle().bigPicture(picture).setSummaryText(body)
                    else NotificationCompat.BigTextStyle().bigText(body))
                .apply { if (picture != null) setLargeIcon(picture) }
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(context, id, tap, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            // The only action ever offered from the shade: open the permit composer. Never check-in/out
            // (REQ-ATT-01/40), never approve/reject (owner, 24 Sep 2026).
            if (category == "NEXUS_OUTSIDE_OFFICE") {
                val permit = Intent(Intent.ACTION_VIEW, Uri.parse("nexus://attendance?permit=today"), context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                builder.addAction(0, context.getString(R.string.file_a_permit),
                    PendingIntent.getActivity(context, id + 1, permit, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
            runCatching { NotificationManagerCompat.from(context).notify(id, builder.build()) }
        }
    }
}

/** A push's picture: one short request (no session: the URL is public), downscaled for the shade; null on any failure. */
internal object PushPicture {
    private val http by lazy { okhttp3.OkHttpClient.Builder().callTimeout(6, java.util.concurrent.TimeUnit.SECONDS).build() }

    fun fetch(url: String): android.graphics.Bitmap? = runCatching {
        http.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { r ->
            if (!r.isSuccessful) return null
            val bytes = r.body.bytes()
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1024) sample *= 2
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })
        }
    }.getOrNull()
}

