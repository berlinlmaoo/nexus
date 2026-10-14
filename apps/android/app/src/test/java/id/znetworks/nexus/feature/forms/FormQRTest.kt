package id.znetworks.nexus.feature.forms

import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The share tab's QR (owner, 14 Oct: ZXing core, made on the phone): it scans back to the exact link. */
class FormQRTest {
    private fun decode(text: String, scale: Int = 4): String {
        val m = FormQR.matrix(text)!!
        val w = m.width * scale; val h = m.height * scale
        val px = IntArray(w * h) { i -> if (m[(i % w) / scale, (i / w) / scale]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt() }
        return QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(w, h, px)))).text
    }

    @Test fun scansBackToTheLink() {
        val link = "https://nexus.znetworks.id/f/pengajuan-finance-pats-k3x9"
        assertEquals(link, decode(link))
    }

    @Test fun hasAQuietZone() {
        val m = FormQR.matrix("https://nexus.znetworks.id/f/x")!!
        // Four light modules on every side (iOS's generator adds its own margin too).
        for (i in 0 until m.width) for (k in 0 until 4) {
            assertTrue(!m[i, k] && !m[i, m.height - 1 - k] && !m[k, i] && !m[m.width - 1 - k, i])
        }
    }

    @Test fun noLinkNoCode() { assertNull(FormQR.matrix("")); assertNull(FormQR.matrix("  ")) }

    @Test fun theShareTabShowsIt() {
        val tab = File("src/main/java/id/znetworks/nexus/feature/forms/FormStudioTabs.kt").readText().substringAfter("fun FormStudioShareTab(")
        assertTrue(tab.contains("FormQR.bitmap(link)") && tab.contains("R.string.fs_qr_share") && tab.contains("Color.White"))
    }
}
