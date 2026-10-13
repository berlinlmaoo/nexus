package id.znetworks.nexus.core.net

import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class LanRouteTest {
    private lateinit var public: MockWebServer
    private lateinit var lan: MockWebServer
    private var lanUp = true
    private lateinit var route: LanRoute
    private lateinit var api: ApiClient

    @Before fun setUp() {
        public = MockWebServer().apply { start() }
        lan = MockWebServer().apply { start() }
        route = LanRoute(
            toLan = { url -> if (url.port == public.port) url.newBuilder().port(lan.port).build() else null },
            probe = { lanUp },
            scope = CoroutineScope(Dispatchers.Unconfined),
        )
        api = ApiClient(public.url("/"), ClientIdentity("0.1.6", 1, 30), { Session("t", "c", "u") }, mayCarrySession = { true },
            routeInterceptor = route.interceptor)
    }

    @After fun tearDown() { public.close(); runCatching { lan.close() } }

    private fun ok(server: MockWebServer) = server.enqueue(MockResponse.Builder().code(200).body("{}").build())

    @Test fun cellularNeverUsesLan() = runTest {
        route.onNetwork(wifiOrEthernet = false)
        ok(public)
        api.get("/api/x", JsonObject.serializer())
        assertEquals(1, public.requestCount)
        assertEquals(0, lan.requestCount)
    }

    @Test fun officeWifiGoesOverLanWithTheSameHeaders() = runTest {
        route.onNetwork(true)
        assertTrue(route.active)
        ok(lan)
        api.get("/api/x", JsonObject.serializer())
        val req = lan.takeRequest()
        assertEquals("android/0.1.6/1", req.headers["X-Nexus-Client"])
        assertEquals("c=t", req.headers["Cookie"])
        assertEquals(0, public.requestCount)
    }

    @Test fun failedProbeStaysPublic() = runTest {
        lanUp = false
        route.onNetwork(true)
        assertFalse(route.active)
        ok(public)
        api.get("/api/x", JsonObject.serializer())
        assertEquals(1, public.requestCount)
    }

    @Test fun deadLanDemotesAndReplaysAGet() = runTest {
        route.onNetwork(true)
        lan.close()
        ok(public)
        api.get("/api/x", JsonObject.serializer())
        assertEquals(1, public.requestCount)
        assertFalse(route.active)
    }

    @Test fun postIsReplayedOnlyWhenItNeverLeft() = runTest {
        route.onNetwork(true)
        lan.close() // connection refused: the body never reached anyone
        ok(public)
        api.send(Request.Builder().url(api.url("/api/attendance/check-in")).post("x".toRequestBody()).build(), JsonObject.serializer())
        assertEquals(1, public.requestCount)
    }

    @Test fun postDroppedMidwayIsNotReplayed() = runTest {
        route.onNetwork(true)
        // The LAN accepted the request and then hung up: the server may have acted. No second check-in.
        lan.enqueue(MockResponse.Builder().onRequestStart(SocketEffect.CloseSocket()).build())
        try {
            api.send(Request.Builder().url(api.url("/api/attendance/check-in")).post("x".toRequestBody()).build(), JsonObject.serializer())
            fail()
        } catch (e: ApiError.Transport) {
            // Surfaces as "nobody answered", which the attendance queue keeps under the same id.
        }
        assertEquals(0, public.requestCount)
        assertFalse(route.active)
    }
}
