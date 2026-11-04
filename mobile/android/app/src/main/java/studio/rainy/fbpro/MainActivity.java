package studio.rainy.fbpro;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;

/**
 * Android browser proof-of-concept. This intentionally loads Facebook mobile web
 * only; posting automation is disabled until the page adapter is implemented
 * and verified against Facebook's current mobile web UI.
 */
public final class MainActivity extends Activity {
    private static GeckoRuntime runtime;
    private GeckoSession session;
    private GeckoView geckoView;

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
        session.open(runtime);
        geckoView.setSession(session);
        session.loadUri("https://m.facebook.com/");
    }

    @Override protected void onResume() {
        super.onResume();
        if (session != null) session.setActive(true);
    }

    @Override protected void onPause() {
        if (session != null) session.setActive(false);
        super.onPause();
    }

    @Override public void onBackPressed() {
        if (session != null && session.getNavigationDelegate() != null) {
            session.getNavigationDelegate().onCanGoBack(session, canGoBack -> {
                if (canGoBack) session.goBack();
                else superOnBackPressed();
            });
        } else {
            super.onBackPressed();
        }
    }

    private void superOnBackPressed() {
        runOnUiThread(() -> MainActivity.super.onBackPressed());
    }

    @Override protected void onDestroy() {
        if (geckoView != null) geckoView.releaseSession();
        if (session != null) session.close();
        session = null;
        super.onDestroy();
    }
}
