import SwiftUI

@main
struct RainyFBProApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                VStack(spacing: 16) {
                    Image(systemName: "bolt.horizontal.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.blue)
                    Text("RAINY FB Pro")
                        .font(.title2.bold())
                    Text("Safari дээр RAINY FB Pro өргөтгөлийг идэвхжүүлээд Workspace болон Facebook-д зөвшөөрөл өгнө үү.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Link("Workspace нээх", destination: URL(string: "https://workspace.rainy.studio/mobile/")!)
                        .buttonStyle(.borderedProminent)
                }
                .padding()
                .navigationTitle("RAINY FB Pro")
            }
        }
    }
}