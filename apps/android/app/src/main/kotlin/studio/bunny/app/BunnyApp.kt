package studio.bunny.app

import android.app.Application
import android.content.Context
import android.content.SharedPreferences

class BunnyApp : Application() {
    val settings: SharedPreferences by lazy { getSharedPreferences("bunny", Context.MODE_PRIVATE) }

    /** The studio address: the value saved in-app, else the one baked in at build time. */
    var serverUrl: String
        get() = settings.getString(KEY_SERVER_URL, null)?.takeIf { it.isNotBlank() } ?: BuildConfig.SERVER_URL
        set(value) = settings.edit().putString(KEY_SERVER_URL, value.trim().trimEnd('/')).apply()

    fun resetServerUrl() = settings.edit().remove(KEY_SERVER_URL).apply()

    companion object {
        const val KEY_SERVER_URL = "server_url"
    }
}
