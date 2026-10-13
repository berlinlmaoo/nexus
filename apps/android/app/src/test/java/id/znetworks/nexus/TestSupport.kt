package id.znetworks.nexus

import id.znetworks.nexus.core.session.SessionCipher

/** Reversible stand-in for the Keystore cipher on the JVM. */
class FakeCipher : SessionCipher {
    override fun seal(plain: ByteArray) = plain.map { (it.toInt() xor 0x5A).toByte() }.toByteArray()
    override fun open(sealed: ByteArray) = seal(sealed)
}
