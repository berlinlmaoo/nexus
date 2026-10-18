package id.znetworks.nexus.feature.meetings

import android.content.Context
import androidx.work.*
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit

/** The server offset is authoritative after a crash, a duplicate chunk, or a lost response. */
class MeetingUploader(private val api: MeetingsApi) {
    suspend fun resume(id: String, file: File, chunkBytes: Int, progress: suspend (Long, Long) -> Unit = { _, _ -> }): Meeting {
        val meeting = api.get(id)
        if (meeting.status != "UPLOADING") return meeting
        require(file.isFile && file.length() == meeting.audio.bytes) { "Local audio missing or size changed" }
        val size = file.length()
        var offset = meeting.audio.received
        var mismatches = 0
        while (true) {
            require(offset in 0..size) { "Invalid upload offset" }
            if (offset == size) {
                try { return api.complete(id) }
                catch (e: ApiError.Http) {
                    if (e.code != "INCOMPLETE" || ++mismatches > 8) throw e
                    offset = e.body?.get("received")?.jsonPrimitive?.longOrNull ?: throw e
                    continue
                }
            }
            val count = minOf(chunkBytes.coerceIn(1, 16_777_216).toLong(), size - offset).toInt()
            val bytes = withContext(Dispatchers.IO) { RandomAccessFile(file, "r").use { input -> input.seek(offset); ByteArray(count).also(input::readFully) } }
            try {
                val answer = api.chunk(id, offset, bytes)
                require(answer.received > offset && answer.received <= size) { "Upload did not advance" }
                offset = answer.received; mismatches = 0
                progress(offset, size)
            } catch (e: ApiError.Http) {
                if (e.code == "NOT_UPLOADING") return api.get(id)
                if (e.code != "OFFSET_MISMATCH" || ++mismatches > 8) throw e
                offset = e.body?.get("received")?.jsonPrimitive?.longOrNull ?: throw e
            }
        }
    }
}

class MeetingUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val manager = applicationContext.getSystemService(android.app.NotificationManager::class.java)
        manager.createNotificationChannel(android.app.NotificationChannel("meeting-upload", applicationContext.getString(R.string.meet_uploading), android.app.NotificationManager.IMPORTANCE_LOW))
        val notification = androidx.core.app.NotificationCompat.Builder(applicationContext, "meeting-upload").setSmallIcon(R.drawable.ic_stat_nexus).setContentTitle(applicationContext.getString(R.string.meet_uploading)).setOngoing(true).build()
        return if (android.os.Build.VERSION.SDK_INT >= 29) ForegroundInfo(72020, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(72020, notification)
    }
    override suspend fun doWork(): Result {
        val container = (applicationContext as NexusApplication).container
        val user = inputData.getString("user") ?: return Result.failure()
        if (container.sessionStore.current?.userId != user) return Result.failure()
        val id = inputData.getString("meeting") ?: return Result.failure()
        val name = inputData.getString("file") ?: return Result.failure()
        val dir = MeetingFiles.directory(applicationContext)
        val file = File(dir, name)
        if (file.canonicalFile.parentFile != dir.canonicalFile || !file.isFile) return Result.failure(workDataOf("code" to "LOCAL_AUDIO_MISSING"))
        return try {
            val result = MeetingUploader(MeetingsApi(container.api)).resume(id, file, inputData.getInt("chunk", 8_388_608)) { received, total ->
                setProgress(workDataOf("received" to received, "total" to total))
            }
            if (result.status != "UPLOADING") { file.delete(); File(dir, "$id.upload").delete() }
            Result.success(workDataOf("meeting" to id))
        } catch (e: kotlinx.coroutines.CancellationException) { throw e
        } catch (e: ApiError.Http) {
            if (e.status >= 500 || e.status == 429) Result.retry() else Result.failure(workDataOf("code" to (e.code ?: "UPLOAD_FAILED")))
        } catch (_: ApiError.Transport) { Result.retry() }
        catch (_: Exception) { Result.failure(workDataOf("code" to "UPLOAD_FAILED")) }
    }
}

object MeetingFiles {
    fun directory(context: Context) = File(context.filesDir, "meetings").apply { mkdirs() }
    fun enqueue(context: Context, user: String, id: String, file: File, chunk: Int) {
        val data = workDataOf("user" to user, "meeting" to id, "file" to file.name, "chunk" to chunk)
        File(directory(context), "$id.upload").writeText(file.name)
        WorkManager.getInstance(context).enqueueUniqueWork("meeting-upload:$user:$id", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<MeetingUploadWorker>().setInputData(data).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS).addTag("meeting-uploads").build())
    }
    fun resume(context: Context, user: String, meeting: Meeting): Boolean {
        val file = File(directory(context), "${meeting.id}.upload").takeIf { it.isFile }?.readText()?.let { File(directory(context), it) } ?: return false
        if (file.canonicalFile.parentFile != directory(context).canonicalFile || !file.isFile) return false
        enqueue(context, user, meeting.id, file, 8_388_608)
        return true
    }
    fun clear(context: Context) {
        WorkManager.getInstance(context).cancelAllWorkByTag("meeting-uploads")
        context.stopService(android.content.Intent(context, MeetingRecordingService::class.java))
        directory(context).deleteRecursively()
        context.getSharedPreferences("meeting-recording", Context.MODE_PRIVATE).edit().clear().apply()
        MeetingRecording.state.value = RecordingState()
    }
}
