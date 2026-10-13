package id.znetworks.nexus.feature.auth

import id.znetworks.nexus.FakeCipher
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.core.session.SessionStore
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class AuthRepositoryTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var store: SessionStore
    private lateinit var auth: AuthRepository
    private val events = mutableListOf<String>()

    @Before fun setUp() {
        server = MockWebServer(); server.start()
        store = SessionStore(File(tmp.root, "s.bin"), FakeCipher())
        lateinit var repo: AuthRepository
        val api = ApiClient(
            baseUrl = server.url("/"), identity = ClientIdentity("0.1.0", 1, 34),
            sessionProvider = { store.current }, onUnauthorized = { repo.sessionEnded(it) },
            mayCarrySession = { true },
        )
        repo = AuthRepository(api, store, now = { 1_000L })
        repo.addListener(object : AuthRepository.SessionListener {
            override fun onSignedIn(session: Session) { events += "in:${session.userId}" }
            override fun onSignedOut(session: Session?, deliberate: Boolean) { events += "out:${session?.userId}:$deliberate" }
        })
        auth = repo
        this.api = api
    }
    private lateinit var api: ApiClient
    @After fun tearDown() { server.close() }

    private fun reply(code: Int, body: String) = server.enqueue(MockResponse.Builder().code(code).body(body).build())

    @Test fun loginStoresServerCookieName() = runTest {
        reply(200, """{"ok":true,"token":"T","cookieName":"__Secure-authjs.session-token","expiresInSeconds":2592000,
            "user":{"id":"u1","name":"Bagas","email":"b@z.id","avatar":null}}""")
        val s = auth.login("  B@Z.id ", "pw")
        assertEquals("__Secure-authjs.session-token", s.cookieName)
        assertEquals(1_000L + 2_592_000_000L, s.expiresAtMillis)
        assertEquals(s, store.current)
        assertEquals(listOf("in:u1"), events)
        val body = server.takeRequest().body!!.utf8()
        assertTrue(body.contains("\"email\":\"B@Z.id\"")) // trimmed; server canonicalises case
    }

    @Test fun wrongPasswordDoesNotTouchSession() = runTest {
        reply(401, """{"ok":false,"error":"CredentialsSignin"}""")
        try { auth.login("a@b.c", "bad"); fail() } catch (e: ApiError) {
            assertTrue(e is ApiError.Http && e.status == 401)
        }
        assertNull(store.current)
        assertTrue(events.isEmpty())
    }

    @Test fun expiredSessionEndsNotDeliberately() = runTest {
        store.save(Session("T", "c", "u1"))
        reply(401, "{}")
        try { api.get("/api/user/profile", JsonObject.serializer()); fail() } catch (_: ApiError.Unauthorized) {}
        assertNull(store.current)
        assertEquals(listOf("out:u1:false"), events)
    }

    @Test fun staleRefusalDoesNotSignOutNewSession() {
        store.save(Session("NEW", "c", "u2"))
        auth.sessionEnded(Session("OLD", "c", "u1"))
        assertEquals("NEW", store.current?.token)
    }

    @Test fun logoutIsDeliberate() {
        store.save(Session("T", "c", "u1"))
        auth.signOut()
        assertNull(store.current)
        assertEquals(listOf("out:u1:true"), events)
    }

    // Berlin 29 Sep (iOS f068bbf): logout revokes the token on the server with the session's own
    // cookie; the answer (404 while the route is new, 401, offline) never ends or blocks anything.
    @Test fun appLogoutCarriesTheOldCookieAndItsAnswerIsIgnored() = runTest {
        val old = Session("oldtok", "c", "u1")
        server.enqueue(MockResponse.Builder().code(404).body("""{"error":"Not found"}""").build())
        runCatching { auth.revokeOnServer(old) }
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/auth/app-logout", req.url.encodedPath)
        assertEquals("c=oldtok", req.headers["Cookie"])
        server.enqueue(MockResponse.Builder().code(401).body("""{"error":"Unauthorized"}""").build())
        store.save(Session("newtok", "c", "u2"))
        runCatching { auth.revokeOnServer(old) }
        assertEquals("u2", store.current?.userId) // a 401 for the OLD session never signs the current one out
        assertTrue(events.none { it.startsWith("out:") })
    }
}
