package id.znetworks.nexus.feature.attendance.liveness

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.tasks.await
import kotlin.math.min

/**
 * Is there actually a person in the selfie about to be sent? (REQ-ATT-04, iOS `FaceGuard`.)
 * On-device, offline, before the location fix: a photo of the wall costs one retake and never
 * reaches the record. Not a biometric: it does not check whose face it is.
 */
object FaceGuard {
    enum class Verdict { OK, NO_FACE, UNREADABLE }

    /** Smallest face that counts, as a fraction of the image's shorter side. */
    const val MIN_FACE_FRACTION = 0.12f

    private val detector by lazy {
        FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
                .setMinFaceSize(0.1f)
                .build(),
        )
    }

    suspend fun check(jpeg: ByteArray): Verdict {
        val bitmap = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return Verdict.UNREADABLE
        return check(bitmap)
    }

    suspend fun check(bitmap: Bitmap): Verdict {
        val faces = runCatching { detector.process(InputImage.fromBitmap(bitmap, 0)).await() }
            .getOrElse { return Verdict.UNREADABLE }
        val shorter = min(bitmap.width, bitmap.height).toFloat()
        val big = faces.any { min(it.boundingBox.width(), it.boundingBox.height()) >= shorter * MIN_FACE_FRACTION }
        return if (big) Verdict.OK else Verdict.NO_FACE
    }
}
