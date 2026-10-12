package io.github.pdfstift

import android.app.Activity
import android.app.Application
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import java.lang.ref.WeakReference

/**
 * Monitor oder Beamer angeschlossen (Bild gespiegelt): Das Tablet läuft oft mit 120 Bildern/s, der Monitor mit 60.
 * Beim Spiegeln fallen dann unregelmäßig Bilder weg – Blättern ruckelt auf dem Monitor.
 * Solange ein zweiter Bildschirm dran ist, läuft das Tablet deshalb im Takt des Monitors; danach wieder wie vorher.
 */
object Monitor : Application.ActivityLifecycleCallbacks, DisplayManager.DisplayListener {
    private var dm: DisplayManager? = null
    private var top: WeakReference<Activity>? = null

    fun init(app: Application) {
        dm = app.getSystemService(DisplayManager::class.java)
        app.registerActivityLifecycleCallbacks(this)
        try { dm?.registerDisplayListener(this, Handler(Looper.getMainLooper())) } catch (e: Throwable) { }
    }

    /** Bildfrequenz des zweiten Bildschirms, 0 = keiner angeschlossen */
    private fun externalRate(): Float = try {
        dm?.displays?.firstOrNull { it.displayId != Display.DEFAULT_DISPLAY }?.refreshRate ?: 0f
    } catch (e: Throwable) { 0f }

    private fun apply(a: Activity) {
        val rate = externalRate()
        val w = a.window ?: return
        val lp = w.attributes
        val main = try { a.windowManager.defaultDisplay } catch (e: Throwable) { null }
        // passenden Modus des Tablets wählen (gleiche Auflösung, Frequenz am nächsten an der des Monitors)
        val mode = if (rate > 0f && main != null) main.supportedModes
            .filter { it.physicalWidth == main.mode.physicalWidth && it.physicalHeight == main.mode.physicalHeight }
            .minByOrNull { kotlin.math.abs(it.refreshRate - rate) } else null
        val id = mode?.modeId ?: 0
        if (lp.preferredDisplayModeId != id) { lp.preferredDisplayModeId = id; w.attributes = lp }
    }

    override fun onDisplayAdded(displayId: Int) { top?.get()?.let { apply(it) } }
    override fun onDisplayRemoved(displayId: Int) { top?.get()?.let { apply(it) } }
    override fun onDisplayChanged(displayId: Int) { if (displayId != Display.DEFAULT_DISPLAY) top?.get()?.let { apply(it) } }

    override fun onActivityResumed(a: Activity) { top = WeakReference(a); apply(a) }
    override fun onActivityCreated(a: Activity, b: Bundle?) {}
    override fun onActivityStarted(a: Activity) {}
    override fun onActivityPaused(a: Activity) {}
    override fun onActivityStopped(a: Activity) {}
    override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
    override fun onActivityDestroyed(a: Activity) {}
}
