package id.znetworks.nexus.core.session

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Seals and opens the stored session. Split out so the store can be tested on the JVM. */
interface SessionCipher {
    fun seal(plain: ByteArray): ByteArray
    fun open(sealed: ByteArray): ByteArray
}

/**
 * Keeps the session as one encrypted blob in `noBackupFilesDir`, so it is never part of Auto
 * Backup or a device transfer (a restored token would sign the next phone in as this person).
 * Reads are synchronous on purpose: the first frame must already know whether someone is signed in.
 */
class SessionStore(private val file: File, private val cipher: SessionCipher) {

    private val _session = MutableStateFlow(load())
    val session: StateFlow<Session?> = _session.asStateFlow()

    val current: Session? get() = _session.value

    @Synchronized
    fun save(session: Session) {
        val bytes = cipher.seal(NexusJson.encodeToString(Session.serializer(), session).toByteArray())
        file.parentFile?.mkdirs()
        // Write-then-rename so a crash mid-write never leaves half a session behind.
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
        _session.value = session
    }

    @Synchronized
    fun clear() {
        file.delete()
        _session.value = null
    }

    private fun load(): Session? = runCatching {
        if (!file.exists()) return null
        NexusJson.decodeFromString(Session.serializer(), String(cipher.open(file.readBytes())))
    }.getOrElse {
        // An unreadable blob (key lost after a restore, corrupted file) is a signed-out state,
        // not a crash loop.
        file.delete()
        null
    }
}

/** AES-256-GCM with a non-exportable key in the Android Keystore (StrongBox when available). */
class KeystoreSessionCipher(private val alias: String = "nexus.session.v1") : SessionCipher {

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        fun generate(strongBox: Boolean): SecretKey {
            val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .apply { if (strongBox && android.os.Build.VERSION.SDK_INT >= 28) setIsStrongBoxBacked(true) }
                .build()
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                .apply { init(spec) }.generateKey()
        }
        return runCatching { generate(strongBox = true) }.getOrElse { generate(strongBox = false) }
    }

    override fun seal(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val iv = c.iv
        return byteArrayOf(iv.size.toByte()) + iv + c.doFinal(plain)
    }

    override fun open(sealed: ByteArray): ByteArray {
        val ivLen = sealed[0].toInt()
        val iv = sealed.copyOfRange(1, 1 + ivLen)
        val c = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
        return c.doFinal(sealed, 1 + ivLen, sealed.size - 1 - ivLen)
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
