package id.znetworks.nexus.feature.attendance.requests

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.OpenableColumns
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import kotlin.math.max

/**
 * Turns a picked or shot file into a request attachment (REQ-ATT-30): photo or PDF only, ≤ 10 MB,
 * a real MIME type and a name that says what it is. Photos are re-encoded to an upright JPEG
 * (HEIC/PNG/huge camera files all become something every reviewer can open), long edge ≤ 2048.
 */
object AttachmentReader {
    sealed class Result {
        class Ok(val attachment: Attachment) : Result()
        object TooBig : Result()
        object Unsupported : Result()
        object Unreadable : Result()
    }

    fun read(context: Context, uri: Uri, photoName: String): Result {
        val cr = context.contentResolver
        val size = runCatching {
            cr.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null
            }
        }.getOrNull()
        val mime = cr.getType(uri).orEmpty().lowercase()
        val isPdf = mime == "application/pdf" || uri.toString().lowercase().endsWith(".pdf")
        // Refused before reading, so a 140 MB video never lands in memory.
        if (isPdf && size != null && size > RequestRules.MAX_ATTACHMENT_BYTES) return Result.TooBig
        return when {
            isPdf -> {
                val bytes = runCatching { cr.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() ?: return Result.Unreadable
                if (bytes.size > RequestRules.MAX_ATTACHMENT_BYTES) return Result.TooBig
                Result.Ok(Attachment(bytes, displayName(context, uri) ?: "document.pdf", "application/pdf"))
            }
            mime.startsWith("image/") || mime.isEmpty() -> {
                val jpeg = uprightJpeg(context, uri) ?: return if (mime.isEmpty()) Result.Unsupported else Result.Unreadable
                if (jpeg.size > RequestRules.MAX_ATTACHMENT_BYTES) return Result.TooBig
                Result.Ok(Attachment(jpeg, photoName, "image/jpeg"))
            }
            else -> Result.Unsupported
        }
    }

    private fun displayName(context: Context, uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    private fun uprightJpeg(context: Context, uri: Uri): ByteArray? = runCatching {
        val cr = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0) return null
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2048) sample *= 2
        val bmp = cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: return null
        val rotation = cr.openInputStream(uri)?.use { ExifInterface(it).rotationDegrees } ?: 0
        val scale = minOf(1f, 2048f / max(bmp.width, bmp.height))
        val m = Matrix().apply { postRotate(rotation.toFloat()); postScale(scale, scale) }
        val out = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        ByteArrayOutputStream().use { bos -> out.compress(Bitmap.CompressFormat.JPEG, 85, bos); bos.toByteArray() }
    }.getOrNull()
}
