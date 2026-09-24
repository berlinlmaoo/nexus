package id.znetworks.nexus.core.net

import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class ApiErrorTest {
    private fun http(status: Int, msg: String? = null) = ApiError.Http(status, msg, null, null)

    @Test fun originUnreachableIsTheExactList() {
        listOf(500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530).forEach {
            assertTrue("$it", http(it).meansOriginUnreachable())
        }
        // The server's opinion: never queued.
        listOf(400, 401, 403, 404, 409, 422, 426, 429, 501, 505, 528, 529).forEach {
            assertFalse("$it", http(it).meansOriginUnreachable())
        }
        assertTrue(ApiError.Transport(IOException("x")).meansOriginUnreachable())
        assertFalse(ApiError.Unauthorized.meansOriginUnreachable())
        assertFalse(ApiError.UpgradeRequired(null, null, null).meansOriginUnreachable())
    }

    @Test fun nobodyAnsweredNeedsNoSentence() {
        assertTrue(http(530).nobodyAnswered())
        assertFalse(http(530, "NEXUS lagi maintenance").nobodyAnswered())
        assertFalse(http(500).nobodyAnswered()) // 500 is the origin answering
    }

    @Test fun downWorkerBodyIsNotAServerSentence() {
        val body = NexusJson.parseToJsonElement("""{"error":"NEXUS is down","code":"NEXUS_DOWN","down":true}""") as JsonObject
        assertNull(ErrorBody.serverMessage(body))
    }

    @Test fun serverSentenceFallsBackToMessage() {
        val a = NexusJson.parseToJsonElement("""{"error":"Jatah cuti nggak cukup"}""") as JsonObject
        val b = NexusJson.parseToJsonElement("""{"message":"pakai message"}""") as JsonObject
        assertEquals("Jatah cuti nggak cukup", ErrorBody.serverMessage(a))
        assertEquals("pakai message", ErrorBody.serverMessage(b))
    }

    @Test fun clientTagAndUserAgent() {
        val id = ClientIdentity("0.1.0", 1, 34)
        assertEquals("android/0.1.0/1", id.clientTag)
        assertFalse(Regex("^NEXUS/\\d").containsMatchIn(id.userAgent))
    }

    @Test fun cookieOnlyForExactNexusHosts() {
        assertTrue(NexusConfig.isNexusHost("nexus.znetworks.id"))
        assertTrue(NexusConfig.isNexusHost("lan.nexus.znetworks.id"))
        assertFalse(NexusConfig.isNexusHost("evil.nexus.znetworks.id"))
        assertFalse(NexusConfig.isNexusHost("nexus.znetworks.id.evil.com"))
        assertFalse(NexusConfig.isNexusHost(null))
    }
}
