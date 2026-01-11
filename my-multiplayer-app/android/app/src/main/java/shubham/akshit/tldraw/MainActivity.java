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
import android.provider.OpenableColumns;
import java.io.ByteArrayOutputStream;

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
    
    // Pending Intent Data (Native Buffer)
    private String pendingSharedFileUri = null;
    private String pendingSharedFileUris = null;
    private String pendingSharedText = null;

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
        setupNativeInterface();

        // Welcome Toast with active URL
        String urlUsed = (customUrl != null && !customUrl.isEmpty()) ? customUrl : "Default Config";
        Toast.makeText(this, "Collaborative Suite Pro • " + urlUsed, Toast.LENGTH_LONG).show();

        // Enable edge-to-edge display
        hideSystemUI();

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent); // Update the intent saved in the activity
        handleIntent(intent);
    }
    
    // ... (rest of the file until setupNativeInterface) ...

    private void setupNativeInterface() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            
            // ... (settings) ...

            getBridge().getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public String getPendingFileUri() {
                    String uri = pendingSharedFileUri;
                    pendingSharedFileUri = null; // Clear after read
                    return uri;
                }

                @JavascriptInterface
                public String getPendingFileUris() {
                    String uris = pendingSharedFileUris;
                    pendingSharedFileUris = null; // Clear after read
                    return uris;
                }

                @JavascriptInterface
                public String getPendingSharedText() {
                    String text = pendingSharedText;
                    pendingSharedText = null; // Clear after read
                    return text;
                }

                @JavascriptInterface
                public String getFileName(String uriString) {
                    if (uriString == null) return null;
                    try {
                        Uri uri = Uri.parse(uriString);
                        String result = null;
                        if (uri.getScheme().equals("content")) {
                            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                                if (cursor != null && cursor.moveToFirst()) {
                                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                                    if (index >= 0) {
                                        result = cursor.getString(index);
                                    }
                                }
                            }
                        }
                        if (result == null) {
                            result = uri.getPath();
                            int cut = result.lastIndexOf('/');
                            if (cut != -1) {
                                result = result.substring(cut + 1);
                            }
                        }
                        return result;
                    } catch (Exception e) {
                        e.printStackTrace();
                        return "unknown_file";
                    }
                }

                @JavascriptInterface
                public String readContentUri(String uriString) {
                    if (uriString == null) return null;
                    try {
                        Uri uri = Uri.parse(uriString);
                        try (InputStream iStream = getContentResolver().openInputStream(uri);
                             ByteArrayOutputStream byteBuffer = new ByteArrayOutputStream()) {
                            if (iStream == null) return null;
                            int bufferSize = 1024;
                            byte[] buffer = new byte[bufferSize];
                            int len = 0;
                            while ((len = iStream.read(buffer)) != -1) {
                                byteBuffer.write(buffer, 0, len);
                            }
                            return Base64.encodeToString(byteBuffer.toByteArray(), Base64.NO_WRAP);
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                        return null;
                    }
                }

                @JavascriptInterface
                public void saveBlob(String base64Data, String filename, String mimeType) {
                    try {
                        File path = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        if (!path.exists()) path.mkdirs();
                        File file = new File(path, filename);
                        
                        // Handle duplicates
                        int k = 1;
                        String name = filename;
                        String ext = "";
                        int dot = filename.lastIndexOf('.');
                        if (dot > 0) {
                            name = filename.substring(0, dot);
                            ext = filename.substring(dot);
                        }
                        while (file.exists()) {
                            file = new File(path, name + "(" + k++ + ")" + ext);
                        }

                        byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                        try (FileOutputStream os = new FileOutputStream(file)) {
                            os.write(bytes);
                            os.flush();
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }

                @JavascriptInterface
                public String startFile(String filename, String sessionId) {
                    try {
                        File path = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        if (!path.exists()) path.mkdirs();
                        File file = new File(path, filename);
                        
                        int k = 1;
                        String name = filename;
                        String ext = "";
                        int dot = filename.lastIndexOf('.');
                        if (dot > 0) {
                            name = filename.substring(0, dot);
                            ext = filename.substring(dot);
                        }
                        while (file.exists()) {
                            file = new File(path, name + "(" + k++ + ")" + ext);
                        }
                        
                        FileOutputStream fos = new FileOutputStream(file);
                        pendingFiles.put(sessionId, fos);
                        pendingFilePaths.put(sessionId, file);
                        
                        return file.getName();
                    } catch (IOException e) {
                        e.printStackTrace();
                        return null;
                    }
                }

                @JavascriptInterface
                public void appendFile(String base64Chunk, String sessionId) {
                    try {
                        FileOutputStream fos = pendingFiles.get(sessionId);
                        if (fos != null) {
                            byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                            fos.write(bytes);
                        }
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }

                @JavascriptInterface
                public void finishFile(String sessionId, String mimeType) {
                    try {
                        FileOutputStream fos = pendingFiles.remove(sessionId);
                        File file = pendingFilePaths.remove(sessionId);
                        if (fos != null) {
                            fos.flush();
                            fos.close();
                        }
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }, "AndroidNative");
        }
    }

    // ... (rest of the file until handleIntent) ...

    private void handleIntent(Intent intent) {
        if (intent == null) {
            android.util.Log.d("ColorRM_Native", "handleIntent: Intent is null");
            return;
        }

        String action = intent.getAction();
        String type = intent.getType();
        android.util.Log.d("ColorRM_Native", "handleIntent: action=" + action + ", type=" + type);

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            if ("text/plain".equals(type)) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                android.util.Log.d("ColorRM_Native", "handleIntent: Shared text=" + sharedText);
                if (sharedText != null) {
                    // Store in native buffer
                    pendingSharedText = sharedText;
                    
                    // Also try to pass to WebView if ready
                    String safeText = escapeJavascriptString(sharedText);
                    evaluateJavascript("if(window.handleSharedUrl) { window.handleSharedUrl('" + safeText + "'); }");
                }
            } else {
                Uri fileUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                android.util.Log.d("ColorRM_Native", "handleIntent: Shared file URI=" + fileUri);
                if (fileUri != null) {
                    // Store in native buffer
                    pendingSharedFileUri = fileUri.toString();
                    
                    // Also try to pass to WebView if ready
                    String safeUri = escapeJavascriptString(fileUri.toString());
                    evaluateJavascript("if(window.handleSharedFile) { window.handleSharedFile('" + safeUri + "'); }");
                }
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action) && type != null) {
            ArrayList<Uri> imageUris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (imageUris != null) {
                // Build JSON Array string manually
                StringBuilder jsonBuilder = new StringBuilder();
                jsonBuilder.append("[");
                for (int i = 0; i < imageUris.size(); i++) {
                    Uri u = imageUris.get(i);
                    if (i > 0) jsonBuilder.append(",");
                    jsonBuilder.append("\"").append(escapeJavascriptString(u.toString())).append("\"");
                }
                jsonBuilder.append("]");
                String jsonString = jsonBuilder.toString();
                
                android.util.Log.d("ColorRM_Native", "handleIntent: Shared multiple files=" + jsonString);
                
                // Store in native buffer
                pendingSharedFileUris = jsonString;
                
                // Also try to pass to WebView if ready
                evaluateJavascript("if(window.handleSharedFiles) { window.handleSharedFiles(" + jsonString + "); }");
            }
        } else if (Intent.ACTION_VIEW.equals(action) && type != null) {
            Uri fileUri = intent.getData();
            android.util.Log.d("ColorRM_Native", "handleIntent: View file URI=" + fileUri);
            if (fileUri != null) {
                // Store in native buffer
                pendingSharedFileUri = fileUri.toString();
                
                // Also try to pass to WebView if ready
                String safeUri = escapeJavascriptString(fileUri.toString());
                evaluateJavascript("if(window.handleSharedFile) { window.handleSharedFile('" + safeUri + "'); }");
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