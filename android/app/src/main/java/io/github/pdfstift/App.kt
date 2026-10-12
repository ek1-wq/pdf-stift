package io.github.pdfstift

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Crash.init(this)
        Edge.init(this)
        Monitor.init(this)
        Api.init(this)
        Store.init(this)
        Images.init(this)
        Thumbs.init(this)
        Meta.load()
        PrefSync.init()
        Burn.appCtx = applicationContext
        com.tom_roush.pdfbox.android.PDFBoxResourceLoader.init(applicationContext)
    }
}
