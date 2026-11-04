package studio.rainy.fbpro;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;

public final class MainActivity extends Activity {
    private static GeckoRuntime runtime;
    private GeckoSession session;
    private GeckoView geckoView;
    private boolean canGoBack;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        geckoView = new GeckoView(this);
        root.addView(geckoView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        if (runtime == null) runtime = GeckoRuntime.create(this);
        session = new GeckoSession();
        session.setContentDelegate(new GeckoSession.ContentDelegate() {});
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public void onCanGoBack(GeckoSession currentSession, boolean available) {
                canGoBack = available;
            }
        });
        session.open(runtime);
        geckoView.setSession(session);
        runtime.getWebExtensionController()
            .ensureBuiltIn("resource://android/assets/rainy/", "rainy-mobile@rainy.studio")
            .accept(extension -> openWorkspace(false), error -> openWorkspace(true));
    }

    private void openWorkspace(boolean extensionFailed) {
        if (session == null) return;
        if (extensionFailed) {
            Toast.makeText(this, "RAINY өргөтгөл ачаалагдсангүй", Toast.LENGTH_LONG).show();
        }
        session.loadUri("https://workspace.rainy.studio/mobile/");
    }

    @Override public void onBackPressed() {
        if (session != null && canGoBack) session.goBack();
        else super.onBackPressed();
    }

    @Override protected void onResume() {
        super.onResume();
        if (session != null) session.setActive(true);
    }

    @Override protected void onPause() {
        if (session != null) session.setActive(false);
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (geckoView != null) geckoView.releaseSession();
        if (session != null) session.close();
        session = null;
        super.onDestroy();
    }
}