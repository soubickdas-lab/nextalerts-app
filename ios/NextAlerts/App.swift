// NextAlerts for iPhone and iPad: one screen that shows the live dashboard (work.nextalerts.in), so every website
// change is in the app at once. The shell adds: an offline screen, pull to refresh, the microphone for AI Voice,
// file downloads (shared through the iOS share sheet) and links to other sites opening in Safari.
import UIKit
import WebKit
import UserNotifications

let home = URL(string: "https://work.nextalerts.in")!
let host = "work.nextalerts.in"

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        return true
    }

    // show the banner even while the app is on screen
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    // a tap opens the page the notification is about
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let link = response.notification.request.content.userInfo["link"] as? String, link.hasPrefix("#"),
           let web = (window?.rootViewController as? WebViewController)?.web {
            web.evaluateJavaScript("location.hash = \(String(reflecting: link))", completionHandler: nil)
        }
        completionHandler()
    }
}

class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    var web: WKWebView!
    var showingOffline = false
    var downloadTargets: [ObjectIdentifier: URL] = [:]

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default() // keeps the sign-in between launches
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        // the page asks this object which app it is in; iPhone apps update through the App Store / TestFlight
        let bridge = """
        window.nextalertsApp = { platform: 'ios', version: async function () { return '\(version)'; },
          retry: function () { window.webkit.messageHandlers.app.postMessage('retry'); } };
        """
        cfg.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController.add(self, name: "app")
        cfg.userContentController.add(self, name: "notify")
        cfg.userContentController.add(self, name: "badge")
        cfg.applicationNameForUserAgent = "NextAlertsApp/\(version) (iOS)"

        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .always
        web.isOpaque = false
        web.backgroundColor = UIColor(named: "LaunchBackground")
        web.scrollView.backgroundColor = UIColor(named: "LaunchBackground")
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pulled(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(named: "LaunchBackground")
        web.load(URLRequest(url: home))
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc func pulled(_ sender: UIRefreshControl) {
        if showingOffline { web.load(URLRequest(url: home)) } else { web.reload() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sender.endRefreshing() }
    }

    @objc func foreground() {
        if showingOffline { web.load(URLRequest(url: home)) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "badge" {
            let n = (message.body as? NSNumber)?.intValue ?? Int((message.body as? String) ?? "") ?? 0
            UIApplication.shared.applicationIconBadgeNumber = max(0, n)
            return
        }
        if message.name == "notify", let d = message.body as? [String: Any] {
            // the page raises a notification; iOS shows it as a normal banner
            let c = UNMutableNotificationContent()
            c.title = d["title"] as? String ?? "NextAlerts"
            c.body = d["body"] as? String ?? ""
            c.sound = .default
            c.userInfo = ["link": d["link"] as? String ?? ""]
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
            return
        }
        if message.body as? String == "retry" { web.load(URLRequest(url: home)) }
    }

    // ---------------------------------------------------------------- navigation
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel, preferences); return }
        if action.shouldPerformDownload { decisionHandler(.download, preferences); return }
        let scheme = url.scheme ?? ""
        if scheme == "blob" || scheme == "data" || scheme == "about" || url.host == host { decisionHandler(.allow, preferences); return }
        // other sites, mail and phone links: the phone's own apps
        if action.targetFrame == nil || action.targetFrame?.isMainFrame == true {
            UIApplication.shared.open(url)
            decisionHandler(.cancel, preferences)
        } else {
            decisionHandler(.allow, preferences)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    // a link that wants a new tab: ours stays in the app, anything else goes to Safari
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if url.host == host { webView.load(action.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView.url?.host == host { showingOffline = false }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.code == NSURLErrorCancelled || e.code == 102 { return } // 102 = the load became a download
        showingOffline = true
        webView.loadHTMLString(offlineHTML, baseURL: nil)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // ---------------------------------------------------------------- microphone / camera for our own pages only
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == host ? .grant : .deny)
    }

    // ---------------------------------------------------------------- page dialogs (alert / confirm / prompt)
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }

    // ---------------------------------------------------------------- downloads → share sheet (Save to Files, AirDrop…)
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let target = dir.appendingPathComponent(suggestedFilename.isEmpty ? "download" : suggestedFilename)
        downloadTargets[ObjectIdentifier(download)] = target
        completionHandler(target)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadTargets.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadTargets.removeValue(forKey: ObjectIdentifier(download))
        let a = UIAlertController(title: "Download failed", message: error.localizedDescription, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }
}

let offlineHTML = """
<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<style>:root{color-scheme:light dark}body{margin:0;height:100vh;display:grid;place-items:center;font:17px/1.5 -apple-system,sans-serif;background:#eceef6;color:#121430}
.b{text-align:center;padding:24px;max-width:320px}.l{width:64px;height:64px;border-radius:18px;margin:0 auto 18px;background:linear-gradient(180deg,#7c6cff,#5a4ae6);display:grid;place-items:center;color:#fff;font-weight:800;font-size:30px}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 20px;color:#6a6f92}button{border:0;border-radius:12px;background:#6552f5;color:#fff;font:inherit;font-weight:600;padding:12px 26px}
@media(prefers-color-scheme:dark){body{background:#0b0c1a;color:#eceeff}p{color:#9194bb}}</style></head>
<body><div class='b'><div class='l'>N</div><h1>Can't reach NextAlerts</h1><p>Check the internet connection, then try again.</p>
<button onclick="window.webkit.messageHandlers.app.postMessage('retry')">Try again</button></div>
<script>window.addEventListener('online',function(){window.webkit.messageHandlers.app.postMessage('retry')})</script></body></html>
"""
