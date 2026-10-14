package app.lokey.link

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** secret.get / secret.set / secret.clear: API keys, sealed with an AES-GCM key that lives in the Android Keystore (never leaves the secure hardware or TEE). */
object Secrets {
    private const val ALIAS = "lokey_secrets_v1"
    private val file get() = App.ctx.getSharedPreferences("lokey_secrets", android.content.Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return g.generateKey()
    }

    fun seal(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray()), Base64.NO_WRAP)
    }

    fun open(sealed: String): String {
        val b = Base64.decode(sealed, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b, 0, 12))
        return String(c.doFinal(b, 12, b.size - 12))
    }

    private fun name(p: org.json.JSONObject) = p.str("name").ifEmpty { p.str("key") }.ifEmpty { p.str("ref") }.ifEmpty { throw Fail("missing param: name") }

    fun methods(): Map<String, H> = mapOf(
        "secret.get" h { p ->
            val s = file.getString(name(p), null)
            // a sealed value that cannot be opened (key lost after a restore or lock-screen reset) is treated as not set
            obj("value" to s?.let { runCatching { open(it) }.getOrNull() })
        },
        "secret.set" h { p -> file.edit().putString(name(p), seal(p.str("value"))).apply(); ok() },
        "secret.clear" h { p -> val n = p.str("name").ifEmpty { p.str("key") }; file.edit().apply { if (n.isEmpty()) clear() else remove(n) }.apply(); ok() },
        "secret.list" h { arr(file.all.keys.sorted()) },
    )
}
