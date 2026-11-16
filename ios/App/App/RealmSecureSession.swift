import Capacitor
import Security

class RealmBridgeViewController: CAPBridgeViewController {
    #if DEBUG
    private var auditTimer: Timer?
    #endif
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RealmSecureSessionPlugin())
        #if DEBUG
        // Opt-in local device evidence, containing counts only. No profile identifiers,
        // chat text, credentials, hashes or complete storage dumps cross the console.
        if ProcessInfo.processInfo.arguments.contains("--realm-session-audit") {
            auditTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
                self?.webView?.evaluateJavaScript("""
                  (() => {
                    const rows = Object.keys(localStorage).filter(k => k === 'realm.v2' || k.startsWith('realm.v2:')).map(k => JSON.parse(localStorage.getItem(k)));
                    return JSON.stringify({profiles: rows.length, webTokens: rows.filter(s => !!s.session?.token).length,
                      webRecoveryCodes: rows.filter(s => !!s.guest?.recoveryCode).length,
                      sessionMarkers: rows.filter(s => !!s.session).length, signedOut: rows.filter(s => s.signedOut === true).length,
                      favourites: rows.reduce((n,s) => n + (s.plan?.length || 0), 0), pending: rows.reduce((n,s) => n + (s.outbox?.length || 0), 0)});
                  })()
                  """) { result, _ in
                    guard let text = result as? String, let bytes = text.data(using: .utf8),
                          let values = try? JSONSerialization.jsonObject(with: bytes) as? [String: Int],
                          Set(values.keys) == Set(["profiles", "webTokens", "webRecoveryCodes", "sessionMarkers", "signedOut", "favourites", "pending"]),
                          values.values.allSatisfy({ $0 >= 0 && $0 <= 100000 }) else { return }
                    NSLog("[realm session audit] %@", text)
                }
            }
        }
        #endif
    }
    deinit {
        #if DEBUG
        auditTimer?.invalidate()
        #endif
    }
}

/// One app-owned, non-synchronizing Keychain item per backend. No shared access group.
@objc(RealmSecureSessionPlugin)
public class RealmSecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RealmSecureSessionPlugin"
    public let jsName = "RealmSecureSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let namespace = call.getString("namespace"),
              let url = URL(string: namespace), url.scheme == "https", url.host != nil,
              namespace.count < 512 else {
            call.reject("Invalid secure session namespace")
            return nil
        }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "app.realm.festival.session.v1",
                kSecAttrAccount as String: namespace,
                kSecAttrSynchronizable as String: false]
    }

    @objc func read(_ call: CAPPluginCall) {
        guard var q = query(call) else { return }
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { audit("read-missing"); call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("Secure session unavailable", "KEYCHAIN_READ_FAILED")
            return
        }
        audit("read-present")
        call.resolve(["value": value])
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let q = query(call) else { return }
        guard let value = call.getString("value"), let data = value.data(using: .utf8), data.count <= 262144 else {
            call.reject("Invalid secure session value"); return
        }
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(q.merging(attributes) { _, new in new } as CFDictionary, nil)
            if status == errSecDuplicateItem { status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary) }
        }
        guard status == errSecSuccess else {
            call.reject("Secure session could not be saved", "KEYCHAIN_WRITE_FAILED"); return
        }
        audit("write-success")
        call.resolve()
    }

    private func audit(_ event: String) {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--realm-session-audit") {
            NSLog("[realm keychain audit] %@", event)
        }
        #endif
    }
}
