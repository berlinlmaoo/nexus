package id.znetworks.nexus.feature.forms

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.core.content.FileProvider
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.io.File

/** The form link as a QR code, made on the phone (iOS FormQR: correction M, a quiet zone, black on white). */
object FormQR {
    /** One cell per module plus a 4-module quiet zone; null for an empty link. */
    fun matrix(text: String): BitMatrix? {
        if (text.isBlank()) return null
        val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 4, EncodeHintType.CHARACTER_SET to "UTF-8")
        return runCatching { QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints) }.getOrNull()
    }

    /** Each module [scale] pixels square, so the image stays crisp when drawn without filtering. */
    fun bitmap(text: String, scale: Int = 12): Bitmap? {
        val m = matrix(text) ?: return null
        val w = m.width * scale; val h = m.height * scale
        val px = IntArray(w * h)
        for (y in 0 until h) for (x in 0 until w) px[y * w + x] = if (m[x / scale, y / scale]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
        return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    }

    /** The share sheet with the QR as a PNG, written to the cache the FileProvider serves ("shared/"). */
    fun share(context: Context, bmp: Bitmap, title: String) {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val f = File(dir, "form-qr.png")
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
        val send = Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
