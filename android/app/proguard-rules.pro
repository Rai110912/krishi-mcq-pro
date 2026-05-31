# ============================================================
# Krishi MCQ Pro — ProGuard Rules (Safe for Capacitor + Firebase)
# ============================================================

# --- Capacitor WebView Bridge (CRITICAL — must not be obfuscated) ---
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.annotation.** { *; }
-keepnames class com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.CapacitorPlugin <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}

# --- WebView JavaScript Interface (prevents JS bridge from breaking) ---
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- Firebase (Auth, Realtime DB, Analytics, FCM) ---
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod

# --- AndroidX / AppCompat ---
-keep class androidx.** { *; }
-keep interface androidx.** { *; }

# --- SQLite Plugin ---
-keep class com.capacitorjs.capacitorsqlite.** { *; }
-keep class io.ionic.sqlite.** { *; }

# --- Haptics, StatusBar, App plugins ---
-keep class com.capacitorjs.plugins.** { *; }

# --- Keep R classes (resources) ---
-keepclassmembers class **.R$* {
    public static <fields>;
}

# --- Preserve source info for crash reports ---
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- App-specific MainActivity ---
-keep class com.krishimcqpro.app.** { *; }
