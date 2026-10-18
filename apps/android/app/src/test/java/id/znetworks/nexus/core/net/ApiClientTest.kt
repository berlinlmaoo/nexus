package id.znetworks.nexus.core.net

import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.*
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlinx.serialization.Serializable
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    @Serializable data class Ping(val ok: Boolean = false, val known: String? = null)

    private lateinit var server: MockWebServer
    private var session: Session? = Session("tok123", "__Secure-authjs.session-token", "u1")
    private val ended = mutableListOf<Session>()
    private val upgrades = mutableListOf<ApiError.UpgradeRequired>()

    private fun client(allowHost: Boolean = true) = ApiClient(
        baseUrl = server.url("/"),
        identity = ClientIdentity("0.1.0", 1, 34),
        sessionProvider = { session },
        onUnauthorized = { ended += it },
        onUpgradeRequired = { upgrades += it },
        mayCarrySession = { allowHost },
    )

    private fun reply(code: Int, body: String) =
        server.enqueue(MockResponse.Builder().code(code).body(body).build())

    @Before fun setUp() { server = MockWebServer(); server.start() }
    @After fun tearDown() { server.close() }

    @Test fun sendsIdentityAndCookie() = runTest {
        reply(200, """{"ok":true,"brandNewField":{"x":1}}""")
        val res = client().get("/api/ping", Ping.serializer())
        assertTrue(res.ok) // unknown fields tolerated
        val req = server.takeRequest()
        assertEquals("android/0.1.0/1", req.headers["X-Nexus-Client"])
        assertEquals("chat-files", req.headers["X-Nexus-Caps"])
        assertEquals("application/json", req.headers["Accept"])
        assertEquals("__Secure-authjs.session-token=tok123", req.headers["Cookie"])
        assertTrue(req.headers["User-Agent"]!!.startsWith("NEXUS-Android/0.1.0"))
    }

    @Test fun noCookieToForeignHost() = runTest {
        reply(200, "{}")
        client(allowHost = false).get("/api/ping", Ping.serializer())
        assertNull(server.takeRequest().headers["Cookie"])
    }

    // Audit R1: a redirect to another host never carries the session cookie.
    @Test fun redirectToAnotherHostDropsTheCookie() = runTest {
        val other = MockWebServer().apply { start() }
        try {
            other.enqueue(MockResponse.Builder().code(200).body("{}").build())
            server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "http://127.0.0.1:${other.port}/elsewhere").build())
            val c = ApiClient(
                baseUrl = server.url("/").newBuilder().host("localhost").build(),
                identity = ClientIdentity("0.1.0", 1, 34),
                sessionProvider = { session },
                mayCarrySession = { it == "localhost" },
            )
            c.get("/api/ping", Ping.serializer())
            assertEquals("__Secure-authjs.session-token=tok123", server.takeRequest().headers["Cookie"])
            assertNull(other.takeRequest().headers["Cookie"])
        } finally { other.close() }
    }

    @Test fun noCookieOnUnauthedCall() = runTest {
        reply(200, "{}")
        client().get("/api/app/version-policy", Ping.serializer(), authed = false)
        val req = server.takeRequest()
        assertNull(req.headers["Cookie"])
        assertEquals("android/0.1.0/1", req.headers["X-Nexus-Client"]) // still identified
    }

    @Test fun authed401EndsSession() = runTest {
        reply(401, """{"error":"Unauthorized"}""")
        try { client().get("/api/user/profile", Ping.serializer()); fail() } catch (e: ApiError) {
            assertSame(ApiError.Unauthorized, e)
        }
        assertEquals(listOf(session), ended)
    }

    @Test fun unauthed401IsAnAnswerNotALogout() = runTest {
        reply(401, """{"ok":false,"error":"CredentialsSignin"}""")
        try { client().get("/api/auth/app-login", Ping.serializer(), authed = false); fail() } catch (e: ApiError) {
            assertTrue(e is ApiError.Http && e.status == 401)
        }
        assertTrue(ended.isEmpty())
    }

    @Test fun upgradeRequiredOnlyWithCode() = runTest {
        reply(426, """{"error":"Update dulu","code":"UPGRADE_REQUIRED","minSupported":"0.1.6","storeUrl":"https://play"}""")
        try { client().get("/api/x", Ping.serializer()); fail() } catch (e: ApiError) {
            assertTrue(e is ApiError.UpgradeRequired)
            assertEquals("0.1.6", (e as ApiError.UpgradeRequired).minSupported)
        }
        assertEquals(1, upgrades.size)

        reply(426, "Upgrade Required") // a bare proxy 426
        try { client().get("/api/x", Ping.serializer()); fail() } catch (e: ApiError) {
            assertTrue(e is ApiError.Http && e.status == 426)
        }
        assertEquals(1, upgrades.size)
    }

    @Test fun downWorkerIsUnreachableWithoutSentence() = runTest {
        reply(530, """{"error":"NEXUS is down","code":"NEXUS_DOWN","down":true}""")
        try { client().get("/api/attendance/today", Ping.serializer()); fail() } catch (e: ApiError) {
            e as ApiError.Http
            assertNull(e.serverMessage)
            assertTrue(e.meansOriginUnreachable())
            assertTrue(e.nobodyAnswered())
        }
    }

    @Test fun serverSentenceIsKeptVerbatim() = runTest {
        reply(409, """{"error":"You have already checked in today."}""")
        try { client().get("/api/x", Ping.serializer()); fail() } catch (e: ApiError) {
            assertEquals("You have already checked in today.", (e as ApiError.Http).serverMessage)
        }
    }

    @Test fun badJsonOn2xxIsDecoding() = runTest {
        reply(200, "<html>")
        try { client().get("/api/x", Ping.serializer()); fail() } catch (e: ApiError) {
            assertTrue(e is ApiError.Decoding)
        }
    }

    @Test fun noConnectionIsTransport() = runTest {
        val c = client()
        server.close()
        try { c.get("/api/x", Ping.serializer()); fail() } catch (e: ApiError) {
            assertTrue(e is ApiError.Transport)
        }
    }

    @Test fun eventStreamEmitsBeforeEndAndCancellationReleasesTheCall() = runBlocking {
        val firstLine = CompletableDeferred<String>()
        server.enqueue(MockResponse.Builder().code(200)
            .body("data: hello\n\n" + "x".repeat(256)).throttleBody(16, 2, TimeUnit.SECONDS).build())
        val c = client()
        val job = launch(Dispatchers.Default) {
            c.sendEventLines(Request.Builder().url(server.url("/api/gideon")).build(), 10_000) {
                if (!firstLine.isCompleted) firstLine.complete(it)
            }
        }
        try {
            assertEquals("data: hello", withTimeout(5000) { firstLine.await() })
            assertTrue(job.isActive)
            val req = server.takeRequest()
            assertEquals("chat-files", req.headers["X-Nexus-Caps"])
            assertEquals("__Secure-authjs.session-token=tok123", req.headers["Cookie"])
            job.cancelAndJoin()
            withTimeout(3000) { while (c.http.dispatcher.runningCallsCount() != 0) delay(10) }
            assertTrue(job.isCancelled)
        } finally { job.cancelAndJoin() }
    }
}
