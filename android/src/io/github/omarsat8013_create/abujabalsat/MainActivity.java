package io.github.omarsat8013_create.abujabalsat;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.webkit.URLUtil;

/**
 * ابوجبل سات - قشرة التطبيق للأندرويد.
 *
 * المحتوى نفسه مضموم جوه التطبيق (assets/www) فالتطبيق بيفتح دايماً على النسخة
 * اللي اتبنى بيها، مش على نسخة قديمة متخزنة في الكاش. الصفحة نفسها بتقارن رقم
 * بنيتها بالبنية المنشورة على السيرفر، ولو فيه أحدث بتنضّف الكاش وتحمّل الأحدث.
 */
public class MainActivity extends Activity {

    static final String APP_VER = "3.1.6";
    static final int APP_CODE = 36;
    static final String REMOTE_HOST_SUFFIX = "github.io";
    static final String REMOTE_BASE = "https://omarsat8013-create.github.io/abujabal-sat/";
    static final String FALLBACK_URL = "file:///android_asset/www/index.html";

    /**
     * العنوان اللي التطبيق بيفتحه. علامة الوقت في الآخر بتخلي كل فتحة عنوان جديد،
     * فأي كاش (كاش الويب أو service worker قديم) بيعمل miss وبيروح للنت،
     * ومستحيل التطبيق يفتح على نسخة قديمة متخزنة.
     */
    static String startUrl() {
        return REMOTE_BASE + "index.html?app=" + APP_CODE + "&t=" + System.currentTimeMillis();
    }

    private WebView web;
    private ValueCallback<Uri[]> fileCb;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setBuiltInZoomControls(false);

        web.addJavascriptInterface(new Bridge(), "AbuJabalBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u == null) return false;
                String host = u.getHost();
                String scheme = u.getScheme();
                if ("file".equals(scheme)) return false;
                if (host != null && host.endsWith(REMOTE_HOST_SUFFIX)) return false; // جوّه التطبيق
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception e) { /* مفيش تطبيق يفتح الرابط */ }
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, android.webkit.WebResourceError err) {
                // لو النت قطع والصفحة الأساسية مش بتحمّل: نفتح النسخة المضمومة جوه التطبيق
                if (req != null && req.isForMainFrame()) {
                    if (Build.VERSION.SDK_INT >= 23 && err != null && err.getErrorCode() != ERROR_HOST_LOOKUP
                            && err.getErrorCode() != ERROR_CONNECT && err.getErrorCode() != ERROR_TIMEOUT) {
                        return;
                    }
                    if (v.getUrl() != null && v.getUrl().startsWith("file://")) return;
                    v.loadUrl(FALLBACK_URL);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                if (params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                if (params != null && params.getAcceptTypes() != null && params.getAcceptTypes().length > 0
                        && params.getAcceptTypes()[0] != null && params.getAcceptTypes()[0].length() > 0) {
                    i.setType(params.getAcceptTypes()[0]);
                }
                try {
                    startActivityForResult(Intent.createChooser(i, "اختار ملف"), 1001);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                WebView child = new WebView(MainActivity.this);
                child.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        Uri u = req.getUrl();
                        if (u != null && u.getHost() != null && u.getHost().endsWith(REMOTE_HOST_SUFFIX)) {
                            if (web != null) web.loadUrl(u.toString());
                            return true;
                        }
                        return false;
                    }
                });
                WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
                t.setWebView(child);
                resultMsg.sendToTarget();
                return true;
            }
        });

        web.setDownloadListener(new android.webkit.DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    downloadHttp(url, ua, cd, mime);
                }
            }
        });

        // أول تشغيل بعد تحديث: نمسح كاش الويب (مش بيانات المستخدم)
        try {
            int vc;
            if (Build.VERSION.SDK_INT >= 28) {
                vc = (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
            } else {
                vc = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            }
            SharedPreferences sp = getSharedPreferences("ajs", MODE_PRIVATE);
            if (sp.getLong("vc", -1) != vc) {
                web.clearCache(true);
                sp.edit().putLong("vc", vc).apply();
            }
        } catch (Exception e) { /* مش مشكلة */ }

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(startUrl());
        }
        Toast.makeText(this, "ابوجبل سات " + APP_VER + " · بنية " + APP_CODE, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            // الصفحة المضمومة بتقارن نفسها بالسيرفر ولو فيه أحدث بتنضّف وتحمّل
            web.evaluateJavascript("if(window.__ajsCheckUpdate){window.__ajsCheckUpdate(false);}", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != 1001) return;
        if (fileCb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                out = new Uri[n];
                for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                out = new Uri[]{data.getData()};
            }
        }
        fileCb.onReceiveValue(out);
        fileCb = null;
    }

    /** الجسر اللي الصفحة بتستخدمه لحفظ الملفات في مجلد التنزيلات. */
    public class Bridge {
        @JavascriptInterface
        public void saveFile(String base64, String name) {
            boolean ok = false;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                ok = saveToDownloads(name, bytes);
            } catch (Exception e) {
                ok = false;
            }
            final boolean fok = ok;
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Toast.makeText(MainActivity.this, fok ? "اتحفظ الملف في التنزيلات" : "مش قادر أحفظ الملف",
                            Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    private String safeName(String name) {
        if (name == null || name.length() == 0) return "abujabal-file.bin";
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private boolean saveToDownloads(String name, byte[] bytes) {
        String n = safeName(name);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, n);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return false;
                OutputStream os = getContentResolver().openOutputStream(uri);
                os.write(bytes);
                os.close();
                return true;
            }
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            dir.mkdirs();
            FileOutputStream fos = new FileOutputStream(new File(dir, n));
            fos.write(bytes);
            fos.close();
            return true;
        } catch (Exception e) {
            Log.w("AbuJabal", "save failed: " + e);
            return false;
        }
    }

    private void downloadHttp(final String url, final String ua, final String cd, final String mime) {
        final String name = URLUtil.guessFileName(url, cd, mime);
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Toast.makeText(MainActivity.this, "بدأ التحميل: " + name, Toast.LENGTH_SHORT).show();
            }
        });
        new Thread(new Runnable() {
            @Override public void run() {
                boolean ok = false;
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setRequestProperty("User-Agent", ua == null ? "AbuJabalSat" : ua);
                    c.setInstanceFollowRedirects(true);
                    c.connect();
                    InputStream in = c.getInputStream();
                    byte[] buf = new byte[65536];
                    if (Build.VERSION.SDK_INT >= 29) {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName(name));
                        cv.put(MediaStore.MediaColumns.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
                        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                        if (uri != null) {
                            OutputStream os = getContentResolver().openOutputStream(uri);
                            int r;
                            while ((r = in.read(buf)) > 0) os.write(buf, 0, r);
                            os.close();
                            ok = true;
                        }
                    } else {
                        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        dir.mkdirs();
                        FileOutputStream fos = new FileOutputStream(new File(dir, safeName(name)));
                        int r;
                        while ((r = in.read(buf)) > 0) fos.write(buf, 0, r);
                        fos.close();
                        ok = true;
                    }
                    in.close();
                } catch (Exception e) {
                    ok = false;
                } finally {
                    if (c != null) c.disconnect();
                }
                final boolean fok = ok;
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        Toast.makeText(MainActivity.this,
                                fok ? "اتحفظ في التنزيلات: " + name : "فشل التحميل: " + name,
                                fok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
                    }
                });
            }
        }).start();
    }
}
