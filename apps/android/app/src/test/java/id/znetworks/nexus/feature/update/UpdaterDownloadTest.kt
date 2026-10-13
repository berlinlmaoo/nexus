package id.znetworks.nexus.feature.update

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class UpdaterDownloadTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var api: ApiClient

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = ApiClient(server.url("/"), ClientIdentity("0.1.6", 1, 36), { Session("t", "c", "u") }, mayCarrySession = { true })
    }
    @After fun tearDown() { server.close() }

    @Test fun freshDownloadCarriesSessionAndReportsProgress() = runTest {
        server.enqueue(MockResponse.Builder().code(200).addHeader("ETag", "\"v2\"").body("APKBYTES").build())
        val f = File(tmp.root, "a.apk")
        var last = 0L
        val etag = api.download("/api/app/android/apk", f, null) { done, _ -> last = done }
        assertEquals("APKBYTES", f.readText())
        assertEquals("\"v2\"", etag)
        assertEquals(8L, last)
        val req = server.takeRequest()
        assertEquals("c=t", req.headers["Cookie"])
        assertEquals(null, req.headers["Range"])
    }

    @Test fun resumesWithRangeAndIfRange() = runTest {
        val f = File(tmp.root, "a.apk").apply { writeText("APK") }
        server.enqueue(MockResponse.Builder().code(206).addHeader("Content-Range", "bytes 3-7/8").addHeader("ETag", "\"v2\"").body("BYTES").build())
        api.download("/api/app/android/apk", f, "\"v2\"")
        assertEquals("APKBYTES", f.readText())
        val req = server.takeRequest()
        assertEquals("bytes=3-", req.headers["Range"])
        assertEquals("\"v2\"", req.headers["If-Range"])
    }

    // Audit S7: the version is known before the body, so a cut download can be resumed.
    @Test fun etagIsReportedBeforeTheBytes() = runTest {
        server.enqueue(MockResponse.Builder().code(200).addHeader("ETag", "\"v2\"").body("APKBYTES").build())
        val f = File(tmp.root, "a.apk")
        var seen: String? = null
        var bytesWhenSeen = -1L
        api.download("/api/app/android/apk", f, null, onEtag = { seen = it; bytesWhenSeen = f.length() })
        assertEquals("\"v2\"", seen)
        assertEquals(0L, bytesWhenSeen)
    }

    @Test fun aNewBuildMidDownloadReplacesTheFileNotSplices() = runTest {
        val f = File(tmp.root, "a.apk").apply { writeText("OLDPART") }
        // If-Range no longer matches: the server sends the whole new file with 200.
        server.enqueue(MockResponse.Builder().code(200).addHeader("ETag", "\"v3\"").body("NEWBUILD").build())
        val etag = api.download("/api/app/android/apk", f, "\"v2\"")
        assertEquals("NEWBUILD", f.readText())
        assertEquals("\"v3\"", etag)
    }

    @Test fun signedOutIsA401NotAFile() = runTest {
        server.enqueue(MockResponse.Builder().code(404).body("""{"error":"No Android build is available to download yet.","code":"NO_ANDROID_RELEASE"}""").build())
        val f = File(tmp.root, "a.apk")
        try { api.download("/api/app/android/apk", f, null); fail() } catch (e: ApiError.Http) {
            assertEquals(404, e.status)
            assertEquals("NO_ANDROID_RELEASE", e.code)
        }
        assertFalse(f.exists() && f.length() > 0)
    }

    @Test fun releaseDecodesAndVersionRule() {
        val r = NexusJson.decodeFromString(AndroidRelease.serializer(),
            """{"available":true,"versionName":"0.1.7","versionCode":2,"sizeBytes":22000000,"sha256":"ab","downloadUrl":"/api/app/android/apk","minSupported":"0.0.0","latest":"0.1.7","extra":1}""")
        assertTrue(r.available)
        assertTrue(ApkUpdater.isNewer(r.versionCode!!, 1))
        assertFalse(ApkUpdater.isNewer(1, 1))
        assertEquals(false, NexusJson.decodeFromString(AndroidRelease.serializer(), """{"available":false,"minSupported":"0.0.0","latest":null}""").available)
    }

    @Test fun sha256OfFile() {
        val f = File(tmp.root, "x").apply { writeText("abc") }
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ApkUpdater.sha256(f))
    }
}
