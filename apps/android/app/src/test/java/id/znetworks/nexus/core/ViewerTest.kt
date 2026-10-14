package id.znetworks.nexus.core

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ViewerTest {
    private lateinit var server: MockWebServer
    private lateinit var viewer: Viewer
    @Before fun setUp() {
        server = MockWebServer(); server.start()
        viewer = Viewer(ApiClient(server.url("/"), ClientIdentity("0.1.6", 6, 36), { Session("t", "c", "u") }, mayCarrySession = { true }))
    }
    @After fun tearDown() { server.close() }

    // owner 29 Sep (iOS 14b086f): Z Vault and Threads only for the company workspace; unknown = hidden.
    @Test fun companyFlagFromTheRoster() = runTest {
        assertNull(viewer.isCompany); assertFalse(viewer.isCompanyMember)
        server.enqueue(MockResponse.Builder().code(200).body("""{"role":"STAFF","isCompany":true,"members":[]}""").build())
        assertEquals("STAFF", viewer.load())
        assertTrue(viewer.isCompanyMember)
        viewer.reset(); assertNull(viewer.isCompany)
        server.enqueue(MockResponse.Builder().code(200).body("""{"role":"ONE_ABOVE_ALL","isCompany":false}""").build())
        viewer.load(); assertFalse(viewer.isCompanyMember)
    }

    // Legal is by invitation (owner, 14 Oct 2026): the roster's canAccessLegal draws the entry; absent = no entry.
    @Test fun legalFlagFromTheRoster() = runTest {
        assertFalse(viewer.canAccessLegal)
        server.enqueue(MockResponse.Builder().code(200).body("""{"role":"STAFF","isCompany":true,"canAccessLegal":true}""").build())
        viewer.load(); assertTrue(viewer.canAccessLegal)
        viewer.reset(); assertFalse(viewer.canAccessLegal)
        server.enqueue(MockResponse.Builder().code(200).body("""{"role":"BOD","isCompany":true}""").build())
        viewer.load(); assertFalse(viewer.canAccessLegal)
    }

    @Test fun olderServerWithoutTheFieldKeepsThemHidden() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"role":"BOD"}""").build())
        viewer.load()
        assertTrue(viewer.isBoD); assertNull(viewer.isCompany); assertFalse(viewer.isCompanyMember)
    }
}
