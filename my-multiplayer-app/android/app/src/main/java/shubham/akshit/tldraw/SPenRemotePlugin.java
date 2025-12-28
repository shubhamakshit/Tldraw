package shubham.akshit.tldraw;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.samsung.android.sdk.SsdkUnsupportedException;
import com.samsung.android.sdk.penremote.ButtonEvent;
import com.samsung.android.sdk.penremote.SpenEvent;
import com.samsung.android.sdk.penremote.SpenEventListener;
import com.samsung.android.sdk.penremote.SpenRemote;
import com.samsung.android.sdk.penremote.SpenUnit;
import com.samsung.android.sdk.penremote.SpenUnitManager;

@CapacitorPlugin(name = "SPenRemote")
public class SPenRemotePlugin extends Plugin {

    private SpenUnitManager mSpenUnitManager = null;
    private SpenRemote mSpenRemote;

    @PluginMethod
    public void connect(PluginCall call) {
        if (mSpenRemote == null) {
            mSpenRemote = SpenRemote.getInstance();
            // FIX 1: Removed mSpenRemote.initialize(getContext());
            // It is not needed in this version of the SDK.
        }

        // Check if the S Pen Remote feature is available
        if (!mSpenRemote.isFeatureEnabled(SpenRemote.FEATURE_TYPE_BUTTON)) {
            call.reject("S Pen Button feature not available on this device.");
            return;
        }

        if (!mSpenRemote.isConnected()) {
            mSpenRemote.connect(getContext(), new SpenRemote.ConnectionResultCallback() {
                @Override
                public void onSuccess(SpenUnitManager manager) {
                    mSpenUnitManager = manager;
                    registerButtonListener();
                    call.resolve();
                }

                @Override
                public void onFailure(int error) {
                    call.reject("Failed to connect to S Pen Remote service. Error: " + error);
                }
            });
        } else {
            call.resolve(); // Already connected
        }
    }

    private void registerButtonListener() {
        try {
            SpenUnit button = mSpenUnitManager.getUnit(SpenUnit.TYPE_BUTTON);
            mSpenUnitManager.registerSpenEventListener(new SpenEventListener() {
                @Override
                // FIX 2: Renamed from 'onEventChanged' to 'onEvent'
                public void onEvent(SpenEvent ev) {
                    ButtonEvent buttonEvent = new ButtonEvent(ev);

                    if (buttonEvent.getAction() == ButtonEvent.ACTION_DOWN) {
                        JSObject ret = new JSObject();
                        ret.put("pressed", true);
                        notifyListeners("spenClick", ret);
                    }
                }
            }, button);
        } catch (Exception e) {
            Log.e("SPenRemote", "Error registering listener", e);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (mSpenRemote != null && mSpenRemote.isConnected()) {
            mSpenRemote.disconnect(getContext());
        }
        super.handleOnDestroy();
    }
}