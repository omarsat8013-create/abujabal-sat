#!/bin/bash
set -e
SDK=/tmp/sdk
BT=$SDK/bt/android-14
JAVA_HOME=$SDK/jdk-17.0.21.1+2
AJAR=$SDK/plat/android-34/android.jar
REPO=${REPO:-/tmp/repo}
OUT=${OUT:-/tmp/out}
KS=${KS:-/tmp/android/abujabal-release.jks}
KSPASS=${KSPASS:-$(cat /tmp/android/.kspass)}
cd /tmp/android
rm -rf build gen obj dex assets/www
mkdir -p build gen obj dex assets/www/vendor $OUT
cp $REPO/index.html $REPO/lab.js $REPO/satdb.json $REPO/manifest.webmanifest $REPO/sw.js $REPO/version.json $REPO/version.js assets/www/
cp $REPO/icon-192.png $REPO/icon-512.png $REPO/apple-touch-icon.png $REPO/hero.jpg assets/www/
cp $REPO/vendor/* assets/www/vendor/
python3 - <<'PY'
import io
p='/tmp/android/assets/www/index.html'
s=io.open(p,encoding='utf-8').read()
s=s.replace('"dl/','"https://omarsat8013-create.github.io/abujabal-sat/dl/')
s=s.replace("'dl/","'https://omarsat8013-create.github.io/abujabal-sat/dl/")
s=s.replace('dl/\'','https://omarsat8013-create.github.io/abujabal-sat/dl/\'')
s=s.replace('<head>','<head>\n<!-- نسخة مضمومة جوه التطبيق (assets/www): محتوى محلي، والملفات بتتحمّل من السيرفر -->\n<script>window.AJS_BUNDLED=true;</script>',1)
io.open(p,'w',encoding='utf-8').write(s)
print('bundled copy written')
PY
$BT/aapt2 compile --dir res -o build/res.zip
$BT/aapt2 link -o build/base.apk -I $AJAR --manifest AndroidManifest.xml -R build/res.zip \
  --java gen --min-sdk-version 21 --target-sdk-version 34 --version-code 43 --version-name 3.2.3 -A assets --auto-add-overlay
$JAVA_HOME/bin/javac -encoding UTF-8 -nowarn -source 8 -target 8 -bootclasspath $AJAR -d obj $(find src gen -name '*.java')
$BT/d8 --lib $AJAR --min-api 21 --release --output dex $(find obj -name '*.class')
cp build/base.apk build/unaligned.apk
(cd dex && zip -q -X /tmp/android/build/unaligned.apk classes.dex)
$BT/zipalign -f 4 build/unaligned.apk build/aligned.apk
$BT/apksigner sign --ks $KS --ks-pass pass:$KSPASS --key-pass pass:$KSPASS --min-sdk-version 21 \
  --out $OUT/AbuJabalSat-3.2.3-webview.apk build/aligned.apk
$BT/apksigner verify --print-certs $OUT/AbuJabalSat-3.2.3-webview.apk | head -5
ls -la $OUT
