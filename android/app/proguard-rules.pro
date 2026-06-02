# --- wolit Android R8/ProGuard rules ---

# bitcoinj reflects over generated protobuf classes and uses BouncyCastle.
-keep class org.bitcoinj.** { *; }
-dontwarn org.bitcoinj.**
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**

# Guava (a bitcoinj dependency) references optional/desktop-only classes.
-dontwarn java.lang.SafeVarargs
-dontwarn javax.annotation.**
-dontwarn sun.misc.**
-dontwarn org.slf4j.**

# Google Play services auth.
-keep class com.google.android.gms.auth.** { *; }
-dontwarn com.google.android.gms.**

# ZXing.
-dontwarn com.google.zxing.**
