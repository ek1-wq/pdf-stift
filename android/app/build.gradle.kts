plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version wie im Desktop-Programm: 1.2.3 → versionCode 10203
val vName = System.getenv("PDFSTIFT_VERSION") ?: "1.0.0"
val vCode = vName.split(".").map { it.toIntOrNull() ?: 0 }.let { it[0] * 10000 + it.getOrElse(1) { 0 } * 100 + it.getOrElse(2) { 0 } }

android {
    namespace = "io.github.pdfstift"
    compileSdk = 36
    defaultConfig {
        applicationId = "io.github.pdfstift"
        minSdk = 26
        targetSdk = 36
        versionCode = vCode
        versionName = vName
        buildConfigField("boolean", "PLAY", "false") // Google-Play-Ausgabe: kein eigener Update-Knopf
    }
    signingConfigs {
        create("release") {
            // Schlüssel aus den Geheimnissen des Repositorys (ANDROID_KEYSTORE, ANDROID_KEYSTORE_PASSWORD)
            storeFile = file(System.getenv("ANDROID_KEYSTORE_FILE") ?: "release.jks")
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
            keyAlias = "pdfstift"
            keyPassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug { }
    }
    flavorDimensions += "store"
    productFlavors {
        create("github") { dimension = "store" }
        create("play") { dimension = "store"; buildConfigField("boolean", "PLAY", "true") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
    implementation("io.legere:pdfiumandroid:1.0.+")
    implementation("androidx.graphics:graphics-core:1.0.+")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("com.google.zxing:core:3.5.3")
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
