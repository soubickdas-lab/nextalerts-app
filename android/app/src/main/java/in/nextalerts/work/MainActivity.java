package in.nextalerts.work;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * NextAlerts for Android: one screen that shows the live dashboard (work.nextalerts.in), so every website change
 * is in the app at once. The shell adds what a plain web view lacks: file uploads, downloads (also the ones the
 * page builds in memory), the microphone, an offline screen, and its own update from the GitHub release.
 */
public class MainActivity extends Activity {
    static final String HOME = "https://work.nextalerts.in";
    static final String HOST = "work.nextalerts.in";
    static final String REPO = "soubickdas-lab/nextalerts-app";
    static final int REQ_FILE = 11, REQ_MIC = 12, REQ_NOTIFY = 13;
    static final String CHANNEL = "updates";
    int notifyId = 100;

    WebView web;
    ValueCallback<Uri[]> fileCallback;
    PermissionRequest micRequest;
    volatile String updateJson = "{\"available\":false}";
    volatile String apkUrl = null, apkName = null;
    long updateDownloadId = -1;
    boolean showingOffline = false;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout root = new FrameLayout(this);
        root.setFitsSystemWindows(true);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.setBackgroundColor(0xFFECEEF6);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " NextAlertsApp/" + BuildConfig.VERSION_NAME + " (Android)");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "NextAlertsAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> download(url, userAgent, contentDisposition, mimeType));

        IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloadDone, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(downloadDone, f);

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(startUrl(getIntent()));
        new Thread(this::checkUpdate).start();
    }

    String startUrl(Intent i) {
        Uri d = i == null ? null : i.getData();
        return d != null && HOST.equals(d.getHost()) ? d.toString() : HOME;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (i != null && i.getData() != null && HOST.equals(i.getData().getHost())) web.loadUrl(i.getData().toString());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush(); // keep the sign-in when the app is closed
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (showingOffline) web.loadUrl(HOME);
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(downloadDone); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack() && !showingOffline) web.goBack();
        else moveTaskToBack(true);
    }

    void toast(String m) {
        runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show());
    }

    // ------------------------------------------------------------ page
    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if ((scheme.equals("https") || scheme.equals("http")) && HOST.equals(u.getHost())) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {} // other sites, mail, phone: the phone's own apps
            return true;
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            if (url != null && url.startsWith("https://" + HOST)) showingOffline = false;
            v.evaluateJavascript(HOOK_JS, null);
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame()) return;
            showingOffline = true;
            v.loadDataWithBaseURL("https://offline.nextalerts.invalid/", OFFLINE_HTML, "text/html", "utf-8", null);
        }
    }

    class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                String[] types = p.getAcceptTypes();
                if (types != null && types.length > 0 && types[0] != null && types[0].contains("/")) {
                    if (types.length == 1) i.setType(types[0]);
                    else i.putExtra(Intent.EXTRA_MIME_TYPES, types);
                }
                if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(Intent.createChooser(i, "Choose a file"), REQ_FILE);
            } catch (Exception e) {
                fileCallback = null;
                cb.onReceiveValue(null);
                toast("No app on this phone can pick files");
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                boolean wantsMic = false;
                for (String r : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
                if (!wantsMic || !HOST.equals(request.getOrigin().getHost())) { request.deny(); return; }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    micRequest = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                }
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_MIC && micRequest != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) micRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else micRequest.deny();
            micRequest = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE || fileCallback == null) return;
        Uri[] out = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                out = new Uri[n];
                for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                out = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
    }

    // ------------------------------------------------------------ downloads
    // The page makes many files in memory (CSV exports, the backup zip): a web view cannot save those by itself,
    // so the page hands the bytes over through the bridge. Normal links go to the phone's download manager.
    static final String HOOK_JS = "(function(){if(window.__naHook)return;window.__naHook=1;"
            + "var oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__naName=this.download;return oc.apply(this,arguments);};"
            + "document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[download]');if(a)window.__naName=a.download;},true);"
            + "var orv=URL.revokeObjectURL;URL.revokeObjectURL=function(u){setTimeout(function(){try{orv.call(URL,u);}catch(e){}},60000);};"
            + "})();";

    void download(String url, String userAgent, String contentDisposition, String mimeType) {
        if (url.startsWith("blob:")) {
            String js = "(async function(){try{var r=await fetch(" + JSONObject.quote(url) + ");var b=await r.blob();var fr=new FileReader();"
                    + "fr.onloadend=function(){NextAlertsAndroid.saveBase64(window.__naName||'',b.type||" + JSONObject.quote(mimeType == null ? "" : mimeType) + ",String(fr.result).split(',')[1]||'');window.__naName='';};"
                    + "fr.readAsDataURL(b);}catch(e){NextAlertsAndroid.fail(String(e));}})();";
            web.evaluateJavascript(js, null);
            return;
        }
        if (url.startsWith("data:")) {
            int comma = url.indexOf(',');
            String head = comma > 5 ? url.substring(5, comma) : "";
            String body = comma > 0 ? url.substring(comma + 1) : "";
            byte[] bytes = head.contains(";base64") ? Base64.decode(body, Base64.DEFAULT) : Uri.decode(body).getBytes();
            saveBytes("", head.split(";")[0], bytes);
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            req.addRequestHeader("User-Agent", userAgent);
            req.setMimeType(mimeType);
            req.setTitle(name);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
            toast("Downloading " + name);
        } catch (Exception e) {
            toast("Download failed: " + e.getMessage());
        }
    }

    void saveBytes(String name, String mime, byte[] bytes) {
        try {
            if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
            if (name == null || name.trim().isEmpty()) {
                String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
                name = "nextalerts-" + System.currentTimeMillis() + (ext == null ? "" : "." + ext);
            }
            name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("no place to save");
                try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(bytes); }
                toast("Saved to Downloads: " + name);
            } else {
                // older phones: the app's own folder needs no permission
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                File f = new File(dir, name);
                try (FileOutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                toast("Saved: " + f.getAbsolutePath());
            }
        } catch (Exception e) {
            toast("Could not save the file: " + e.getMessage());
        }
    }

    // ------------------------------------------------------------ bridge to the page
    class Bridge {
        @JavascriptInterface public String version() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public String updateInfo() { return updateJson; }
        @JavascriptInterface public void installUpdate() { runOnUiThread(MainActivity.this::startUpdate); }
        // the page raises a notification; the phone shows it like any other app's
        @JavascriptInterface public void notify(String title, String body, String link) { showNotification(title, body, link); }
        @JavascriptInterface public void askNotify() { runOnUiThread(MainActivity.this::askNotifyPermission); }
        @JavascriptInterface public void retry() { runOnUiThread(() -> web.loadUrl(HOME)); }
        @JavascriptInterface public void fail(String why) { toast("Download failed: " + why); }
        @JavascriptInterface public void saveBase64(String name, String mime, String b64) {
            try { saveBytes(name, mime, Base64.decode(b64, Base64.DEFAULT)); } catch (Exception e) { toast("Could not save the file: " + e.getMessage()); }
        }
    }

    // ------------------------------------------------------------ notifications
    void askNotifyPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
    }

    void showNotification(String title, String body, String link) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "NextAlerts", NotificationManager.IMPORTANCE_HIGH));
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            // a tap opens the app on the page the notification is about
            Intent open = new Intent(this, MainActivity.class);
            if (link != null && link.startsWith("#")) { open.setAction(Intent.ACTION_VIEW); open.setData(Uri.parse(HOME + "/" + link)); }
            open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, notifyId, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
            b.setSmallIcon(R.drawable.ic_notify).setColor(0xFF6552F5).setContentTitle(title).setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(pi);
            if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
            nm.notify(notifyId++, b.build());
        } catch (Exception ignored) {}
    }

    // ------------------------------------------------------------ the app's own update
    static boolean newer(String remote, String local) {
        String[] a = remote.replaceFirst("^v", "").split("\\."), b = local.split("\\.");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int x = i < a.length ? num(a[i]) : 0, y = i < b.length ? num(b[i]) : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    static int num(String s) {
        try { return Integer.parseInt(s.replaceAll("[^0-9]", "")); } catch (Exception e) { return 0; }
    }

    void checkUpdate() {
        String current = BuildConfig.VERSION_NAME;
        try {
            // the newest version is read from where GitHub redirects "releases/latest" — no API call, no hourly limit
            HttpURLConnection c = (HttpURLConnection) new URL("https://github.com/" + REPO + "/releases/latest").openConnection();
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "nextalerts-app");
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            int code = c.getResponseCode();
            String loc = c.getHeaderField("Location");
            c.disconnect();
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("/releases/tag/v?(\\d+(?:\\.\\d+)*)$").matcher(loc == null ? "" : loc);
            if (!m.find()) throw new Exception("GitHub said " + code);
            String version = m.group(1);
            String name = "NextAlerts-" + version + ".apk";
            String url = "https://github.com/" + REPO + "/releases/download/v" + version + "/" + name;
            boolean available = url != null && newer(version, current);
            apkUrl = available ? url : null;
            apkName = name;
            updateJson = new JSONObject().put("available", available).put("version", version).put("current", current).toString();
        } catch (Exception e) {
            try { updateJson = new JSONObject().put("available", false).put("current", current).put("error", String.valueOf(e.getMessage())).toString(); } catch (Exception ignored) {}
        }
    }

    void startUpdate() {
        if (apkUrl == null) { toast("NextAlerts is already up to date"); return; }
        try {
            File dir = new File(getExternalFilesDir(null), "updates");
            if (dir.exists()) { File[] old = dir.listFiles(); if (old != null) for (File f : old) f.delete(); }
            dir.mkdirs();
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(apkUrl));
            req.setTitle("NextAlerts update");
            req.setMimeType("application/vnd.android.package-archive");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            req.setDestinationUri(Uri.fromFile(new File(dir, apkName == null ? "NextAlerts.apk" : apkName)));
            updateDownloadId = ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
            toast("Downloading the update…");
        } catch (Exception e) {
            // last resort: let the phone's browser fetch it
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl))); } catch (Exception ignored) { toast("Update failed: " + e.getMessage()); }
        }
    }

    final BroadcastReceiver downloadDone = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent i) {
            long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != updateDownloadId || id == -1) return;
            updateDownloadId = -1;
            try {
                File dir = new File(getExternalFilesDir(null), "updates");
                File[] files = dir.listFiles();
                if (files == null || files.length == 0) throw new Exception("the file did not arrive");
                Uri uri = FileProvider.getUriForFile(MainActivity.this, "in.nextalerts.work.files", files[0]);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(install);
            } catch (Exception e) {
                toast("Update failed: " + e.getMessage());
            }
        }
    };

    static final String OFFLINE_HTML = "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<style>body{margin:0;height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#eceef6;color:#121430}"
            + ".b{text-align:center;padding:24px;max-width:320px}.l{width:64px;height:64px;border-radius:18px;margin:0 auto 18px;background:linear-gradient(180deg,#7c6cff,#5a4ae6);display:grid;place-items:center;color:#fff;font-weight:800;font-size:30px}"
            + "h1{font-size:19px;margin:0 0 6px}p{margin:0 0 20px;color:#6a6f92}button{border:0;border-radius:12px;background:#6552f5;color:#fff;font:inherit;font-weight:600;padding:12px 26px}</style></head>"
            + "<body><div class='b'><div class='l'>N</div><h1>Can't reach NextAlerts</h1><p>Check the internet connection, then try again.</p>"
            + "<button onclick='NextAlertsAndroid.retry()'>Try again</button></div>"
            + "<script>window.addEventListener('online',function(){NextAlertsAndroid.retry()});setInterval(function(){if(navigator.onLine)NextAlertsAndroid.retry()},8000)</script></body></html>";
}
