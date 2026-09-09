import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version comes from the root package.json so the APK and the web app share one number.
val rootPackage = Properties().also { props ->
    val json = rootProject.file("../../package.json").readText()
    val version = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(json)?.groupValues?.get(1) ?: "0.0.0"
    props["version"] = version
}
val appVersion = rootPackage["version"] as String
val versionParts = appVersion.split("-")[0].split(".").map { it.toIntOrNull() ?: 0 }
val appVersionCode = versionParts.getOrElse(0) { 0 } * 10000 + versionParts.getOrElse(1) { 0 } * 100 + versionParts.getOrElse(2) { 0 }

val serverUrl: String = (project.findProperty("serverUrl") as String?) ?: "http://192.168.1.73:3001"

// Release signing: a keystore outside the repo, described by environment variables that
// deploy/release.mjs sets from deploy/release.env. Without them the release build is
// signed with the debug key, which installs fine on a Fire tablet but cannot be updated
// in place by a properly signed build later.
val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
val keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "bunny"

android {
    namespace = "studio.bunny.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "studio.bunny.app"
        // Fire OS 7 (2019 Fire HD 10) is Android 9 / API 28; Fire OS 8 is Android 11.
        minSdk = 26
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersion
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
    }

    signingConfigs {
        if (keystorePath != null && keystorePassword != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
}
