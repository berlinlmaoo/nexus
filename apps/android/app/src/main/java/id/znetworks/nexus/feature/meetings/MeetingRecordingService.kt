package id.znetworks.nexus.feature.meetings

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.*
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import id.znetworks.nexus.MainActivity
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import java.io.File

data class RecordingState(val file: String? = null, val seconds: Double = 0.0, val paused: Boolean = false, val recording: Boolean = false, val finished: Boolean = false, val limitReached: Boolean = false, val failed: Boolean = false, val recordedAt: String? = null, val introEndSec: Double? = null)
object MeetingRecording {
    val state = MutableStateFlow(RecordingState())
    fun command(context: Context, action: String) {
        val intent = Intent(context, MeetingRecordingService::class.java).setAction(action)
        if (action == "start") ContextCompat.startForegroundService(context, intent) else context.startService(intent)
    }
}

/** Microphone only after a visible user tap. Audio focus/silencing interrupts to Pause, never automatic Resume. */
class MeetingRecordingService : Service() {
    private var recorder: MediaRecorder? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var accumulated = 0L
    private var resumedAt = 0L
    private var focus: AudioFocusRequest? = null
    private val audio by lazy { getSystemService(AudioManager::class.java) }
    private val notifications by lazy { getSystemService(NotificationManager::class.java) }
    private val silencing = object : AudioManager.AudioRecordingCallback() {
        override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>?) {
            if (configs.orEmpty().any { it.clientAudioSessionId == recorder?.activeRecordingConfiguration?.clientAudioSessionId && it.isClientSilenced }) pause()
        }
    }
    override fun onBind(intent: Intent?) = null
    override fun onCreate() {
        super.onCreate()
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.meet_recording_channel), NotificationManager.IMPORTANCE_LOW))
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "start" -> start(); "pause" -> pause(); "resume" -> resume(); "stop" -> finish()
            "intro-done" -> if (recorder != null) MeetingRecording.state.value = MeetingRecording.state.value.copy(introEndSec = elapsed() / 1000.0)
            "intro-undo" -> MeetingRecording.state.value = MeetingRecording.state.value.copy(introEndSec = null)
        }
        return START_NOT_STICKY
    }
    private fun requestFocus(): Boolean {
        focus?.let { audio.abandonAudioFocusRequest(it) }
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setOnAudioFocusChangeListener { if (it == AudioManager.AUDIOFOCUS_LOSS || it == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) pause() }.build()
        focus = request
        return audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
    @Suppress("DEPRECATION") private fun start() {
        if (recorder != null) return
        accumulated = 0L; resumedAt = 0L
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { MeetingRecording.state.value = RecordingState(failed = true); stopSelf(); return }
        val file = File(MeetingFiles.directory(this), "record-${java.util.UUID.randomUUID()}.m4a")
        getSharedPreferences("meeting-recording", MODE_PRIVATE).edit().clear().putString("user", (application as NexusApplication).container.sessionStore.current?.userId).apply()
        MeetingRecording.state.value = RecordingState(file = file.name, recording = true, recordedAt = java.time.Instant.now().toString())
        ServiceCompat.startForeground(this, ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        try {
            check(requestFocus())
            val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else MediaRecorder()
            recorder = r
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1); r.setAudioSamplingRate(44100); r.setAudioEncodingBitRate(48000)
            r.setOutputFile(file.absolutePath)
            r.setOnErrorListener { _, _, _ -> finish(failed = true) }
            r.prepare(); r.start(); resumedAt = SystemClock.elapsedRealtime()
            if (Build.VERSION.SDK_INT >= 29) audio.registerAudioRecordingCallback(silencing, Handler(Looper.getMainLooper()))
            scope.launch {
                while (isActive && recorder != null) {
                    val s = MeetingRecording.state.value
                    val seconds = elapsed() / 1000.0
                    MeetingRecording.state.value = s.copy(seconds = seconds)
                    val max = (application as NexusApplication).container.remoteConfig.current.meetingMaxMinutes * 60
                    if (seconds >= max) { finish(limit = true); break }
                    notifications.notify(ID, notification()); delay(1000)
                }
            }
        } catch (_: Exception) { finish(failed = true) }
    }
    private fun elapsed() = accumulated + if (MeetingRecording.state.value.paused || resumedAt == 0L) 0 else SystemClock.elapsedRealtime() - resumedAt
    private fun pause() {
        if (recorder == null || MeetingRecording.state.value.paused) return
        try {
            accumulated = elapsed(); recorder?.pause()
            MeetingRecording.state.value = MeetingRecording.state.value.copy(paused = true, seconds = accumulated / 1000.0)
            notifications.notify(ID, notification())
        } catch (_: Exception) { finish(failed = true) }
    }
    private fun resume() {
        if (recorder == null || !MeetingRecording.state.value.paused) return
        try {
            if (!requestFocus()) return
            recorder?.resume(); resumedAt = SystemClock.elapsedRealtime()
            MeetingRecording.state.value = MeetingRecording.state.value.copy(paused = false)
            notifications.notify(ID, notification())
        } catch (_: Exception) { finish(failed = true) }
    }
    private fun finish(limit: Boolean = false, failed: Boolean = false) {
        val s = MeetingRecording.state.value
        val seconds = elapsed() / 1000.0
        val r = recorder; recorder = null
        var broken = failed
        try { r?.stop() } catch (_: Exception) { broken = true }
        r?.release()
        audio.unregisterAudioRecordingCallback(silencing)
        focus?.let { audio.abandonAudioFocusRequest(it) }; focus = null
        MeetingRecording.state.value = s.copy(seconds = seconds, recording = false, finished = !broken, failed = broken, limitReached = limit)
        if (broken) s.file?.let { File(MeetingFiles.directory(this), it).delete() }
        if (s.file != null && !broken) getSharedPreferences("meeting-recording", MODE_PRIVATE).edit().putString("file", s.file).putString("at", s.recordedAt).putFloat("seconds", seconds.toFloat()).putFloat("introEndSec", s.introEndSec?.toFloat() ?: -1f).apply()
        if (limit) notifications.notify(ID + 1, NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_nexus).setContentTitle(getString(R.string.meet_limit_reached)).setContentIntent(openIntent()).setAutoCancel(true).build())
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    private fun openIntent() = PendingIntent.getActivity(this, ID, Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_LINK, "/meetings/new"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun notification(): Notification {
        val s = MeetingRecording.state.value
        fun action(command: String) = PendingIntent.getService(this, command.hashCode(), Intent(this, MeetingRecordingService::class.java).setAction(command), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_nexus).setContentTitle(getString(if (s.paused) R.string.meet_paused else R.string.meet_recording) + " · " + MeetingRules.timestamp(s.seconds))
            .setContentIntent(openIntent()).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(0, getString(if (s.paused) R.string.meet_resume else R.string.meet_pause), action(if (s.paused) "resume" else "pause"))
            .addAction(0, getString(R.string.meet_stop), action("stop")).build()
    }
    override fun onDestroy() { if (recorder != null) finish(); scope.cancel(); super.onDestroy() }
    companion object { private const val CHANNEL = "meeting-recording"; private const val ID = 72019 }
}
