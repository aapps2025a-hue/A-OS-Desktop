plugins {
    id("com.android.application")
}

fun escapedBuildConfig(value: String): String = "\"" + value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"") + "\""

val storeApplicationId = providers.gradleProperty("astoreApplicationId").orElse("com.aapps.storeapp.preview")
val storeAppName = providers.gradleProperty("astoreAppName").orElse("A-Store App")
val storeVersionCode = providers.gradleProperty("astoreVersionCode").orElse("1")
val storeVersionName = providers.gradleProperty("astoreVersionName").orElse("1.0.0")
val storeStartUrl = providers.gradleProperty("astoreStartUrl").orElse("")
val keyStorePath = providers.environmentVariable("ASTORE_KEYSTORE_PATH").orNull
val keyStorePassword = providers.environmentVariable("ASTORE_KEYSTORE_PASSWORD").orNull
val keyAliasName = providers.environmentVariable("ASTORE_KEY_ALIAS").orNull
val keyPasswordValue = providers.environmentVariable("ASTORE_KEY_PASSWORD").orNull

android {
    namespace = "com.aapps.storeapp"
    compileSdk = 36

    defaultConfig {
        applicationId = storeApplicationId.get()
        minSdk = 24
        targetSdk = 36
        versionCode = storeVersionCode.get().toInt()
        versionName = storeVersionName.get()
        resValue("string", "app_name", storeAppName.get())
        buildConfigField("String", "START_URL", escapedBuildConfig(storeStartUrl.get()))
    }

    signingConfigs {
        if (keyStorePath != null && keyStorePassword != null && keyAliasName != null && keyPasswordValue != null) {
            create("storeRelease") {
                storeFile = file(keyStorePath)
                storePassword = keyStorePassword
                keyAlias = keyAliasName
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("storeRelease")
        }
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    sourceSets["main"].assets.srcDir(file("build/generated/astore/assets"))
    sourceSets["main"].res.srcDir(file("build/generated/astore/res"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
