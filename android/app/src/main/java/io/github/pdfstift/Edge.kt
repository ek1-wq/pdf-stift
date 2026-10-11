package io.github.pdfstift

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Ab Android 15 zeichnen Apps bis unter Statusleiste und Navigationsleiste („edge-to-edge“).
 * Damit nichts unter den Leisten verschwindet, rückt jede Seite ihren Inhalt um die Leisten ein;
 * die Leisten selbst bleiben dunkelblau wie bisher. Auf älteren Android-Versionen sieht es genauso aus.
 */
object Edge : Application.ActivityLifecycleCallbacks {
    fun init(app: Application) = app.registerActivityLifecycleCallbacks(this)

    override fun onActivityStarted(a: Activity) {
        val content = a.findViewById<View>(android.R.id.content) ?: return
        if (content.getTag(R.id.edge_done) != null) return
        content.setTag(R.id.edge_done, true)
        val w = a.window
        WindowCompat.setDecorFitsSystemWindows(w, false)
        @Suppress("DEPRECATION")
        run { w.statusBarColor = android.graphics.Color.TRANSPARENT; w.navigationBarColor = android.graphics.Color.TRANSPARENT }
        w.decorView.setBackgroundColor(ContextCompat.getColor(a, R.color.navy))
        if (content.background == null) content.setBackgroundColor(ContextCompat.getColor(a, R.color.bg))
        WindowCompat.getInsetsController(w, w.decorView).apply { isAppearanceLightStatusBars = false; isAppearanceLightNavigationBars = false }
        val resize = (w.attributes.softInputMode and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST) == WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        ViewCompat.setOnApplyWindowInsetsListener(content) { v, ins ->
            val s = ins.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = if (resize) ins.getInsets(WindowInsetsCompat.Type.ime()).bottom else 0
            (v.layoutParams as? ViewGroup.MarginLayoutParams)?.let { lp ->
                val b = maxOf(s.bottom, ime)
                if (lp.leftMargin != s.left || lp.topMargin != s.top || lp.rightMargin != s.right || lp.bottomMargin != b) {
                    lp.setMargins(s.left, s.top, s.right, b); v.layoutParams = lp
                }
            }
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(content)
    }

    override fun onActivityCreated(a: Activity, b: Bundle?) {}
    override fun onActivityResumed(a: Activity) {}
    override fun onActivityPaused(a: Activity) {}
    override fun onActivityStopped(a: Activity) {}
    override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
    override fun onActivityDestroyed(a: Activity) {}
}
