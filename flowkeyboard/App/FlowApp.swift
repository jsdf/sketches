import SwiftUI

@main
struct FlowApp: App {
    @State private var host = FlowHost()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(host)
                .onOpenURL { url in
                    // flowclone://start — the keyboard opens this when it needs the app
                    // in the foreground to (re)start a Flow session.
                    guard url.scheme == FlowGroup.urlScheme else { return }
                    if url.host == "start" || url.path == "/start" {
                        Task { await host.startFlowSession() }
                    }
                }
        }
    }
}
