package id.znetworks.nexus.core.net

import android.content.Context
import android.content.Intent

/**
 * Settings › Server (DEV-REDESIGN.md, 12 Oct 2026): Production or the redesign's DEV server. The
 * choice is read once when the process starts; switching signs out and relaunches the app, so no
 * client, cache or socket built for one server ever talks to the other.
 */
object ServerEnvStore {
    private const val PREFS = "server_env"
    private const val KEY = "env"

    /** Before the AppContainer is built: every client reads NexusConfig.env. */
    fun load(context: Context): ServerEnv =
        ServerEnv.of(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)).also { NexusConfig.env = it }

    /** Written synchronously: the process ends right after. */
    fun save(context: Context, env: ServerEnv) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, env.key).commit()
    }

    /** A fresh process on the launcher activity; the new one loads the saved server. */
    fun relaunch(context: Context) {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        intent?.let(context::startActivity)
        Runtime.getRuntime().exit(0)
    }
}
