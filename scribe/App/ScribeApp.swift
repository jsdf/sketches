import SwiftUI

@main
struct ScribeApp: App {
    @State private var host = ScribeHost()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(host)
                .onOpenURL { url in
                    // scribe://start — the keyboard opens this when it needs the app
                    // in the foreground to (re)start a Scribe session.
                    guard url.scheme == ScribeGroup.urlScheme else { return }
                    if url.host == "start" || url.path == "/start" {
                        Task { await host.startSession() }
                    }
                }
        }
    }
}
