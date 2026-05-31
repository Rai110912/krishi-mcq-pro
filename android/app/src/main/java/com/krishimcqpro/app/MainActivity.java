package com.krishimcqpro.app;

import android.os.Bundle;
import android.view.WindowManager;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.DownloadListener;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private ValueCallback<Uri[]> mUploadMessage;
    private final static int FILECHOOSER_RESULTCODE = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Feature 7: Prevent screenshots during exam sessions (security)
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );

        // WebView Compatibility Bridge for Native Android APK File Selection & Downloads
        this.getBridge().getWebView().post(new Runnable() {
            @Override
            public void run() {
                WebView webView = getBridge().getWebView();
                if (webView == null) return;

                // 1. File Chooser setup
                webView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public boolean onShowFileChooser(
                            WebView webView, ValueCallback<Uri[]> filePathCallback,
                            WebChromeClient.FileChooserParams fileChooserParams) {
                        
                        if (mUploadMessage != null) {
                            mUploadMessage.onReceiveValue(null);
                        }
                        mUploadMessage = filePathCallback;

                        Intent intent = fileChooserParams.createIntent();
                        try {
                            startActivityForResult(intent, FILECHOOSER_RESULTCODE);
                        } catch (Exception e) {
                            mUploadMessage = null;
                            return false;
                        }
                        return true;
                    }
                });

                // 2. Download Listener setup
                webView.setDownloadListener(new DownloadListener() {
                    @Override
                    public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                        if (url.startsWith("data:")) {
                            Intent shareIntent = new Intent(Intent.ACTION_SEND);
                            shareIntent.setType("text/plain");
                            shareIntent.putExtra(Intent.EXTRA_TEXT, url);
                            startActivity(Intent.createChooser(shareIntent, "Save Progress Backup"));
                        } else {
                            Intent i = new Intent(Intent.ACTION_VIEW);
                            i.setData(Uri.parse(url));
                            startActivity(i);
                        }
                    }
                });
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILECHOOSER_RESULTCODE) {
            if (mUploadMessage == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                }
            }
            mUploadMessage.onReceiveValue(results);
            mUploadMessage = null;
        }
    }
}
