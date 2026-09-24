import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "id.znetworks.nexus"
    compileSdk = 37

    defaultConfig {
        applicationId = "id.znetworks.nexus"
        minSdk = 26
        targetSdk = 36
        // Always three parts (the server rejects a tag without x.y.z). Android shares the iOS version
        // number (owner, 24 Sep 2026); versionCode counts Android builds on its own.
        versionCode = 1
        versionName = "0.1.6"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Release key lives OUTSIDE the repo (agents:~/.nexus-android-secrets, backup on the host's
    // /mnt/nexus-backup/android-signing). Losing it means no installed phone accepts an update, so
    // it is never committed. Override the location with NEXUS_KEYSTORE_PROPERTIES.
    val keystoreProps = File(
        System.getenv("NEXUS_KEYSTORE_PROPERTIES")
            ?: "${System.getProperty("user.home")}/.nexus-android-secrets/keystore.properties",
    )
    val releaseSigning = if (keystoreProps.exists()) {
        val p = Properties().apply { keystoreProps.inputStream().use { load(it) } }
        signingConfigs.create("release") {
            storeFile = File(p.getProperty("storeFile"))
            storePassword = p.getProperty("storePassword")
            keyAlias = p.getProperty("keyAlias")
            keyPassword = p.getProperty("keyPassword")
        }
    } else {
        null
    }

    // Firebase is configured from a file outside the repo (no google-services plugin), so the app
    // builds without it and push simply stays off until the owner's project values are there.
    // Keys: projectId, applicationId, apiKey, senderId. Location: NEXUS_FIREBASE_PROPERTIES or
    // ~/.nexus-android-secrets/firebase.properties.
    val firebaseProps = Properties().apply {
        val f = File(System.getenv("NEXUS_FIREBASE_PROPERTIES")
            ?: "${System.getProperty("user.home")}/.nexus-android-secrets/firebase.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    defaultConfig {
        listOf("projectId", "applicationId", "apiKey", "senderId").forEach { key ->
            buildConfigField("String", "FIREBASE_${key.uppercase()}", "\"${firebaseProps.getProperty(key, "")}\"")
        }
    }

    buildTypes {
        release {
            signingConfig = releaseSigning
            // Staff phones are ARM; the bundled ML Kit model ships native code per ABI, so leaving
            // out x86 roughly halves the APK. Debug keeps every ABI for the emulator.
            ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    androidResources {
        // English source + Indonesian overlay only (values-in = Android's code for "id").
        localeFilters += listOf("en", "in")
        generateLocaleConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.work.runtime)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    implementation(libs.play.services.location)
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    // Bundled model (not the Play-services download-on-demand one): liveness must work offline
    // and on the first launch (REQ-ATT-05).
    implementation(libs.mlkit.face)
    implementation(libs.androidx.exifinterface)
    // OpenStreetMap, same tiles as the web (owner: no Google Maps API).
    implementation(libs.osmdroid)
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
