package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ChatGroupPhotoApiTest {
    private lateinit var server: MockWebServer
    private lateinit var chat: ChatApi

    @Before fun setUp() {
        ChatAvatars.clear()
        server = MockWebServer(); server.start()
        chat = ChatApi(ApiClient(
            baseUrl = server.url("/"), identity = ClientIdentity("0.1.7", 14, 34),
            sessionProvider = { Session("test-session", "nexus.session", "member") },
            mayCarrySession = { true },
        ))
    }

    @After fun tearDown() { server.close(); ChatAvatars.clear() }

    @Test fun uploadSendsAvatarJpegAndDecodesSparseOpaqueUrl() = runTest {
        val url = "/api/files/avatars/group-c-1761100000000.jpg?t=1761100000000"
        server.enqueue(MockResponse.Builder().code(200).body("""{"conversation":{"id":"c","avatarUrl":"$url"},"url":"$url"}""").build())
        val updated = chat.uploadGroupAvatar("c", "jpeg test payload".toByteArray())
        assertEquals("c", updated.id)
        assertEquals(url, updated.avatarUrl)
        assertEquals(url, ChatAvatars.resolve("c", "old-photo"))
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/conversations/c/avatar", request.target)
        assertEquals("nexus.session=test-session", request.headers["Cookie"])
        assertTrue(request.headers["Content-Type"].orEmpty().startsWith("multipart/form-data; boundary="))
        val body = request.body!!.utf8()
        assertTrue(body.contains("name=\"file\"; filename=\"avatar.jpg\""))
        assertTrue(body.contains("Content-Type: image/jpeg"))
        assertTrue(body.contains("jpeg test payload"))
    }

    @Test fun removalUsesDeleteAndAcceptsSparseNullPhoto() = runTest {
        ChatAvatars.changed("c", "old-photo")
        server.enqueue(MockResponse.Builder().code(200).body("""{"conversation":{"id":"c","avatarUrl":null}}""").build())
        val updated = chat.removeGroupAvatar("c")
        assertEquals("c", updated.id)
        assertNull(updated.avatarUrl)
        assertNull(ChatAvatars.resolve("c", "old-photo"))
        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/api/conversations/c/avatar", request.target)
    }

    @Test fun serverUploadRefusalRemainsAnErrorAndIsNotRetried() = runTest {
        server.enqueue(MockResponse.Builder().code(400).body("""{"error":"File too large. Maximum size is 5MB","code":"TOO_LARGE"}""").build())
        val failure = runCatching { chat.uploadGroupAvatar("c", byteArrayOf(1)) }.exceptionOrNull()
        assertTrue(failure is ApiError.Http && failure.status == 400 && failure.code == "TOO_LARGE")
        assertEquals(1, server.requestCount)
    }
}
