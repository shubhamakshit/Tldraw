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

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

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
    
    private boolean isVolUpPressed = false;
    private boolean isVolDownPressed = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
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
            }, "AndroidNative");
        }
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
                PointerProperties[] props = new PointerProperties[pointerCount];
                PointerCoords[] coords = new PointerCoords[pointerCount];

                for (int i = 0; i < pointerCount; i++) {
                    props[i] = new PointerProperties();
                    event.getPointerProperties(i, props[i]);
                    coords[i] = new PointerCoords();
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
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('" + eventName + "'));", null);
            });
        }
    }
}