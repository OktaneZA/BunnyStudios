package studio.bunny.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * The whole app is one WebView showing the studio served by the NAS. Everything the teen sees
 * is the web app, so design and behaviour stay identical to the browser and every server
 * release updates the tablet with no new APK. This activity adds only what a browser tab
 * lacks: an icon and splash, landscape, native confirm dialogs (the web app uses confirm()
 * for "move to the bin"), the back button, and an offline screen with the address setting.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var splash: View
    private lateinit var offline: View
    private lateinit var offlineAddress: TextView
    private val app get() = application as BunnyApp
    private var mainFrameFailed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        web = findViewById(R.id.web)
        splash = findViewById(R.id.splash)
        offline = findViewById(R.id.offline)
        offlineAddress = findViewById(R.id.offline_address)
        findViewById<Button>(R.id.retry).setOnClickListener { load() }
        findViewById<Button>(R.id.change_address).setOnClickListener { showAddressDialog() }
        splash.setOnLongClickListener { showAddressDialog(); true }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage holds the sign-in token
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)             // the layout is responsive; pinch-zoom only breaks the board
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100                    // ignore the system font scale so cards keep their proportions
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString BunnyStudiosApp/${BuildConfig.VERSION_NAME}"
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.setBackgroundColor(getColor(R.color.brand_navy))

        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                mainFrameFailed = false
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!mainFrameFailed) showWeb()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // Sub-resource failures (an image, a fetch) are the web app's business; only a
                // failed main frame means the studio itself is unreachable.
                if (request.isForMainFrame) {
                    mainFrameFailed = true
                    showOffline()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val home = Uri.parse(app.serverUrl)
                val sameStudio = url.host.equals(home.host, ignoreCase = true) && url.port == home.port
                if (sameStudio) return false
                // Anything else (a help link, say) opens in the tablet's browser, not inside the app.
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // Without these, confirm() silently returns false and "Delete this cartoon" would do nothing.
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
                    .setNegativeButton(R.string.cancel) { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
                    .setOnCancelListener { result.confirm() }
                    .show()
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.visibility == View.VISIBLE && web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else load()
    }

    private fun load() {
        offline.visibility = View.GONE
        splash.visibility = View.VISIBLE
        web.loadUrl(app.serverUrl)
    }

    private fun showWeb() {
        splash.visibility = View.GONE
        offline.visibility = View.GONE
        web.visibility = View.VISIBLE
    }

    private fun showOffline() {
        offlineAddress.text = getString(R.string.offline_address, app.serverUrl)
        web.visibility = View.INVISIBLE
        splash.visibility = View.GONE
        offline.visibility = View.VISIBLE
    }

    /**
     * Where the studio lives. Baked in at build time (gradle -PserverUrl=…), changeable here for
     * a move to a production address without a new APK. Validated to an http(s) URL only.
     */
    private fun showAddressDialog() {
        val input = EditText(this).apply {
            hint = getString(R.string.address_hint)
            setText(app.serverUrl)
            setSingleLine()
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSelection(text.length)
        }
        val padding = (20 * resources.displayMetrics.density).toInt()
        val container = android.widget.FrameLayout(this).apply {
            setPadding(padding, padding / 2, padding, 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.address_title)
            .setMessage(R.string.address_help)
            .setView(container)
            .setPositiveButton(R.string.save) { _, _ ->
                val value = input.text.toString().trim()
                val ok = Uri.parse(value).let { (it.scheme == "http" || it.scheme == "https") && !it.host.isNullOrBlank() }
                if (ok) { app.serverUrl = value; load() }
                else AlertDialog.Builder(this).setMessage(R.string.address_invalid).setPositiveButton(R.string.ok, null).show()
            }
            .setNeutralButton(R.string.address_reset) { _, _ -> app.resetServerUrl(); load() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.statusBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
