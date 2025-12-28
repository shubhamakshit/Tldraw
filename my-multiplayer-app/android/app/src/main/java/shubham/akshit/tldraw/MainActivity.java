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

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean wasButtonPressed = false;
    private boolean isTouchActive = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable edge-to-edge display
        hideSystemUI();
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