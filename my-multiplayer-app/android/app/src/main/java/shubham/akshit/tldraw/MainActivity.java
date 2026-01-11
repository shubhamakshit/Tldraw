package shubham.akshit.tldraw;

import android.os.Build;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.MotionEvent.PointerCoords;
import android.view.MotionEvent.PointerProperties;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import android.os.Environment;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.os.Looper;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import android.webkit.MimeTypeMap;
import java.io.InputStream;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import android.database.Cursor;
import android.provider.MediaStore;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.EditText;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import android.view.KeyEvent;

public class MainActivity extends BridgeActivity {

    private boolean wasButtonPressed = false;
    private boolean isTouchActive = false;

    // Cached arrays to avoid GC in dispatchTouchEvent
    private final PointerProperties[] cachedPointerProperties = new PointerProperties[10];
    private final PointerCoords[] cachedPointerCoords = new PointerCoords[10];

    {
        for (int i = 0; i < 10; i++) {
            cachedPointerProperties[i] = new PointerProperties();
            cachedPointerCoords[i] = new PointerCoords();
        }
    }

    private boolean isVolUpPressed = false;
    private boolean isVolDownPressed = false;

    // State for chunked file uploads
    private final java.util.Map<String, FileOutputStream> pendingFiles = new java.util.HashMap<>();
    private final java.util.Map<String, File> pendingFilePaths = new java.util.HashMap<>();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Enable WebView debugging for chrome://inspect
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        // 1. DYNAMIC SERVER URL OVERRIDE
        SharedPreferences prefs = getSharedPreferences("CapacitorPrefs", Context.MODE_PRIVATE);
        String customUrl = prefs.getString("server_url", null);

        if (customUrl != null && !customUrl.isEmpty()) {
            // Tell Capacitor to use this URL instead of the one in config
            getIntent().putExtra("url", customUrl);
        }

        super.onCreate(savedInstanceState);

        // Welcome Toast with active URL
        String urlUsed = (customUrl != null && !customUrl.isEmpty()) ? customUrl : "Default Config";
        Toast.makeText(this, "Collaborative Suite Pro • " + urlUsed, Toast.LENGTH_LONG).show();

        // Enable edge-to-edge display
        hideSystemUI();

        handleIntent(getIntent());
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            isVolUpPressed = true;
        } else if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            isVolDownPressed = true;
        }

        if (isVolUpPressed && isVolDownPressed) {
            showUrlConfigDialog();
            return true; // Consume event
        }

        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            isVolUpPressed = false;
        } else if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            isVolDownPressed = false;
        }
        return super.onKeyUp(keyCode, event);
    }

    private void showUrlConfigDialog() {
        SharedPreferences prefs = getSharedPreferences("CapacitorPrefs", Context.MODE_PRIVATE);
        String currentUrl = prefs.getString("server_url", "");

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Configure Server URL");
        builder.setMessage("Enter the backend URL (leave empty to use default config)");

        final EditText input = new EditText(this);
        input.setHint("http://192.168.x.x:5173");
        input.setText(currentUrl);
        builder.setView(input);

        builder.setPositiveButton("Save & Restart", (dialog, which) -> {
            String newUrl = input.getText().toString().trim();
            prefs.edit().putString("server_url", newUrl).apply();
            
            Toast.makeText(this, "URL Saved. Restarting app...", Toast.LENGTH_LONG).show();
            
            // Restart the activity to apply the new URL
            recreate();
        });

        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());
        builder.setNeutralButton("Reset Default", (dialog, which) -> {
            prefs.edit().remove("server_url").apply();
            Toast.makeText(this, "Reset to default config. Restarting...", Toast.LENGTH_LONG).show();
            recreate();
        });

        builder.show();
    }

    @Override
    public void onStart() {
        super.onStart();
        setupNativeInterface();
    }

    private void setupNativeInterface() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();

            // PERFORMANCE OPTIMIZATIONS
            // 1. Hardware acceleration (usually on by default, but explicit is safer)
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

            // 2. High render priority
            WebSettings settings = webView.getSettings();
            settings.setRenderPriority(WebSettings.RenderPriority.HIGH);

            // 3. Cache mode optimization for drawing app (less disk I/O during interaction)
            // settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

            // 4. Low latency mode for autofill (Android O+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
            }

            getBridge().getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void saveBlob(String base64Data, String filename, String mimeType) {
                    try {
                        byte[] fileData = Base64.decode(base64Data, Base64.DEFAULT);
                        File path = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        File file = new File(path, filename);
                        
                        // Avoid overwrite
                        int i = 1;
                        String name = filename;
                        int dot = filename.lastIndexOf('.');
                        String ext = dot > -1 ? filename.substring(dot) : "";
                        String base = dot > -1 ? filename.substring(0, dot) : filename;
                        
                        while (file.exists()) {
                            file = new File(path, base + "_" + i + ext);
                            i++;
                        }

                        FileOutputStream os = new FileOutputStream(file);
                        os.write(fileData);
                        os.close();

                        // Index the file so it appears in Downloads app immediately
                        android.media.MediaScannerConnection.scanFile(MainActivity.this,
                                new String[]{file.toString()}, null, null);

                        // Forceful Toast to show path
                        final String savedPath = file.getAbsolutePath();
                        MainActivity.this.runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                android.widget.Toast.makeText(MainActivity.this, "FILE SAVED: " + savedPath, android.widget.Toast.LENGTH_LONG).show();
                            }
                        });

                        // Notify system & Open
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                        intent.setDataAndType(uri, mimeType);
                        intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(Intent.createChooser(intent, "Open with..."));

                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }

                @JavascriptInterface
                public String startFile(String filename, String sessionId) {
                    try {
                        File path = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        File file = new File(path, filename);

                        // Avoid overwrite
                        int i = 1;
                        String name = filename;
                        int dot = filename.lastIndexOf('.');
                        String ext = dot > -1 ? filename.substring(dot) : "";
                        String base = dot > -1 ? filename.substring(0, dot) : filename;

                        while (file.exists()) {
                            file = new File(path, base + "_" + i + ext);
                            i++;
                        }

                        FileOutputStream os = new FileOutputStream(file);
                        pendingFiles.put(sessionId, os);
                        pendingFilePaths.put(sessionId, file);
                        return file.getName(); // Return actual filename used
                    } catch (Exception e) {
                        e.printStackTrace();
                        return null;
                    }
                }

                @JavascriptInterface
                public void appendFile(String base64Chunk, String sessionId) {
                    try {
                        FileOutputStream os = pendingFiles.get(sessionId);
                        if (os != null) {
                            byte[] data = Base64.decode(base64Chunk, Base64.DEFAULT);
                            os.write(data);
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }

                @JavascriptInterface
                public void finishFile(String sessionId, String mimeType) {
                    try {
                        FileOutputStream os = pendingFiles.remove(sessionId);
                        File file = pendingFilePaths.remove(sessionId);

                        if (os != null) {
                            os.close();
                        }

                        if (file != null) {
                            // Index the file
                            android.media.MediaScannerConnection.scanFile(MainActivity.this,
                                    new String[]{file.toString()}, null, null);

                            final String savedPath = file.getAbsolutePath();
                            MainActivity.this.runOnUiThread(() ->
                                android.widget.Toast.makeText(MainActivity.this, "FILE SAVED: " + savedPath, android.widget.Toast.LENGTH_LONG).show()
                            );

                            // Notify system & Open
                            Intent intent = new Intent(Intent.ACTION_VIEW);
                            Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                            intent.setDataAndType(uri, mimeType);
                            intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(Intent.createChooser(intent, "Open with..."));
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }

                @JavascriptInterface
                public void writeLog(String level, String message) {
                    // Write to Android logcat
                    String tag = "ColorRM";
                    switch (level) {
                        case "ERROR":
                        case "UNCAUGHT":
                        case "PROMISE":
                            android.util.Log.e(tag, message);
                            break;
                        case "WARN":
                            android.util.Log.w(tag, message);
                            break;
                        case "DEBUG":
                            android.util.Log.d(tag, message);
                            break;
                        default:
                            android.util.Log.i(tag, message);
                    }

                    // Also append to log file
                    try {
                        File logDir = new File(getExternalFilesDir(null), "logs");
                        if (!logDir.exists()) logDir.mkdirs();

                        File logFile = new File(logDir, "colorrm.log");

                        // Rotate log if too large (>5MB)
                        if (logFile.exists() && logFile.length() > 5 * 1024 * 1024) {
                            File oldLog = new File(logDir, "colorrm.old.log");
                            if (oldLog.exists()) oldLog.delete();
                            logFile.renameTo(oldLog);
                            logFile = new File(logDir, "colorrm.log");
                        }

                        java.io.FileWriter fw = new java.io.FileWriter(logFile, true);
                        String timestamp = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", java.util.Locale.US).format(new java.util.Date());
                        fw.write("[" + timestamp + "] [" + level + "] " + message + "\n");
                        fw.close();
                    } catch (Exception e) {
                        android.util.Log.e(tag, "Failed to write log file: " + e.getMessage());
                    }
                }

                @JavascriptInterface
                public String getLogFilePath() {
                    File logDir = new File(getExternalFilesDir(null), "logs");
                    File logFile = new File(logDir, "colorrm.log");
                    return logFile.getAbsolutePath();
                }

                @JavascriptInterface
                public String readContentUri(String uriString) {
                    try {
                        Uri uri = Uri.parse(uriString);
                        InputStream is = getContentResolver().openInputStream(uri);
                        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                        int nRead;
                        byte[] data = new byte[16384];
                        while ((nRead = is.read(data, 0, data.length)) != -1) {
                            buffer.write(data, 0, nRead);
                        }
                        buffer.flush();
                        byte[] finalBytes = buffer.toByteArray();
                        is.close();
                        return Base64.encodeToString(finalBytes, Base64.NO_WRAP);
                    } catch (Exception e) {
                        e.printStackTrace();
                        return null;
                    }
                }
            }, "AndroidNative");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            if ("text/plain".equals(type)) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (sharedText != null) {
                    // Pass the URL to the WebView
                    String safeText = escapeJavascriptString(sharedText);
                    evaluateJavascript("if(window.handleSharedUrl) { window.handleSharedUrl('" + safeText + "'); } else { console.warn('Native: handleSharedUrl not ready for: " + safeText + "'); }");
                }
            } else {
                Uri fileUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (fileUri != null) {
                    // Pass the file URI to the WebView
                    String safeUri = escapeJavascriptString(fileUri.toString());
                    evaluateJavascript("if(window.handleSharedFile) { window.handleSharedFile('" + safeUri + "'); } else { console.warn('Native: handleSharedFile not ready for: " + safeUri + "'); }");
                }
            }
        } else if (Intent.ACTION_VIEW.equals(action) && type != null) {
            Uri fileUri = intent.getData();
            if (fileUri != null) {
                // Pass the file URI to the WebView
                String safeUri = escapeJavascriptString(fileUri.toString());
                evaluateJavascript("if(window.handleSharedFile) { window.handleSharedFile('" + safeUri + "'); } else { console.warn('Native: handleSharedFile not ready for: " + safeUri + "'); }");
            }
        }
    }

    private void evaluateJavascript(String script) {
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.evaluateJavascript(script, null);
        }
    }

    private String escapeJavascriptString(String text) {
        if (text == null) return "";
        return text.replace("\\", "\\\\")
                   .replace("'", "\\'")
                   .replace("\"", "\\\"")
                   .replace("\n", "\\n")
                   .replace("\r", "\\r");
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
        }
    }

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11 (API 30) and above
            getWindow().setDecorFitsSystemWindows(false);

            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                // Hide both status bar and navigation bar
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());

                // Allow showing bars with swipe gesture (immersive sticky)
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            // Android 10 and below
            View decorView = getWindow().getDecorView();
            decorView.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
            );
        }

        // Keep screen on (optional - useful for drawing apps)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) {

            int action = event.getActionMasked();
            int buttonState = event.getButtonState();
            boolean isSideButtonPressed = (buttonState & MotionEvent.BUTTON_STYLUS_PRIMARY) != 0;

            if (action == MotionEvent.ACTION_DOWN) isTouchActive = true;
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) isTouchActive = false;

            if (isSideButtonPressed != wasButtonPressed) {
                wasButtonPressed = isSideButtonPressed;
                notifyBridge(isSideButtonPressed ? "spen-button-down" : "spen-button-up");
            }

            if (isSideButtonPressed || (wasButtonPressed && isTouchActive)) {

                int pointerCount = event.getPointerCount();
                // Safety check for array bounds
                if (pointerCount > 10) pointerCount = 10;

                PointerProperties[] props = cachedPointerProperties;
                PointerCoords[] coords = cachedPointerCoords;

                for (int i = 0; i < pointerCount; i++) {
                    event.getPointerProperties(i, props[i]);
                    event.getPointerCoords(i, coords[i]);
                }

                int forcedButtonState = isTouchActive ? MotionEvent.BUTTON_PRIMARY : 0;

                MotionEvent sanitized = MotionEvent.obtain(
                        event.getDownTime(),
                        event.getEventTime(),
                        event.getAction(),
                        pointerCount,
                        props,
                        coords,
                        event.getMetaState(),
                        forcedButtonState,
                        event.getXPrecision(),
                        event.getYPrecision(),
                        event.getDeviceId(),
                        event.getEdgeFlags(),
                        event.getSource(),
                        event.getFlags()
                );

                boolean result = super.dispatchTouchEvent(sanitized);
                sanitized.recycle();
                return result;
            }
        }
        return super.dispatchTouchEvent(event);
    }

    private void notifyBridge(String eventName) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            // PERFORMANCE FIX: Check if we are already on UI thread to avoid post() latency
            if (Looper.myLooper() == Looper.getMainLooper()) {
                getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('" + eventName + "'));", null);
            } else {
                getBridge().getWebView().post(() -> {
                    getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('" + eventName + "'));", null);
                });
            }
        }
    }
}