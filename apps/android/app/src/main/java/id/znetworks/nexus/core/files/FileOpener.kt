package id.znetworks.nexus.core.files

import android.content.Context
import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import id.znetworks.nexus.core.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * A NEXUS file (`/api/files/…`, vault raw, attachments) needs the session, so a browser cannot open
 * it: it is downloaded with the session into the shared cache and handed to a viewer.
 */
object FileOpener {
    /** The file on disk, downloaded with the session when it is not there yet (shared with the offline pass). */
    suspend fun fetch(context: Context, api: ApiClient, url: String, name: String): File {
        id.znetworks.nexus.core.offline.DiskFiles.existing(url)?.let { return it }
        val file = id.znetworks.nexus.core.offline.DiskFiles.fileFor(url, name)
            ?: File(File(context.cacheDir, "shared/f-${url.hashCode()}").apply { mkdirs() }, name.replace("/", "_").ifBlank { "file" })
        withContext(Dispatchers.IO) {
            val part = File(file.path + ".part")
            api.download(url, part, null)
            part.renameTo(file)
        }
        return file
    }

    /** Returns false when no app on the phone can open it. Throws ApiError on a failed download. */
    suspend fun open(context: Context, api: ApiClient, url: String, name: String, mime: String? = null, share: Boolean = false): Boolean {
        val file = fetch(context, api, url, name)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val type = mime ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"
        val intent = if (share) Intent.createChooser(Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null)
        else Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
    }
}
