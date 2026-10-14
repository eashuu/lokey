plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// No dependencies on purpose: plain Android framework APIs only, so the prototype builds with nothing to fetch but the toolchain.
android {
    namespace = "app.lokey.link"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.lokey.link"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
